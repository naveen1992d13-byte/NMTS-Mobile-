package `in`.sleepingstock.mobile.requestalert

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Lightweight lock-screen gate for incoming-request full-screen intents.
 * Turns the screen on, hands the request payload to MainActivity, then
 * finish()es so the visible UI is IncomingRequestPopup.js — not a native
 * popup. showWhenLocked / turnScreenOn live on this Activity (and are
 * applied transiently to MainActivity for this launch only).
 */
class RequestAlertLockGateActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    RequestAlertLockFlags.apply(this)
    RequestAlertLockFlags.registerOnce(application)
    RequestAlertLockFlags.markPendingLockBypass()
    val payload = RequestAlertPayload.fromIntent(intent)
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    if (launch != null) {
      launch.putExtras(payload.toBundle())
      launch.putExtra(RequestAlertLockFlags.EXTRA_FROM_LOCK_GATE, true)
      launch.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      )
      startActivity(launch)
    }
    finish()
  }
}
