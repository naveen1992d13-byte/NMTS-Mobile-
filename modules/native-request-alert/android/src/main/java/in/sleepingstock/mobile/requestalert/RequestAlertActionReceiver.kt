package `in`.sleepingstock.mobile.requestalert

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles Pick / Snooze from the ongoing lock-screen notification.
 * Pick only unlocks and shows the in-app popup — it does not claim the
 * request or stop the ring. Snooze stops the ring. Full-screen intent is
 * owned by the ringing service / lock-gate Activity.
 */
class RequestAlertActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = RequestAlertPayload.fromIntent(intent)
    when (intent.action) {
      RequestAlertRingingService.ACTION_PICK -> {
        RequestAlertModule.emitPick(payload)
        val gate = Intent(context, RequestAlertLockGateActivity::class.java).apply {
          putExtras(payload.toBundle())
          addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_CLEAR_TOP or
              Intent.FLAG_ACTIVITY_NO_USER_ACTION
          )
        }
        context.startActivity(gate)
      }
      RequestAlertRingingService.ACTION_SNOOZE -> {
        RequestAlertRingingService.stop(context, payload.requestId)
        RequestAlertModule.emitSnooze(payload)
      }
    }
  }
}
