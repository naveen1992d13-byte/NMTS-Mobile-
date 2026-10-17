package `in`.sleepingstock.mobile.requestalert

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import kotlin.concurrent.thread

/**
 * Handles Pick / Reject from the ongoing lock-screen notification.
 * Pick calls the server claim first. Reject stops the ring and opens the app
 * so JS can collect a mandatory reason. A notification body tap never
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
          RequestAlertRingingService.ACTION_REJECT -> handleReject(context, payload)
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
      val message = result.message.ifBlank {
        "This request was already picked by another dealer."
      }
      Handler(Looper.getMainLooper()).post {
        Toast.makeText(context.applicationContext, message, Toast.LENGTH_LONG).show()
      }
      RequestAlertController.handlePicked(context, payload.requestId, result.pickedByName)
    } else {
      RequestAlertLog.e("notification pick failed ${result.message}")
    }
  }

  /**
   * Notification Reject has no reason field — stop ringing, emitReject, and
   * open the app so JS can collect the mandatory reason (and call reject API).
   */
  private fun handleReject(context: Context, payload: RequestAlertPayload) {
    if (!payload.canShowReject()) {
      return
    }
    val valid = RequestAlertApi.shouldKeepRinging(context, payload)
    if (valid == false) {
      RequestAlertController.handlePicked(context, payload.requestId)
      return
    }
    RequestAlertLog.i("notification reject — defer reason to JS")
    RequestAlertController.stopForRequest(context, payload.requestId)
    RequestAlertModule.emitReject(payload)
    RequestAlertController.openAppOnRequest(context, payload)
  }
}
