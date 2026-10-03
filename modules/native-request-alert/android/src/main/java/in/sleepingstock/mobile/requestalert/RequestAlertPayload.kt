package `in`.sleepingstock.mobile.requestalert

import android.content.Intent
import android.os.Bundle
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONArray
import org.json.JSONObject

data class RequestAlertPayload(
  val requestId: String,
  val requestNumber: String,
  val branchName: String,
  val totalItems: String,
  val totalQuantity: String,
  val round: String,
  val type: String = TYPE_BRANCH_REQUEST,
  val pickedByName: String = "",
  val actionsEnabled: Boolean = true,
) {
  fun toBundle(): Bundle {
    val bundle = Bundle()
    bundle.putString(KEY_REQUEST_ID, requestId)
    bundle.putString(KEY_REQUEST_NUMBER, requestNumber)
    bundle.putString(KEY_BRANCH_NAME, branchName)
    bundle.putString(KEY_TOTAL_ITEMS, totalItems)
    bundle.putString(KEY_TOTAL_QUANTITY, totalQuantity)
    bundle.putString(KEY_ROUND, round)
    bundle.putString(KEY_TYPE, type)
    bundle.putString(KEY_PICKED_BY_NAME, pickedByName)
    bundle.putString(KEY_ACTIONS, if (actionsEnabled) "all" else "none")
    return bundle
  }

  fun toMap(): Map<String, String> = mapOf(
    KEY_REQUEST_ID to requestId,
    KEY_REQUEST_NUMBER to requestNumber,
    KEY_BRANCH_NAME to branchName,
    KEY_TOTAL_ITEMS to totalItems,
    KEY_TOTAL_QUANTITY to totalQuantity,
    KEY_ROUND to round,
    KEY_TYPE to type,
    KEY_PICKED_BY_NAME to pickedByName,
    KEY_ACTIONS to if (actionsEnabled) "all" else "none",
    "request_group_key" to requestId,
    "request_number" to requestNumber,
    "requesting_branch" to branchName,
    "requested_branch" to branchName,
    "total_items" to totalItems,
    "total_qty" to totalQuantity,
    "type" to type,
    "picked_by_name" to pickedByName,
  )

  fun canShowSnooze(): Boolean {
    if (!actionsEnabled || type != TYPE_BRANCH_REQUEST) return false
    val roundValue = round.toIntOrNull() ?: 0
    return roundValue < 2
  }

  fun canShowPick(): Boolean = actionsEnabled && type == TYPE_BRANCH_REQUEST

  fun isTransfer(): Boolean = type == TYPE_REQUEST_TRANSFERRED

  companion object {
    const val TYPE_BRANCH_REQUEST = "branch_request"
    const val TYPE_REQUEST_PICKED = "request_picked"
    const val TYPE_REQUEST_TRANSFERRED = "request_transferred"
    const val KEY_REQUEST_ID = "requestId"
    const val KEY_REQUEST_NUMBER = "requestNumber"
    const val KEY_BRANCH_NAME = "branchName"
    const val KEY_TOTAL_ITEMS = "totalItems"
    const val KEY_TOTAL_QUANTITY = "totalQuantity"
    const val KEY_ROUND = "round"
    const val KEY_TYPE = "type"
    const val KEY_PICKED_BY_NAME = "pickedByName"
    const val KEY_ACTIONS = "actions"

    fun isRequestAlert(data: Map<String, String>?): Boolean {
      if (data.isNullOrEmpty()) return false
      val type = data["type"]?.trim().orEmpty()
      if (type == "auto_perpetual") return false
      return type == "branch_request"
    }

    /**
     * Expo SDK 54 puts website custom fields in RemoteMessage.data["body"] as a
     * JSON string (NotificationData.body). Flatten that JSON — and a nested
     * "data" object when present — so classification can see type,
     * request_group_key, branch, items, quantity, and value.
     */
    fun flattenRemoteMessageData(message: RemoteMessage): Map<String, String> {
      val flat = linkedMapOf<String, String>()
      message.data.forEach { (key, value) ->
        val text = value?.trim().orEmpty()
        if (text.isNotEmpty()) flat[key] = text
      }
      val rawBody = message.data["body"]
      val bodyPresent = !rawBody.isNullOrBlank()
      var parseOk = false
      var nestedData = false
      if (bodyPresent) {
        try {
          val json = JSONObject(rawBody)
          parseOk = true
          nestedData = json.optJSONObject("data") != null
          mergeJsonObject(flat, json)
        } catch (_error: Exception) {
          parseOk = false
        }
      }
      RequestAlertLog.i(
        "payload parse body_present=$bodyPresent parse_ok=$parseOk nested_data=$nestedData flattened_keys=${flat.keys.sorted()}"
      )
      return flat
    }

    fun classifyType(data: Map<String, String>): String {
      return when (data["type"]?.trim()) {
        TYPE_BRANCH_REQUEST -> TYPE_BRANCH_REQUEST
        TYPE_REQUEST_PICKED -> TYPE_REQUEST_PICKED
        TYPE_REQUEST_TRANSFERRED -> TYPE_REQUEST_TRANSFERRED
        "auto_perpetual" -> "auto_perpetual"
        null, "" -> "empty"
        else -> "other"
      }
    }

    fun classifyAndParse(message: RemoteMessage): Pair<String, RequestAlertPayload?> {
      val data = flattenRemoteMessageData(message)
      val typeLabel = classifyType(data)
      val classified = typeLabel == TYPE_BRANCH_REQUEST
      RequestAlertLog.i("classification type=$typeLabel result=$classified")
      if (typeLabel != TYPE_BRANCH_REQUEST && typeLabel != TYPE_REQUEST_PICKED && typeLabel != TYPE_REQUEST_TRANSFERRED) {
        return typeLabel to null
      }
      val payload = fromMap(data)
      if (typeLabel == TYPE_BRANCH_REQUEST) {
        RequestAlertLog.i(
          "parsed requestId_present=${payload.requestId.isNotBlank()} " +
            "request_number_present=${payload.requestNumber.isNotBlank()} " +
            "branch_present=${payload.branchName.isNotBlank()} " +
            "items_present=${payload.totalItems.isNotBlank()} " +
            "qty_present=${payload.totalQuantity.isNotBlank()}"
        )
      }
      return typeLabel to payload
    }

    fun fromRemoteMessage(message: RemoteMessage): RequestAlertPayload? {
      val (typeLabel, payload) = classifyAndParse(message)
      return if (typeLabel == TYPE_BRANCH_REQUEST) payload else null
    }

    fun fromMap(data: Map<String, String>): RequestAlertPayload {
      val requestId = first(data, KEY_REQUEST_ID, "request_group_key", "request_id")
      val requestNumber = first(data, KEY_REQUEST_NUMBER, "request_number")
      val type = first(data, KEY_TYPE, "type").ifEmpty { TYPE_BRANCH_REQUEST }
      val actions = first(data, KEY_ACTIONS, "actions")
      return RequestAlertPayload(
        requestId = requestId.ifEmpty { requestNumber },
        requestNumber = requestNumber,
        branchName = first(data, KEY_BRANCH_NAME, "requesting_branch", "requested_branch"),
        totalItems = first(data, KEY_TOTAL_ITEMS, "total_items"),
        totalQuantity = first(data, KEY_TOTAL_QUANTITY, "total_quantity", "total_qty"),
        round = first(data, KEY_ROUND, "kind").let { kindToRound(it) },
        type = type,
        pickedByName = first(data, KEY_PICKED_BY_NAME, "picked_by_name"),
        actionsEnabled = type != TYPE_REQUEST_TRANSFERRED && actions != "none",
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

    private fun mergeJsonObject(target: MutableMap<String, String>, json: JSONObject) {
      val keys = json.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        val value = json.opt(key) ?: continue
        if (value == JSONObject.NULL) continue
        when (value) {
          is JSONObject -> {
            if (key == "data") mergeJsonObject(target, value)
          }
          is JSONArray -> Unit
          else -> {
            val text = value.toString().trim()
            if (text.isNotEmpty()) target[key] = text
          }
        }
      }
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
