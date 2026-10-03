package `in`.sleepingstock.mobile.requestalert

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

/**
 * Foreground media-playback service that loops the custom request sound
 * until Pick, Snooze, request_picked, or a server-status invalidation.
 * START_NOT_STICKY: the OS will not auto-restart a killed FGS. A persisted
 * alert is restored + validated if this service is created again.
 *
 * There is NO maximum ring duration. The mandatory 3rd alert rings until Pick.
 */
class RequestAlertRingingService : Service() {
  private var mediaPlayer: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var currentPayload: RequestAlertPayload? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      val stopId = intent.getStringExtra(RequestAlertPayload.KEY_REQUEST_ID).orEmpty()
      val currentId = currentPayload?.requestId.orEmpty()
      if (stopId.isBlank() || currentId.isBlank() || stopId == currentId || stopId == currentPayload?.requestNumber) {
        stopRingingInternal()
      } else {
        cancelNotification(stopId)
      }
      return START_NOT_STICKY
    }

    if (RequestAlertStore.sessionToken(this).isBlank()) {
      RequestAlertLog.i("RequestAlertRingingService start decision=skip no session")
      RequestAlertStore.clearActiveAlert(this)
      stopSelf()
      return START_NOT_STICKY
    }

    val fromIntent = if (intent == null) null else RequestAlertPayload.fromIntent(intent)
    val restored = intent == null
    val payload = when {
      fromIntent != null && (fromIntent.requestId.isNotBlank() || fromIntent.requestNumber.isNotBlank()) -> fromIntent
      else -> RequestAlertStore.loadActiveAlert(this)
    }
    if (payload == null || (payload.requestId.isBlank() && payload.requestNumber.isBlank())) {
      RequestAlertLog.i("blank payload rejected restored=$restored intent_null=${intent == null}")
      stopSelf()
      return START_NOT_STICKY
    }

    currentPayload = payload
    RequestAlertStore.persistActiveAlert(this, payload)
    synchronized(startLock) {
      activeRequestId = payload.requestId.ifBlank { payload.requestNumber }
    }

    val canFsi = canUseFullScreenIntent()
    RequestAlertLog.i("canUseFullScreenIntent result=$canFsi restored=$restored")
    val notification = buildNotification(payload)
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(
          notificationIdFor(payload.requestId),
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        )
      } else {
        startForeground(notificationIdFor(payload.requestId), notification)
      }
      RequestAlertLog.i("startForeground and notification post success")
    } catch (error: Throwable) {
      RequestAlertLog.e("startForeground and notification post failure", error)
    }
    acquireWakeLock()
    startLoopingSound()
    thread {
      val valid = RequestAlertApi.shouldKeepRinging(this, payload)
      if (valid == false) {
        RequestAlertLog.i("server validation stopped stale ring")
        RequestAlertController.handlePicked(this, payload.requestId)
      }
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app must not stop the ring. Only Pick/Snooze/request_picked stop it.
  }

  override fun onDestroy() {
    releasePlayer()
    releaseWakeLock()
    super.onDestroy()
  }

  private fun startLoopingSound() {
    if (mediaPlayer?.isPlaying == true) return
    releasePlayer()
    val resId = resources.getIdentifier(SOUND_RESOURCE, "raw", packageName)
    val player = if (resId != 0) {
      MediaPlayer.create(this, resId)
    } else {
      MediaPlayer.create(this, resources.getIdentifier(SOUND_RESOURCE, "raw", applicationContext.packageName))
    } ?: run {
      RequestAlertLog.e("MediaPlayer create failed")
      return
    }
    player.isLooping = true
    player.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    )
    player.setVolume(1f, 1f)
    player.start()
    mediaPlayer = player
  }

  private fun buildNotification(payload: RequestAlertPayload): Notification {
    ensureChannel()
    val content = buildString {
      append("Requested Branch: ${payload.branchName.ifEmpty { "—" }}\n")
      append("Total Items: ${payload.totalItems.ifEmpty { "0" }}\n")
      append("Total Quantity: ${payload.totalQuantity.ifEmpty { "0" }}")
    }
    val title = if (payload.isTransfer()) {
      payload.requestNumber.ifEmpty { "Request transferred" }
    } else {
      payload.requestNumber.ifEmpty { "Incoming request" }
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_warning)
      .setContentTitle(title)
      .setContentText(content)
      .setStyle(NotificationCompat.BigTextStyle().bigText(content).setBigContentTitle(title))
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setSound(null)
      .setContentIntent(bodyTapPendingIntent(payload))
      .setFullScreenIntent(fullScreenPendingIntent(payload), true)
    if (payload.canShowPick()) {
      builder.addAction(0, "Pick", actionPendingIntent(ACTION_PICK, payload, 11))
    }
    if (payload.canShowSnooze()) {
      builder.addAction(0, "Snooze", actionPendingIntent(ACTION_SNOOZE, payload, 12))
    }
    // Body tap only brings the app forward — it does NOT stop the ring or Pick the request.
    return builder.build()
  }

  private fun canUseFullScreenIntent(): Boolean {
    if (Build.VERSION.SDK_INT < 34) return true
    val nm = getSystemService(NotificationManager::class.java)
    return nm?.canUseFullScreenIntent() == true
  }

  private fun bodyTapPendingIntent(payload: RequestAlertPayload): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.putExtra(RequestAlertPayload.KEY_REQUEST_ID, payload.requestId)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(this, requestCode(payload.requestId, 13), launch, flags)
  }

  private fun fullScreenPendingIntent(payload: RequestAlertPayload): PendingIntent {
    val intent = Intent(this, RequestAlertLockGateActivity::class.java).apply {
      putExtras(payload.toBundle())
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_NO_USER_ACTION
      )
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(this, requestCode(payload.requestId, 14), intent, flags)
  }

  private fun actionPendingIntent(action: String, payload: RequestAlertPayload, requestCodeBase: Int): PendingIntent {
    val intent = Intent(this, RequestAlertActionReceiver::class.java).setAction(action).putExtras(payload.toBundle())
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(this, requestCode(payload.requestId, requestCodeBase), intent, flags)
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Incoming stock requests",
      NotificationManager.IMPORTANCE_HIGH,
    )
    channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    channel.setSound(null, null)
    channel.enableVibration(true)
    channel.setBypassDnd(false)
    manager.createNotificationChannel(channel)
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
    lock.setReferenceCounted(false)
    lock.acquire()
    wakeLock = lock
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) wakeLock?.release()
    } catch (_: Throwable) {
    }
    wakeLock = null
  }

  private fun releasePlayer() {
    try {
      mediaPlayer?.stop()
    } catch (_: Throwable) {
    }
    try {
      mediaPlayer?.release()
    } catch (_: Throwable) {
    }
    mediaPlayer = null
  }

  private fun stopRingingInternal() {
    val id = currentPayload?.requestId.orEmpty()
    releasePlayer()
    releaseWakeLock()
    @Suppress("DEPRECATION")
    stopForeground(true)
    cancelNotification(id)
    clearActiveRequest()
    RequestAlertStore.clearActiveAlert(this)
    stopSelf()
  }

  private fun cancelNotification(requestId: String) {
    val manager = getSystemService(NotificationManager::class.java)
    manager?.cancel(notificationIdFor(requestId))
    manager?.cancel(NOTIFICATION_ID)
  }

  companion object {
    const val CHANNEL_ID = "nmts-native-request-alert"
    const val NOTIFICATION_ID = 74101
    const val ACTION_PICK = "in.sleepingstock.mobile.requestalert.PICK"
    const val ACTION_SNOOZE = "in.sleepingstock.mobile.requestalert.SNOOZE"
    const val ACTION_STOP = "in.sleepingstock.mobile.requestalert.STOP"
    private const val WAKE_LOCK_TAG = "nmts:request-alert"
    private const val SOUND_RESOURCE = "sleeping_stock_alert_2_rising_dispatch"

    fun startNow(context: Context, payload: RequestAlertPayload) {
      if (RequestAlertStore.sessionToken(context).isBlank()) {
        RequestAlertLog.i("RequestAlertRingingService start decision=skip no session")
        RequestAlertStore.clearActiveAlert(context)
        return
      }
      val id = payload.requestId.ifBlank { payload.requestNumber }
      if (id.isBlank()) {
        RequestAlertLog.i("blank payload rejected")
        return
      }
      if (RequestAlertStore.isPicked(context, id) && !payload.isTransfer()) {
        RequestAlertLog.i("late branch_request ignored picked marker")
        return
      }
      synchronized(startLock) {
        if (id.isNotBlank() && activeRequestId == id) {
          RequestAlertLog.i("duplicate rejection")
          return
        }
        if (!activeRequestId.isNullOrBlank() && activeRequestId != id) {
          context.getSystemService(NotificationManager::class.java)?.cancel(notificationIdFor(activeRequestId!!))
        }
        activeRequestId = id
      }
      RequestAlertStore.persistActiveAlert(context, payload)
      RequestAlertModule.emitIncoming(payload)
      val intent = Intent(context, RequestAlertRingingService::class.java).putExtras(payload.toBundle())
      try {
        RequestAlertLog.i("RequestAlertRingingService start attempt")
        ContextCompat.startForegroundService(context, intent)
        RequestAlertLog.i("RequestAlertRingingService startForegroundService issued")
      } catch (error: Throwable) {
        RequestAlertLog.e("RequestAlertRingingService start failure", error)
      }
    }

    fun stop(context: Context, requestId: String? = null) {
      val id = requestId.orEmpty()
      synchronized(startLock) {
        if (id.isNotBlank() && !activeRequestId.isNullOrBlank() && activeRequestId != id) {
          context.getSystemService(NotificationManager::class.java)?.cancel(notificationIdFor(id))
          RequestAlertAlarms.cancel(context, id)
          return
        }
        activeRequestId = null
      }
      RequestAlertLockFlags.clear(context as? android.app.Activity)
      // stopService — do not startForegroundService just to stop (Android 12+ crash).
      context.stopService(Intent(context, RequestAlertRingingService::class.java))
      if (id.isNotBlank()) {
        context.getSystemService(NotificationManager::class.java)?.cancel(notificationIdFor(id))
      }
    }

    fun clearActiveRequest() {
      synchronized(startLock) {
        activeRequestId = null
      }
    }

    fun notificationIdFor(requestId: String): Int {
      if (requestId.isBlank()) return NOTIFICATION_ID
      return 74000 + (requestId.hashCode() and 0x0fff)
    }

    private fun requestCode(requestId: String, base: Int): Int {
      return base * 1000 + (requestId.hashCode() and 0x0ff)
    }

    private val startLock = Any()

    @Volatile
    private var activeRequestId: String? = null
  }
}
