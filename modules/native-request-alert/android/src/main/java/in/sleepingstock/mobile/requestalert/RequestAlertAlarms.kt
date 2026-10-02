package `in`.sleepingstock.mobile.requestalert

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * Local snooze/reminder PendingIntents are request-scoped. The server owns
 * SLA reminder rounds and Snooze re-alerts; this only cancels any local
 * AlarmManager work if one was scheduled for the request.
 */
internal object RequestAlertAlarms {
  private const val ACTION_LOCAL_SNOOZE = "in.sleepingstock.mobile.requestalert.LOCAL_SNOOZE"
  private const val ACTION_LOCAL_REMINDER = "in.sleepingstock.mobile.requestalert.LOCAL_REMINDER"

  fun cancel(context: Context, requestId: String) {
    if (requestId.isBlank()) return
    val manager = context.getSystemService(AlarmManager::class.java) ?: return
    listOf(ACTION_LOCAL_SNOOZE, ACTION_LOCAL_REMINDER).forEach { action ->
      val intent = Intent(context, RequestAlertActionReceiver::class.java).setAction(action)
      val flags = PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
      val pending = PendingIntent.getBroadcast(context, requestCode(requestId, action), intent, flags)
      if (pending != null) {
        manager.cancel(pending)
        pending.cancel()
      }
    }
  }

  private fun requestCode(requestId: String, action: String): Int {
    return 75000 + ((requestId + action).hashCode() and 0x0fff)
  }
}
