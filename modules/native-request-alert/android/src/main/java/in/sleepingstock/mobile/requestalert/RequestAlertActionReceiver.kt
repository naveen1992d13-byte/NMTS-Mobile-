package `in`.sleepingstock.mobile.requestalert

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import kotlin.concurrent.thread

/**
 * Handles Pick / Snooze from the ongoing lock-screen notification.
 * Pick calls the server claim first. A notification body tap never
 * reaches this receiver and must not Pick or stop the ring.
 */
class RequestAlertActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = RequestAlertPayload.fromIntent(intent)
    val pending = goAsync()
    thread {
      try {
        when (intent.action) {
          RequestAlertRingingService.ACTION_PICK -> handlePick(context, payload)
          RequestAlertRingingService.ACTION_SNOOZE -> handleSnooze(context, payload)
        }
      } finally {
        pending.finish()
      }
    }
  }

  private fun handlePick(context: Context, payload: RequestAlertPayload) {
    val valid = RequestAlertApi.shouldKeepRinging(context, payload)
    if (valid == false) {
      RequestAlertController.handlePicked(context, payload.requestId)
      return
    }
    val result = RequestAlertApi.claimPick(context, payload.requestId.ifBlank { payload.requestNumber })
    if (result.ok) {
      RequestAlertLog.i("notification pick claimed")
      RequestAlertStore.markPicked(context, payload.requestId)
      RequestAlertController.stopForRequest(context, payload.requestId)
      RequestAlertModule.emitPick(payload)
      RequestAlertController.openAppOnRequest(context, payload)
    } else if (result.alreadyPicked || result.code == "ALREADY_PICKED") {
      val name = result.pickedByName.ifBlank { "another user" }
      Handler(Looper.getMainLooper()).post {
        Toast.makeText(context.applicationContext, "Already picked by $name", Toast.LENGTH_LONG).show()
      }
      RequestAlertController.handlePicked(context, payload.requestId, name)
    } else {
      RequestAlertLog.e("notification pick failed ${result.message}")
    }
  }

  private fun handleSnooze(context: Context, payload: RequestAlertPayload) {
    if (!payload.canShowSnooze()) {
      return
    }
    val valid = RequestAlertApi.shouldKeepRinging(context, payload)
    if (valid == false) {
      RequestAlertController.handlePicked(context, payload.requestId)
      return
    }
    val result = RequestAlertApi.skipSnooze(context, payload.requestId.ifBlank { payload.requestNumber })
    if (result.ok) {
      RequestAlertRingingService.stop(context, payload.requestId)
      RequestAlertModule.emitSnooze(payload)
    } else if (result.alreadyPicked || result.code == "ALREADY_PICKED") {
      val name = result.pickedByName.ifBlank { "another user" }
      Handler(Looper.getMainLooper()).post {
        Toast.makeText(context.applicationContext, "Already picked by $name", Toast.LENGTH_LONG).show()
      }
      RequestAlertController.handlePicked(context, payload.requestId, name)
    }
  }
}
