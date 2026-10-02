package `in`.sleepingstock.mobile.requestalert

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

/**
 * Dedicated full-screen lock-screen alert. Never starts MainActivity on show.
 * Pick claims the request on the server first, then dismisses the keyguard
 * and opens the app on that request.
 */
class RequestAlertLockGateActivity : Activity() {
  private var payload: RequestAlertPayload = RequestAlertPayload.fromIntent(null)
  private var busy = false
  private var snoozeButton: TextView? = null
  private var pickButton: TextView? = null
  private var openButton: TextView? = null

  private val finishReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val incomingId = intent?.getStringExtra(RequestAlertPayload.KEY_REQUEST_ID).orEmpty()
      if (incomingId.isNotBlank() && incomingId != payload.requestId && incomingId != payload.requestNumber) {
        return
      }
      val name = intent?.getStringExtra(RequestAlertPayload.KEY_PICKED_BY_NAME).orEmpty()
      if (name.isNotBlank() && !payload.isTransfer()) {
        Toast.makeText(this@RequestAlertLockGateActivity, "Already picked by $name", Toast.LENGTH_LONG).show()
      }
      finish()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    RequestAlertLog.i("LockGate Activity launch")
    RequestAlertLockFlags.apply(this)
    payload = RequestAlertPayload.fromIntent(intent)
    if (payload.requestId.isBlank() && payload.requestNumber.isBlank()) {
      RequestAlertLog.i("LockGate blank payload rejected")
      finish()
      return
    }
    setContentView(buildUi())
    val filter = IntentFilter(RequestAlertController.ACTION_FINISH_ALERT)
    if (Build.VERSION.SDK_INT >= 33) {
      registerReceiver(finishReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(finishReceiver, filter)
    }
    validateThen { valid ->
      if (valid == false) {
        RequestAlertController.stopForRequest(this, payload.requestId)
        finish()
      }
    }
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    payload = RequestAlertPayload.fromIntent(intent)
    setContentView(buildUi())
  }

  override fun onDestroy() {
    try {
      unregisterReceiver(finishReceiver)
    } catch (_error: Throwable) {
    }
    super.onDestroy()
  }

  private fun buildUi(): LinearLayout {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(COLOR_BG)
      setPadding(dp(28), dp(48), dp(28), dp(36))
      gravity = Gravity.CENTER_HORIZONTAL
    }

    val logoId = resources.getIdentifier("sleeping_stock_logo", "drawable", packageName)
    if (logoId != 0) {
      root.addView(ImageView(this).apply {
        setImageResource(logoId)
        adjustViewBounds = true
        layoutParams = LinearLayout.LayoutParams(dp(160), dp(72)).apply {
          gravity = Gravity.CENTER_HORIZONTAL
          bottomMargin = dp(18)
        }
        scaleType = ImageView.ScaleType.FIT_CENTER
      })
    }

    root.addView(label("BRANCH REQUEST", COLOR_YELLOW, 13, true).apply {
      letterSpacing = 0.16f
      gravity = Gravity.CENTER
    })
    root.addView(label(payload.requestNumber.ifEmpty { "Incoming request" }, COLOR_TEXT, 22, true).apply {
      gravity = Gravity.CENTER
      setPadding(0, dp(10), 0, dp(18))
    })

    root.addView(metaRow("Requesting branch", payload.branchName.ifEmpty { "—" }))
    root.addView(metaRow("Total items", payload.totalItems.ifEmpty { "0" }))
    root.addView(metaRow("Total quantity", payload.totalQuantity.ifEmpty { "0" }))

    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply { topMargin = dp(28) }
    }

    if (payload.isTransfer()) {
      openButton = actionButton("OPEN REQUEST", filled = true) { onOpen() }
      actions.addView(openButton, LinearLayout.LayoutParams(0, dp(52), 1f))
    } else {
      if (payload.canShowSnooze()) {
        snoozeButton = actionButton("SNOOZE", filled = false) { onSnooze() }
        actions.addView(snoozeButton, LinearLayout.LayoutParams(0, dp(52), 1f).apply { rightMargin = dp(10) })
      }
      if (payload.canShowPick()) {
        pickButton = actionButton("PICK REQUEST", filled = true) { onPick() }
        actions.addView(pickButton, LinearLayout.LayoutParams(0, dp(52), if (payload.canShowSnooze()) 1.4f else 1f))
      }
    }
    root.addView(actions)
    return root
  }

  private fun onPick() {
    if (busy) return
    busy = true
    setButtonsEnabled(false)
    validateThen { valid ->
      if (valid == false) {
        Toast.makeText(this, "This request is no longer available", Toast.LENGTH_LONG).show()
        RequestAlertController.stopForRequest(this, payload.requestId)
        finish()
        return@validateThen
      }
      thread {
        val result = RequestAlertApi.claimPick(this, payload.requestId.ifBlank { payload.requestNumber })
        runOnUiThread {
          if (result.ok) {
            RequestAlertLog.i("LockGate pick claimed")
            RequestAlertStore.markPicked(this, payload.requestId)
            RequestAlertController.stopForRequest(this, payload.requestId)
            RequestAlertModule.emitPick(payload)
            RequestAlertController.openAppOnRequest(this, payload, dismissKeyguardFrom = this)
            finish()
          } else if (result.alreadyPicked || result.code == "ALREADY_PICKED") {
            val name = result.pickedByName.ifBlank { "another user" }
            Toast.makeText(this, "Already picked by $name", Toast.LENGTH_LONG).show()
            RequestAlertController.handlePicked(this, payload.requestId, name)
            finish()
          } else {
            busy = false
            setButtonsEnabled(true)
            Toast.makeText(this, result.message.ifBlank { "Unable to pick" }, Toast.LENGTH_LONG).show()
          }
        }
      }
    }
  }

  private fun onSnooze() {
    if (busy) return
    if (!payload.canShowSnooze()) {
      Toast.makeText(this, "Snooze is not available on this alert", Toast.LENGTH_LONG).show()
      return
    }
    busy = true
    setButtonsEnabled(false)
    validateThen { valid ->
      if (valid == false) {
        RequestAlertController.stopForRequest(this, payload.requestId)
        finish()
        return@validateThen
      }
      thread {
        val result = RequestAlertApi.skipSnooze(this, payload.requestId.ifBlank { payload.requestNumber })
        runOnUiThread {
          if (result.ok) {
            RequestAlertModule.emitSnooze(payload)
            RequestAlertController.stopForRequest(this, payload.requestId)
            finish()
          } else if (result.alreadyPicked || result.code == "ALREADY_PICKED") {
            val name = result.pickedByName.ifBlank { "another user" }
            Toast.makeText(this, "Already picked by $name", Toast.LENGTH_LONG).show()
            RequestAlertController.handlePicked(this, payload.requestId, name)
            finish()
          } else {
            busy = false
            setButtonsEnabled(true)
            Toast.makeText(this, result.message.ifBlank { "Unable to snooze" }, Toast.LENGTH_LONG).show()
          }
        }
      }
    }
  }

  private fun onOpen() {
    RequestAlertModule.emitPick(payload)
    RequestAlertController.stopForRequest(this, payload.requestId)
    RequestAlertController.openAppOnRequest(this, payload, dismissKeyguardFrom = this)
    finish()
  }

  private fun validateThen(done: (Boolean?) -> Unit) {
    thread {
      val valid = RequestAlertApi.shouldKeepRinging(this, payload)
      runOnUiThread { done(valid) }
    }
  }

  private fun setButtonsEnabled(enabled: Boolean) {
    snoozeButton?.isEnabled = enabled
    pickButton?.isEnabled = enabled
    openButton?.isEnabled = enabled
  }

  private fun metaRow(label: String, value: String): LinearLayout {
    return LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply { bottomMargin = dp(14) }
      addView(label(label.uppercase(), COLOR_MUTED, 11, true))
      addView(label(value, COLOR_TEXT, 16, true).apply { setPadding(0, dp(4), 0, 0) })
    }
  }

  private fun label(text: String, color: Int, sizeSp: Int, bold: Boolean): TextView {
    return TextView(this).apply {
      this.text = text
      setTextColor(color)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp.toFloat())
      typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
    }
  }

  private fun actionButton(title: String, filled: Boolean, onClick: () -> Unit): TextView {
    val bg = GradientDrawable().apply {
      cornerRadius = dp(14).toFloat()
      if (filled) {
        setColor(COLOR_CYAN)
      } else {
        setColor(Color.TRANSPARENT)
        setStroke(dp(1), COLOR_BORDER)
      }
    }
    return TextView(this).apply {
      text = title
      gravity = Gravity.CENTER
      setTextColor(if (filled) COLOR_ON_CYAN else COLOR_MUTED)
      typeface = Typeface.DEFAULT_BOLD
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      background = bg
      isClickable = true
      isFocusable = true
      setOnClickListener { onClick() }
    }
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  companion object {
    private val COLOR_BG = Color.parseColor("#05070d")
    private val COLOR_TEXT = Color.parseColor("#f4fbff")
    private val COLOR_MUTED = Color.parseColor("#8aa4bd")
    private val COLOR_YELLOW = Color.parseColor("#f5c542")
    private val COLOR_CYAN = Color.parseColor("#3ee0ff")
    private val COLOR_ON_CYAN = Color.parseColor("#041018")
    private val COLOR_BORDER = Color.parseColor("#38586c")
  }
}
