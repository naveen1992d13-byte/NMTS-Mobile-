package `in`.sleepingstock.mobile.requestalert

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

internal object RequestAlertApi {
  data class ClaimResult(
    val ok: Boolean,
    val alreadyPicked: Boolean,
    val pickedByName: String,
    val message: String,
    val code: String = "",
  )

  fun claimPick(context: Context, requestGroupKey: String): ClaimResult {
    return postAction(context, "/mobile/notifications/accept", JSONObject().put("request_group_key", requestGroupKey))
  }

  fun skipSnooze(context: Context, requestGroupKey: String): ClaimResult {
    return postAction(context, "/mobile/notifications/skip", JSONObject().put("request_group_key", requestGroupKey))
  }

  fun shouldKeepRinging(context: Context, payload: RequestAlertPayload): Boolean? {
    val token = RequestAlertStore.sessionToken(context)
    val base = RequestAlertStore.apiBaseUrl(context).trimEnd('/')
    if (token.isBlank() || base.isBlank()) return null
    val requestGroupKey = payload.requestId.ifBlank { payload.requestNumber }
    if (requestGroupKey.isBlank()) return false
    if (RequestAlertStore.isPicked(context, requestGroupKey) && !payload.isTransfer()) return false
    return try {
      val url = URL("$base/mobile/notifications")
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 8000
        readTimeout = 8000
        setRequestProperty("Authorization", "Bearer $token")
      }
      val code = conn.responseCode
      val body = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
      conn.disconnect()
      if (code !in 200..299) return null
      val rows = JSONArray(body)
      for (i in 0 until rows.length()) {
        val row = rows.optJSONObject(i) ?: continue
        val key = row.optString("request_group_key")
        val number = row.optString("request_number")
        if (key != requestGroupKey && number != requestGroupKey && key != payload.requestNumber && number != payload.requestNumber) {
          continue
        }
        val status = row.optString("status")
        val canPick = row.has("can_pick") && row.optBoolean("can_pick")
        val acceptedByMe = row.optBoolean("accepted_by_me", false)
        return if (payload.isTransfer()) {
          acceptedByMe && (status == "picked" || status.isBlank())
        } else {
          canPick || status.isBlank() || status == "pending"
        }
      }
      false
    } catch (error: Exception) {
      RequestAlertLog.e("native status validate failed", error)
      null
    }
  }

  private fun postAction(context: Context, path: String, payload: JSONObject): ClaimResult {
    val token = RequestAlertStore.sessionToken(context)
    val base = RequestAlertStore.apiBaseUrl(context).trimEnd('/')
    if (token.isBlank() || base.isBlank()) {
      return ClaimResult(false, false, "", "Device session not found")
    }
    return try {
      val url = URL("$base$path")
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 8000
        readTimeout = 8000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Authorization", "Bearer $token")
      }
      OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
      val code = conn.responseCode
      val body = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
      conn.disconnect()
      val json = body.trim().takeIf { it.startsWith("{") }?.let { JSONObject(it) }
      val detail = json?.opt("detail")
      val detailObj = detail as? JSONObject
      val name = detailObj?.optString("picked_by_name").orEmpty()
        .ifBlank { json?.optString("picked_by_name").orEmpty() }
      val message = detailObj?.optString("message").orEmpty()
        .ifBlank { json?.optString("message").orEmpty() }
      val errCode = detailObj?.optString("code").orEmpty()
        .ifBlank { json?.optString("code").orEmpty() }
      when {
        code in 200..299 -> ClaimResult(true, json?.optBoolean("already_owned") == true, name, message, errCode)
        code == 409 -> ClaimResult(false, errCode == "ALREADY_PICKED" || name.isNotBlank(), name.ifBlank { "another user" }, message, errCode)
        else -> ClaimResult(false, false, name, message.ifBlank { "Unable to pick" }, errCode)
      }
    } catch (error: Exception) {
      RequestAlertLog.e("native action failed path=$path", error)
      ClaimResult(false, false, "", "Unable to pick")
    }
  }
}
