package `in`.sleepingstock.mobile.requestalert

import android.util.Log

/** Consistent native log tag. Never log payload values — keys and messageId only. */
internal object RequestAlertLog {
  const val TAG = "RequestAlert"

  fun i(message: String) {
    Log.i(TAG, message)
  }

  fun e(message: String, error: Throwable? = null) {
    if (error == null) {
      Log.e(TAG, message)
    } else {
      Log.e(TAG, "$message ${error.javaClass.simpleName}")
    }
  }
}
