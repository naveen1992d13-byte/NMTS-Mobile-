package `in`.sleepingstock.mobile.requestalert

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles Pick / Snooze from the ongoing lock-screen notification.
 * Stops ringing immediately. Full-screen intent is owned by the ringing
 * service / lock-gate Activity — this receiver only runs user actions.
 */
class RequestAlertActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = RequestAlertPayload.fromIntent(intent)
    RequestAlertRingingService.stop(context, payload.requestId)
    when (intent.action) {
      RequestAlertRingingService.ACTION_PICK -> {
        RequestAlertModule.emitPick(payload)
        // User tapped Pick — existing JS Pick handler/navigation needs the app.
        // This is not an auto-launch from FCM receipt.
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launch != null) {
          launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
          context.startActivity(launch)
        }
      }
      RequestAlertRingingService.ACTION_SNOOZE -> {
        RequestAlertModule.emitSnooze(payload)
      }
    }
  }
}
