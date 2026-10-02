package `in`.sleepingstock.mobile.requestalert

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Sole registered handler for com.google.firebase.MESSAGING_EVENT.
 * Competing Expo / firebase-messaging stub services are removed from the
 * merged app manifest (tools:node="remove") because Android bindService
 * does not honor intent-filter priority for services — only one service
 * receives each event, and it was not guaranteed to be this one.
 *
 * Non-request messages, new tokens, and deleted-message callbacks
 * are forwarded to expo-notifications' FirebaseMessagingDelegate so Expo
 * push display and token registration keep working. This path is native
 * and does not use a JS background handler.
 */
class RequestAlertFirebaseMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val keys = remoteMessage.data.keys.sorted()
    RequestAlertLog.i(
      "onMessageReceived entry messageId=${remoteMessage.messageId} keys=$keys"
    )
    val (type, payload) = RequestAlertPayload.classifyAndParse(remoteMessage)
    val isBranchRequest = type == RequestAlertPayload.TYPE_BRANCH_REQUEST
    RequestAlertLog.i("branch_request classification result=$isBranchRequest")
    when (type) {
      RequestAlertPayload.TYPE_REQUEST_PICKED -> {
        val requestId = payload?.requestId.orEmpty()
        RequestAlertLog.i("request_picked received")
        RequestAlertController.handlePicked(this, requestId, payload?.pickedByName.orEmpty())
        RequestAlertModule.emitPicked(payload ?: RequestAlertPayload.fromMap(emptyMap()))
        return
      }
      RequestAlertPayload.TYPE_REQUEST_TRANSFERRED -> {
        if (payload == null) {
          RequestAlertLog.i("RequestAlertRingingService start decision=skip")
          return
        }
        RequestAlertLog.i("RequestAlertRingingService start decision=start")
        RequestAlertRingingService.startNow(this, payload)
        return
      }
      RequestAlertPayload.TYPE_BRANCH_REQUEST -> {
        if (payload == null) {
          RequestAlertLog.i("RequestAlertRingingService start decision=skip")
          return
        }
        if (RequestAlertStore.isPicked(this, payload.requestId)) {
          RequestAlertLog.i("late branch_request ignored picked marker")
          RequestAlertLog.i("RequestAlertRingingService start decision=skip")
          return
        }
        RequestAlertLog.i("RequestAlertRingingService start decision=start")
        RequestAlertRingingService.startNow(this, payload)
        return
      }
      else -> {
        RequestAlertLog.i("RequestAlertRingingService start decision=skip")
        RequestAlertLog.i("delegating non-branch_request to Expo FirebaseMessagingDelegate")
        forwardToExpo(remoteMessage)
      }
    }
  }

  override fun onNewToken(token: String) {
    RequestAlertLog.i("onNewToken")
    forwardNewTokenToExpo(token)
  }

  override fun onDeletedMessages() {
    RequestAlertLog.i("onDeletedMessages")
    forwardDeletedMessagesToExpo()
  }

  private fun forwardToExpo(remoteMessage: RemoteMessage) {
    try {
      val clazz = Class.forName("expo.modules.notifications.service.delegates.FirebaseMessagingDelegate")
      val delegate = clazz.getConstructor(android.content.Context::class.java).newInstance(this)
      clazz.getMethod("onMessageReceived", RemoteMessage::class.java).invoke(delegate, remoteMessage)
    } catch (error: Throwable) {
      RequestAlertLog.e("Expo delegate onMessageReceived failed", error)
    }
  }

  private fun forwardNewTokenToExpo(token: String) {
    try {
      val clazz = Class.forName("expo.modules.notifications.service.delegates.FirebaseMessagingDelegate")
      val delegate = clazz.getConstructor(android.content.Context::class.java).newInstance(this)
      clazz.getMethod("onNewToken", String::class.java).invoke(delegate, token)
    } catch (error: Throwable) {
      RequestAlertLog.e("Expo delegate onNewToken failed", error)
    }
  }

  private fun forwardDeletedMessagesToExpo() {
    try {
      val clazz = Class.forName("expo.modules.notifications.service.delegates.FirebaseMessagingDelegate")
      val delegate = clazz.getConstructor(android.content.Context::class.java).newInstance(this)
      clazz.getMethod("onDeletedMessages").invoke(delegate)
    } catch (error: Throwable) {
      RequestAlertLog.e("Expo delegate onDeletedMessages failed", error)
    }
  }
}
