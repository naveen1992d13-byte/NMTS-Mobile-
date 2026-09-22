package `in`.sleepingstock.mobile.requestalert

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class RequestAlertModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeRequestAlert")
    Events("onPick", "onSnooze")

    OnCreate {
      instance = WeakReference(this@RequestAlertModule)
    }

    OnDestroy {
      if (instance?.get() === this@RequestAlertModule) {
        instance = null
      }
    }

    OnStartObserving {
      flushPending()
    }

    Function("stopRinging") { requestId: String? ->
      val context = appContext.reactContext ?: appContext.currentActivity ?: return@Function
      RequestAlertRingingService.stop(context, requestId)
    }

    AsyncFunction("isIgnoringBatteryOptimizations") {
      this@RequestAlertModule.isIgnoringBatteryOptimizations()
    }

    AsyncFunction("requestIgnoreBatteryOptimizations") {
      this@RequestAlertModule.requestIgnoreBatteryOptimizations()
    }
  }

  private fun appContextOrNull(): Context? =
    appContext.reactContext ?: appContext.currentActivity

  private fun isIgnoringBatteryOptimizations(): Boolean {
    val context = appContextOrNull() ?: return true
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return pm.isIgnoringBatteryOptimizations(context.packageName)
  }

  private fun requestIgnoreBatteryOptimizations(): Boolean {
    val context = appContextOrNull() ?: return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    if (isIgnoringBatteryOptimizations()) return true
    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
      data = Uri.parse("package:${context.packageName}")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      context.startActivity(intent)
    }
    return true
  }

  private fun emitMap(event: String, payload: RequestAlertPayload) {
    val body = Bundle()
    payload.toMap().forEach { (key, value) -> body.putString(key, value) }
    sendEvent(event, body)
  }

  companion object {
    private var instance: WeakReference<RequestAlertModule>? = null
    private var pendingEvent: Pair<String, RequestAlertPayload>? = null

    fun emitPick(payload: RequestAlertPayload) = emitOrQueue("onPick", payload)

    fun emitSnooze(payload: RequestAlertPayload) = emitOrQueue("onSnooze", payload)

    private fun emitOrQueue(event: String, payload: RequestAlertPayload) {
      val module = instance?.get()
      if (module != null) {
        try {
          module.emitMap(event, payload)
          pendingEvent = null
          return
        } catch (_: Throwable) {
        }
      }
      pendingEvent = event to payload
    }
  }

  private fun flushPending() {
    val pending = pendingEvent ?: return
    try {
      emitMap(pending.first, pending.second)
      pendingEvent = null
    } catch (_: Throwable) {
    }
  }
}
