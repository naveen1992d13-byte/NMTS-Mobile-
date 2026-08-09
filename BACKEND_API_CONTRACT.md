# Backend API contract required by Sleeping Stock Mobile 1.3.x

Mobile changes in this release prefer these backend capabilities. Until they are
deployed, the app falls back safely:

- Prefix stock search → exact `part_numbers` lookup
- Batch verification sync → parallel single POSTs (chunk size 8)

## 1. Stock search — Product Hub style prefix / description

Current mobile call:

```
GET /api/mobile/stock-search?q=26300&mode=prefix&limit=100
Authorization: Bearer <device session>
```

Required behaviour:

- Scope to the paired brand / dealer / branch
- Match `part_number` with case-insensitive **prefix / contains** regex
- Also match description fields (`part_name`, `item_name`, `description`) when present
- Return:

```json
{
  "results": [ /* product rows */ ],
  "not_found": []
}
```

Exact multi-part search must remain:

```
GET /api/mobile/stock-search?part_numbers=A%0AB%0AC
```

returning `results` + `not_found`.

## 2. Stock verification batch sync

Preferred:

```
POST /api/mobile/stock-verification/batch
Authorization: Bearer <device session>
Content-Type: application/json

{
  "items": [
    {
      "part_number": "26300B1000",
      "part_name": "...",
      "physical_qty": 2,
      "location": "A1",
      "remark": "",
      "entry_method": "MANUAL_OR_CAMERA",
      "client_id": "uuid",
      "verification_session_id": "optional-ignored-if-backend-authoritative",
      "is_new_part": false,
      "verification_type": "auto",
      "damage_qty": 0
    }
  ]
}
```

Response:

```json
{
  "success": true,
  "synced": 1,
  "failed": 0,
  "results": [
    {
      "client_id": "uuid",
      "success": true,
      "id": "...",
      "duplicate": false
    }
  ]
}
```

Idempotency must continue to use `(device_id, client_id)`.

## 3. Fields that must never be dropped

Single and batch stock verification payloads must accept and persist:

| Mobile field | API field |
|---|---|
| `verificationType` | `verification_type` (`physical` \| `auto` \| `recheck`) |
| `damageQty` | `damage_qty` |

## 4. Daily session authority

Backend remains authoritative for daily session IDs:

- Auto: `GET /api/mobile/auto-perpetual/session/today` + tasks `session_id`
- Physical: created inside `POST /api/mobile/stock-verification` using IST calendar day

Mobile must not invent a competing per-part session ID.
