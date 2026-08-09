// Offline Stock Verification queue.
//
// Every submission is written to local SQLite first; sync runs in the
// background and must never block the verification UI.
//
// Sync strategy:
// 1) Prefer POST /mobile/stock-verification/batch when available
// 2) Otherwise sync in parallel chunks (not one-by-one sequential)
// Idempotency via client_id prevents duplicates on retry.
import * as SQLite from 'expo-sqlite';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { submitStockVerification, submitStockVerificationBatch, ApiError } from '../api';

const DB_NAME = 'sleeping_stock_offline.db';
const MAX_RETRY_BEFORE_BACKOFF = 3;
const PARALLEL_CHUNK_SIZE = 8;

let dbPromise = null;
let isSyncing = false;
let netInfoUnsubscribe = null;
let periodicTimer = null;
const listeners = new Set();
const statusListeners = new Set();
let syncStatus = { state: 'idle', pending: 0, syncing: 0, message: '' };

function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

export async function initOfflineQueue() {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS verification_queue (
      client_id TEXT PRIMARY KEY NOT NULL,
      part_number TEXT NOT NULL,
      physical_qty REAL NOT NULL,
      location TEXT,
      remark TEXT,
      entry_method TEXT NOT NULL,
      verification_session_id TEXT,
      part_name TEXT,
      is_new_part INTEGER NOT NULL DEFAULT 0,
      verification_type TEXT NOT NULL DEFAULT 'physical',
      damage_qty REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT
    );
  `);

  for (const statement of [
    `ALTER TABLE verification_queue ADD COLUMN verification_session_id TEXT`,
    `ALTER TABLE verification_queue ADD COLUMN part_name TEXT`,
    `ALTER TABLE verification_queue ADD COLUMN is_new_part INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE verification_queue ADD COLUMN verification_type TEXT NOT NULL DEFAULT 'physical'`,
    `ALTER TABLE verification_queue ADD COLUMN damage_qty REAL NOT NULL DEFAULT 0`,
  ]) {
    try {
      await db.execAsync(statement);
    } catch (_error) {
      // Column already exists.
    }
  }
}

function notifyListeners() {
  listeners.forEach((fn) => {
    try { fn(); } catch (error) { console.log('[offlineQueue] listener error', error); }
  });
}

function setSyncStatus(next) {
  syncStatus = { ...syncStatus, ...next };
  statusListeners.forEach((fn) => {
    try { fn(syncStatus); } catch (_e) {}
  });
}

export function getSyncStatus() {
  return syncStatus;
}

export function subscribeToSyncStatus(callback) {
  statusListeners.add(callback);
  try { callback(syncStatus); } catch (_e) {}
  return () => statusListeners.delete(callback);
}

export function subscribeToQueueChanges(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function enqueueVerification({
  partNumber,
  partName,
  physicalQty,
  location,
  remark,
  entryMethod,
  verificationSessionId,
  isNewPart,
  verificationType,
  damageQty,
}) {
  const db = await getDb();
  const clientId = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO verification_queue
      (client_id, part_number, part_name, physical_qty, location, remark, entry_method, verification_session_id, is_new_part, verification_type, damage_qty, created_at, sync_status, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
    [
      clientId,
      partNumber,
      partName || '',
      physicalQty,
      location || '',
      remark || '',
      entryMethod,
      verificationSessionId || '',
      isNewPart ? 1 : 0,
      verificationType || 'physical',
      Number(damageQty || 0),
      createdAt,
    ]
  );
  notifyListeners();
  return clientId;
}

/** Instant local save; sync is fire-and-forget. */
export async function enqueueAndTrySync(record) {
  const clientId = await enqueueVerification(record);
  syncQueue().catch((error) => console.log('[offlineQueue] immediate sync failed', error));
  return clientId;
}

export async function getQueuedRecords() {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM verification_queue ORDER BY created_at ASC`);
}

export async function getPendingCount() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT COUNT(*) as count FROM verification_queue WHERE sync_status != 'synced'`
  );
  return row?.count || 0;
}

function rowToPayload(row) {
  return {
    partNumber: row.part_number,
    partName: row.part_name || '',
    physicalQty: row.physical_qty,
    location: row.location,
    remark: row.remark,
    entryMethod: row.entry_method,
    clientId: row.client_id,
    verificationSessionId: row.verification_session_id || '',
    isNewPart: Boolean(row.is_new_part),
    verificationType: row.verification_type || 'physical',
    damageQty: Number(row.damage_qty || 0),
  };
}

function shouldBackoff(row) {
  if (row.retry_count < MAX_RETRY_BEFORE_BACKOFF || !row.last_attempt_at) return false;
  const waitMs = Math.min(2 ** row.retry_count, 60) * 1000;
  const elapsed = Date.now() - new Date(row.last_attempt_at).getTime();
  return elapsed < waitMs;
}

async function markFailed(db, clientId, message) {
  await db.runAsync(
    `UPDATE verification_queue
       SET sync_status = 'failed', retry_count = retry_count + 1,
           last_error = ?, last_attempt_at = ?
     WHERE client_id = ?`,
    [message, new Date().toISOString(), clientId]
  );
}

async function syncRowsParallel(db, rows) {
  let synced = 0;
  let failed = 0;
  let networkDropped = false;

  for (let i = 0; i < rows.length; i += PARALLEL_CHUNK_SIZE) {
    if (networkDropped) break;
    const chunk = rows.slice(i, i + PARALLEL_CHUNK_SIZE);
    setSyncStatus({
      state: 'syncing',
      syncing: chunk.length,
      pending: Math.max(0, rows.length - i),
      message: `Syncing ${Math.min(PARALLEL_CHUNK_SIZE, rows.length - i)}...`,
    });

    await Promise.all(chunk.map(async (row) => {
      await db.runAsync(
        `UPDATE verification_queue SET sync_status = 'syncing' WHERE client_id = ?`,
        [row.client_id]
      );
    }));

    const results = await Promise.allSettled(
      chunk.map((row) => submitStockVerification(rowToPayload(row)))
    );

    for (let idx = 0; idx < chunk.length; idx += 1) {
      const row = chunk[idx];
      const result = results[idx];
      if (result.status === 'fulfilled') {
        await db.runAsync(`DELETE FROM verification_queue WHERE client_id = ?`, [row.client_id]);
        synced += 1;
      } else {
        failed += 1;
        const error = result.reason;
        const message = error instanceof ApiError ? error.message : String(error?.message || error);
        await markFailed(db, row.client_id, message);
        if (error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout')) {
          networkDropped = true;
        }
      }
    }
  }

  return { synced, failed };
}

async function syncRowsViaBatch(db, rows) {
  setSyncStatus({
    state: 'syncing',
    syncing: rows.length,
    pending: rows.length,
    message: `Syncing ${rows.length}...`,
  });

  for (const row of rows) {
    await db.runAsync(
      `UPDATE verification_queue SET sync_status = 'syncing' WHERE client_id = ?`,
      [row.client_id]
    );
  }

  const response = await submitStockVerificationBatch(rows.map(rowToPayload));
  const resultRows = Array.isArray(response?.results) ? response.results : [];
  const byClient = new Map(resultRows.map((r) => [r.client_id || r.clientId, r]));

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    const item = byClient.get(row.client_id);
    const ok = item ? (item.success !== false && !item.error) : response?.success !== false;
    if (ok) {
      await db.runAsync(`DELETE FROM verification_queue WHERE client_id = ?`, [row.client_id]);
      synced += 1;
    } else {
      failed += 1;
      await markFailed(db, row.client_id, item?.error || item?.message || 'Batch item failed');
    }
  }

  // If the server accepted the batch but omitted per-item results, treat HTTP 2xx as synced.
  if (!resultRows.length && response && response.success !== false && failed === 0) {
    for (const row of rows) {
      await db.runAsync(`DELETE FROM verification_queue WHERE client_id = ?`, [row.client_id]);
    }
    synced = rows.length;
    failed = 0;
  }

  return { synced, failed };
}

export async function syncQueue() {
  if (isSyncing) return { synced: 0, failed: 0, skipped: true };
  isSyncing = true;
  let synced = 0;
  let failed = 0;

  try {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected || netState.isInternetReachable === false) {
      setSyncStatus({ state: 'offline', message: 'Offline', syncing: 0 });
      return { synced: 0, failed: 0, skipped: true, reason: 'offline' };
    }

    const db = await getDb();
    const rows = await db.getAllAsync(
      `SELECT * FROM verification_queue WHERE sync_status IN ('pending', 'failed') ORDER BY created_at ASC`
    );
    const ready = rows.filter((row) => !shouldBackoff(row));

    if (!ready.length) {
      setSyncStatus({ state: 'idle', pending: 0, syncing: 0, message: '' });
      return { synced: 0, failed: 0, skipped: false };
    }

    setSyncStatus({
      state: 'syncing',
      pending: ready.length,
      syncing: ready.length,
      message: `Syncing ${ready.length}...`,
    });

    try {
      const batchResult = await syncRowsViaBatch(db, ready);
      synced = batchResult.synced;
      failed = batchResult.failed;
    } catch (batchError) {
      // Batch endpoint missing or failed hard — fall back to parallel singles.
      if (
        batchError instanceof ApiError &&
        (batchError.status === 404 || batchError.status === 405 || batchError.status === 422)
      ) {
        const parallelResult = await syncRowsParallel(db, ready);
        synced = parallelResult.synced;
        failed = parallelResult.failed;
      } else if (batchError instanceof ApiError && (batchError.kind === 'network' || batchError.kind === 'timeout')) {
        const parallelResult = await syncRowsParallel(db, ready);
        synced = parallelResult.synced;
        failed = parallelResult.failed;
      } else {
        const parallelResult = await syncRowsParallel(db, ready);
        synced = parallelResult.synced;
        failed = parallelResult.failed;
      }
    }

    const pending = await getPendingCount();
    if (pending === 0 && failed === 0) {
      setSyncStatus({ state: 'synced', pending: 0, syncing: 0, message: '✓ Synced' });
      setTimeout(() => {
        if (getSyncStatus().state === 'synced') {
          setSyncStatus({ state: 'idle', message: '', syncing: 0 });
        }
      }, 2500);
    } else {
      setSyncStatus({
        state: failed ? 'error' : 'idle',
        pending,
        syncing: 0,
        message: pending ? `${pending} pending` : '',
      });
    }
  } finally {
    isSyncing = false;
    notifyListeners();
  }

  return { synced, failed, skipped: false };
}

export function startAutoSync({ periodicIntervalMs = 30000 } = {}) {
  if (netInfoUnsubscribe) return () => {};

  netInfoUnsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      syncQueue().catch((error) => console.log('[offlineQueue] connectivity sync failed', error));
    }
  });

  periodicTimer = setInterval(() => {
    syncQueue().catch((error) => console.log('[offlineQueue] periodic sync failed', error));
  }, periodicIntervalMs);

  syncQueue().catch((error) => console.log('[offlineQueue] startup sync failed', error));

  return function stopAutoSync() {
    if (netInfoUnsubscribe) {
      netInfoUnsubscribe();
      netInfoUnsubscribe = null;
    }
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
  };
}
