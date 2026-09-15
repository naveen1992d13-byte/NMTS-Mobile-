package in.sleepingstock.mobile.requestalert

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Data-only FCM entry for stock-transfer request alerts.
 * Registered at a higher priority than Expo's Firebase service so request
 * alerts start the ringing foreground service immediately. Other pushes are
 * forwarded to expo-notifications.
 */
class RequestAlertFirebaseMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val payload = RequestAlertPayload.fromRemoteMessage(remoteMessage)
    if (payload != null) {
      // Do not defer — Android 12+ blocks background starts after a delay.
      RequestAlertRingingService.startNow(this, payload)
      return
    }
    forwardToExpo(remoteMessage)
  }

  override fun onNewToken(token: String) {
    forwardNewTokenToExpo(token)
  }

  private fun forwardToExpo(remoteMessage: RemoteMessage) {
    try {
      val clazz = Class.forName("expo.modules.notifications.service.delegates.FirebaseMessagingDelegate")
      val delegate = clazz.getConstructor(android.content.Context::class.java).newInstance(this)
      clazz.getMethod("onMessageReceived", RemoteMessage::class.java).invoke(delegate, remoteMessage)
    } catch (_: Throwable) {
      // Non-request messages still require expo-notifications at runtime.
    }
  }

  private fun forwardNewTokenToExpo(token: String) {
    try {
      val clazz = Class.forName("expo.modules.notifications.service.delegates.FirebaseMessagingDelegate")
      val delegate = clazz.getConstructor(android.content.Context::class.java).newInstance(this)
      clazz.getMethod("onNewToken", String::class.java).invoke(delegate, token)
    } catch (_: Throwable) {
      // Token refresh still handled by expo-notifications when present.
    }
  }
}
