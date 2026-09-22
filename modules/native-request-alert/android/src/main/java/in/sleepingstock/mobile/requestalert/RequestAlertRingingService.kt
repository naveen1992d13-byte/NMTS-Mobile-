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

/**
 * Foreground media-playback service that loops the existing custom request
 * sound until Pick or Snooze. Does not use full-screen intent and does not
 * auto-launch an Activity when the alert starts.
 */
class RequestAlertRingingService : Service() {
  private var mediaPlayer: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var currentPayload: RequestAlertPayload? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopRinging()
      return START_NOT_STICKY
    }
    val payload = RequestAlertPayload.fromIntent(intent)
    currentPayload = payload
    val notification = buildNotification(payload)
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    acquireWakeLock()
    startLoopingSound()
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app must not stop the ring. Only Pick/Snooze stop it.
  }

  override fun onDestroy() {
    releasePlayer()
    releaseWakeLock()
    val manager = getSystemService(NotificationManager::class.java)
    manager?.cancel(NOTIFICATION_ID)
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
    } ?: return
    player.isLooping = true
    player.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
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
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_warning)
      .setContentTitle(payload.requestNumber.ifEmpty { "Incoming request" })
      .setContentText(content)
      .setStyle(NotificationCompat.BigTextStyle().bigText(content).setBigContentTitle(payload.requestNumber.ifEmpty { "Incoming request" }))
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setSound(null)
      .addAction(0, "Pick", actionPendingIntent(ACTION_PICK, payload, 11))
      .addAction(0, "Snooze", actionPendingIntent(ACTION_SNOOZE, payload, 12))
      .setContentIntent(bodyTapPendingIntent())
    // No full-screen intent (do not auto-launch an Activity when the alert starts).
    // Body tap only brings the app forward — it does NOT stop the ring or Pick the request.
    // Only the Pick/Snooze actions above do that.
    return builder.build()
  }

  private fun bodyTapPendingIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(this, 13, launch, flags)
  }

  private fun actionPendingIntent(action: String, payload: RequestAlertPayload, requestCode: Int): PendingIntent {
    val intent = Intent(this, RequestAlertActionReceiver::class.java).setAction(action).putExtras(payload.toBundle())
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(this, requestCode, intent, flags)
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

  private fun stopRinging() {
    releasePlayer()
    releaseWakeLock()
    @Suppress("DEPRECATION")
    stopForeground(true)
    val manager = getSystemService(NotificationManager::class.java)
    manager?.cancel(NOTIFICATION_ID)
    stopSelf()
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
      val intent = Intent(context, RequestAlertRingingService::class.java).putExtras(payload.toBundle())
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context, requestId: String? = null) {
      // stopService — do not startForegroundService just to stop (Android 12+ crash).
      val intent = Intent(context, RequestAlertRingingService::class.java).setAction(ACTION_STOP)
      if (!requestId.isNullOrBlank()) {
        intent.putExtra(RequestAlertPayload.KEY_REQUEST_ID, requestId)
      }
      context.stopService(Intent(context, RequestAlertRingingService::class.java))
    }
  }
}
