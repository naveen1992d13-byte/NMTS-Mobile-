package `in`.sleepingstock.mobile.requestalert

import android.content.Intent
import android.os.Bundle
import com.google.firebase.messaging.RemoteMessage

data class RequestAlertPayload(
  val requestId: String,
  val requestNumber: String,
  val branchName: String,
  val totalItems: String,
  val totalQuantity: String,
  val round: String,
) {
  fun toBundle(): Bundle {
    val bundle = Bundle()
    bundle.putString(KEY_REQUEST_ID, requestId)
    bundle.putString(KEY_REQUEST_NUMBER, requestNumber)
    bundle.putString(KEY_BRANCH_NAME, branchName)
    bundle.putString(KEY_TOTAL_ITEMS, totalItems)
    bundle.putString(KEY_TOTAL_QUANTITY, totalQuantity)
    bundle.putString(KEY_ROUND, round)
    return bundle
  }

  fun toMap(): Map<String, String> = mapOf(
    KEY_REQUEST_ID to requestId,
    KEY_REQUEST_NUMBER to requestNumber,
    KEY_BRANCH_NAME to branchName,
    KEY_TOTAL_ITEMS to totalItems,
    KEY_TOTAL_QUANTITY to totalQuantity,
    KEY_ROUND to round,
    "request_group_key" to requestId,
    "request_number" to requestNumber,
    "requesting_branch" to branchName,
    "requested_branch" to branchName,
    "total_items" to totalItems,
    "total_qty" to totalQuantity,
    "type" to "branch_request",
  )

  companion object {
    const val KEY_REQUEST_ID = "requestId"
    const val KEY_REQUEST_NUMBER = "requestNumber"
    const val KEY_BRANCH_NAME = "branchName"
    const val KEY_TOTAL_ITEMS = "totalItems"
    const val KEY_TOTAL_QUANTITY = "totalQuantity"
    const val KEY_ROUND = "round"

    fun isRequestAlert(data: Map<String, String>?): Boolean {
      if (data.isNullOrEmpty()) return false
      if (data["type"] == "auto_perpetual") return false
      return data["type"] == "branch_request" ||
        data["screen"] == "request" ||
        first(data, KEY_REQUEST_ID, "request_group_key").isNotEmpty() ||
        first(data, KEY_REQUEST_NUMBER, "request_number").isNotEmpty()
    }

    fun fromRemoteMessage(message: RemoteMessage): RequestAlertPayload? {
      val data = message.data ?: return null
      if (!isRequestAlert(data)) return null
      return fromMap(data)
    }

    fun fromMap(data: Map<String, String>): RequestAlertPayload {
      val requestId = first(data, KEY_REQUEST_ID, "request_group_key", "request_id")
      val requestNumber = first(data, KEY_REQUEST_NUMBER, "request_number")
      return RequestAlertPayload(
        requestId = requestId.ifEmpty { requestNumber },
        requestNumber = requestNumber,
        branchName = first(data, KEY_BRANCH_NAME, "requesting_branch", "requested_branch"),
        totalItems = first(data, KEY_TOTAL_ITEMS, "total_items"),
        totalQuantity = first(data, KEY_TOTAL_QUANTITY, "total_quantity", "total_qty"),
        round = first(data, KEY_ROUND, "kind").let { kindToRound(it) },
      )
    }

    fun fromIntent(intent: Intent?): RequestAlertPayload {
      val extras = intent?.extras
      val data = mutableMapOf<String, String>()
      extras?.keySet()?.forEach { key ->
        extras.getString(key)?.let { data[key] = it }
      }
      return fromMap(data)
    }

    fun fromBundle(bundle: Bundle?): RequestAlertPayload {
      val data = mutableMapOf<String, String>()
      bundle?.keySet()?.forEach { key ->
        bundle.getString(key)?.let { data[key] = it }
      }
      return fromMap(data)
    }

    private fun first(data: Map<String, String>, vararg keys: String): String {
      for (key in keys) {
        val value = data[key]?.trim().orEmpty()
        if (value.isNotEmpty()) return value
      }
      return ""
    }

    private fun kindToRound(raw: String): String {
      return when (raw) {
        "new" -> "0"
        "reminder_1" -> "1"
        "reminder_2" -> "2"
        "reminder_3" -> "3"
        else -> raw.ifEmpty { "0" }
      }
    }
  }
}
