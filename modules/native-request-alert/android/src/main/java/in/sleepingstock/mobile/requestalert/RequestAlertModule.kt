package `in`.sleepingstock.mobile.requestalert

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class RequestAlertModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeRequestAlert")
    Events("onPick", "onSnooze")

    OnCreate {
      instance = WeakReference(this@RequestAlertModule)
    }

    OnDestroy {
      if (instance?.get() === this@RequestAlertModule) {
        instance = null
      }
    }

    OnStartObserving {
      flushPending()
    }

    Function("stopRinging") { requestId: String? ->
      val context = appContext.reactContext ?: appContext.currentActivity ?: return@Function
      RequestAlertRingingService.stop(context, requestId)
    }

    // True if the OS is already free to wake this app in Doze / app-standby
    // for FCM delivery. False means background push delivery (and therefore
    // ringing while the app is closed / screen locked) can be delayed or
    // dropped by the OS battery manager — most common on Samsung One UI.
    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function true
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      return@Function pm?.isIgnoringBatteryOptimizations(context.packageName) ?: true
    }

    // Opens the system dialog that lets the user directly whitelist this
    // app from battery optimization. This is the standard Android API;
    // Samsung devices additionally have their own "Put unused apps to
    // sleep" / "Auto start" toggles under Settings > Apps > [app] > Battery
    // that this dialog does not control, so the JS side should still show
    // the manual-steps guidance as a fallback.
    Function("requestIgnoreBatteryOptimizations") {
      val context = appContext.reactContext ?: appContext.currentActivity ?: return@Function Unit
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function Unit
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (pm?.isIgnoringBatteryOptimizations(context.packageName) == true) return@Function Unit
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      } catch (_: Throwable) {
        // Some OEM builds (incl. some Samsung firmwares) block this intent;
        // fall back to the general battery-optimization settings screen.
        try {
          val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(fallback)
        } catch (_: Throwable) {
        }
      }
    }
  }

  private fun emitMap(event: String, payload: RequestAlertPayload) {
    val body = Bundle()
    payload.toMap().forEach { (key, value) -> body.putString(key, value) }
    sendEvent(event, body)
  }

  companion object {
    private var instance: WeakReference<RequestAlertModule>? = null
    private var pendingEvent: Pair<String, RequestAlertPayload>? = null

    fun emitPick(payload: RequestAlertPayload) = emitOrQueue("onPick", payload)

    fun emitSnooze(payload: RequestAlertPayload) = emitOrQueue("onSnooze", payload)

    private fun emitOrQueue(event: String, payload: RequestAlertPayload) {
      val module = instance?.get()
      if (module != null) {
        try {
          module.emitMap(event, payload)
          pendingEvent = null
          return
        } catch (_: Throwable) {
        }
      }
      pendingEvent = event to payload
    }
  }

  private fun flushPending() {
    val pending = pendingEvent ?: return
    try {
      emitMap(pending.first, pending.second)
      pendingEvent = null
    } catch (_: Throwable) {
    }
  }
}
