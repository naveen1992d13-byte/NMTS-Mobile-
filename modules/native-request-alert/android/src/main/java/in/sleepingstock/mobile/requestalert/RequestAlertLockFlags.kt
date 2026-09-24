package `in`.sleepingstock.mobile.requestalert

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager

/**
 * Applies showWhenLocked / turnScreenOn only for the incoming-request
 * full-screen-intent path. MainActivity is never given those flags in
 * the manifest, so a normal launch cannot open the app over the lock screen.
 */
object RequestAlertLockFlags {
  const val EXTRA_FROM_LOCK_GATE = "in.sleepingstock.mobile.requestalert.FROM_LOCK_GATE"

  @Volatile
  private var registered = false

  @Volatile
  private var pendingLockBypass = false

  fun markPendingLockBypass() {
    pendingLockBypass = true
  }

  fun registerOnce(application: Application) {
    if (registered) return
    registered = true
    application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        applyIfNeeded(activity)
      }

      override fun onActivityStarted(activity: Activity) {
        applyIfNeeded(activity)
      }

      override fun onActivityResumed(activity: Activity) {
        applyIfNeeded(activity)
      }

      override fun onActivityPaused(activity: Activity) {}
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
  }

  fun applyIfNeeded(activity: Activity) {
    val fromExtra = activity.intent?.getBooleanExtra(EXTRA_FROM_LOCK_GATE, false) == true
    if (!fromExtra && !pendingLockBypass) return
    apply(activity)
    if (activity !is RequestAlertLockGateActivity) {
      pendingLockBypass = false
    }
  }

  fun apply(activity: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(true)
      activity.setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      activity.window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val km = activity.getSystemService(KeyguardManager::class.java)
        km?.requestDismissKeyguard(activity, null)
      } catch (_: Throwable) {
      }
    }
  }

  fun clear(activity: Activity?) {
    if (activity == null) return
    pendingLockBypass = false
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(false)
        activity.setTurnScreenOn(false)
      }
    } catch (_: Throwable) {
    }
  }
}
