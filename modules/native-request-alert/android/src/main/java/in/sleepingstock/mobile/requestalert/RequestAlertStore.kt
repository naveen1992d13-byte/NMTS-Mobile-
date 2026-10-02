package `in`.sleepingstock.mobile.requestalert

import android.content.Context
import org.json.JSONObject

internal object RequestAlertStore {
  private const val PREFS = "nmts_request_alert_store"
  private const val KEY_TOKEN = "session_token"
  private const val KEY_BASE = "api_base_url"
  private const val KEY_ACTIVE = "active_alert_json"
  private const val KEY_PICKED = "picked_ids"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun saveAuth(context: Context, token: String, baseUrl: String) {
    prefs(context).edit().putString(KEY_TOKEN, token).putString(KEY_BASE, baseUrl).apply()
  }

  fun clearAuth(context: Context) {
    prefs(context).edit().remove(KEY_TOKEN).remove(KEY_BASE).apply()
  }

  fun sessionToken(context: Context): String = prefs(context).getString(KEY_TOKEN, "") ?: ""

  fun apiBaseUrl(context: Context): String = prefs(context).getString(KEY_BASE, "") ?: ""

  fun persistActiveAlert(context: Context, payload: RequestAlertPayload) {
    val json = JSONObject()
    payload.toMap().forEach { (key, value) -> json.put(key, value) }
    prefs(context).edit().putString(KEY_ACTIVE, json.toString()).apply()
  }

  fun clearActiveAlert(context: Context) {
    prefs(context).edit().remove(KEY_ACTIVE).apply()
  }

  fun loadActiveAlert(context: Context): RequestAlertPayload? {
    val raw = prefs(context).getString(KEY_ACTIVE, null) ?: return null
    return try {
      val json = JSONObject(raw)
      val map = mutableMapOf<String, String>()
      val keys = json.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        map[key] = json.optString(key)
      }
      RequestAlertPayload.fromMap(map)
    } catch (_error: Exception) {
      null
    }
  }

  fun markPicked(context: Context, requestId: String) {
    if (requestId.isBlank()) return
    val next = pickedIds(context).toMutableSet()
    next.add(requestId)
    prefs(context).edit().putStringSet(KEY_PICKED, next).apply()
  }

  fun isPicked(context: Context, requestId: String): Boolean {
    if (requestId.isBlank()) return false
    return pickedIds(context).contains(requestId)
  }

  private fun pickedIds(context: Context): Set<String> {
    return prefs(context).getStringSet(KEY_PICKED, emptySet()) ?: emptySet()
  }
}
