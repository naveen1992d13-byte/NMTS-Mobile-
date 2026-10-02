package `in`.sleepingstock.mobile.requestalert

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build

internal object RequestAlertController {
  const val ACTION_FINISH_ALERT = "in.sleepingstock.mobile.requestalert.FINISH_ALERT"

  fun handlePicked(context: Context, requestId: String, pickedByName: String = "") {
    if (requestId.isNotBlank()) {
      RequestAlertStore.markPicked(context, requestId)
    }
    RequestAlertStore.clearActiveAlert(context)
    RequestAlertAlarms.cancel(context, requestId)
    RequestAlertRingingService.stop(context, requestId)
    finishAlert(context, requestId, pickedByName)
  }

  fun stopForRequest(context: Context, requestId: String) {
    RequestAlertStore.clearActiveAlert(context)
    RequestAlertAlarms.cancel(context, requestId)
    RequestAlertRingingService.stop(context, requestId)
    finishAlert(context, requestId)
  }

  fun finishAlert(context: Context, requestId: String, pickedByName: String = "") {
    val intent = Intent(ACTION_FINISH_ALERT).apply {
      setPackage(context.packageName)
      putExtra(RequestAlertPayload.KEY_REQUEST_ID, requestId)
      putExtra(RequestAlertPayload.KEY_PICKED_BY_NAME, pickedByName)
    }
    context.sendBroadcast(intent)
  }

  fun openAppOnRequest(context: Context, payload: RequestAlertPayload, dismissKeyguardFrom: android.app.Activity? = null) {
    RequestAlertLockFlags.registerOnce(context.applicationContext as android.app.Application)
    RequestAlertLockFlags.markPendingLockBypass()
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.putExtras(payload.toBundle())
    launch.putExtra(RequestAlertLockFlags.EXTRA_FROM_LOCK_GATE, true)
    launch.putExtra("open_request", "1")
    launch.addFlags(
      Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_SINGLE_TOP or
        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
    )
    if (dismissKeyguardFrom != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val km = dismissKeyguardFrom.getSystemService(KeyguardManager::class.java)
        km?.requestDismissKeyguard(dismissKeyguardFrom, null)
      } catch (_error: Throwable) {
      }
    }
    context.startActivity(launch)
  }
}
