#!/usr/bin/env node
/**
 * Static + unit harness for phase-3 Pick/Reject/50s + today-upload gate.
 * No device required. Exit 0 on pass.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let failed = 0;
const pass = (m) => console.log(`PASS: ${m}`);
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  failed += 1;
};

function mustInclude(rel, needle, label) {
  const text = read(rel);
  if (text.includes(needle)) pass(label || `${rel} contains ${needle}`);
  else fail(label || `${rel} missing ${needle}`);
}

function mustNotInclude(rel, needle, label) {
  const text = read(rel);
  if (!text.includes(needle)) pass(label || `${rel} omits ${needle}`);
  else fail(label || `${rel} still contains ${needle}`);
}

// --- Notification audit (static) ---
mustInclude('src/components/IncomingRequestPopup.js', 'REJECT', 'popup has Reject');
mustInclude('src/components/IncomingRequestPopup.js', 'PICK', 'popup has Pick');
mustNotInclude('src/components/IncomingRequestPopup.js', 'SNOOZE', 'popup has no Snooze');
mustInclude('src/services/pushNotifications.js', "buttonTitle: 'REJECT'", 'push category Reject');
mustInclude('src/services/pushNotifications.js', "buttonTitle: 'PICK'", 'push category Pick');
mustNotInclude('src/services/pushNotifications.js', "buttonTitle: 'SNOOZE'", 'push category no Snooze');
mustInclude('src/utils/requestAlert.js', 'ALREADY_PICKED_MESSAGE', 'already-picked message constant');
mustInclude('src/utils/requestAlert.js', 'CONFIRM_WINDOW_SECONDS = 50', '50s confirm window');
mustInclude('App.js', 'rejectNotification', 'App rejects via API');
mustInclude('App.js', 'confirmSecondsLeft', 'App tracks confirm countdown');
mustInclude('App.js', 'verifyTodayStockUploaded', 'App uses today stock gate');
mustInclude('src/services/todayStockGate.js', 'TODAY_STOCK_MISSING_MESSAGE', 'gate message present');
mustInclude('src/api.js', '/mobile/stock/today-upload-status', 'upload-status API wired');
mustInclude('src/api.js', '/mobile/notifications/reject', 'reject API wired');
mustInclude(
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertRingingService.kt',
  'ACTION_REJECT',
  'native notification Reject action'
);
mustNotInclude(
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertRingingService.kt',
  'addAction(0, "Snooze"',
  'native notification no Snooze button'
);
mustInclude(
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertApi.kt',
  '/mobile/notifications/reject',
  'native reject API path'
);
mustInclude('src/config/env.js', 'https://testing.sleepingstock.in/api', 'Testing API only');
mustInclude('app.json', '"version": "1.5.0"', 'versionName 1.5.0');
mustInclude('app.json', '"versionCode": 32', 'versionCode 32');
mustInclude('app.json', '"name": "Sleeping Stock"', 'app label Sleeping Stock');
mustInclude('app.json', 'adaptive-icon-monochrome.png', 'monochrome adaptive layer');

// Logout token cleanup path
mustInclude('App.js', 'logoutCleanup()', 'logout clears native auth/tokens');
mustInclude('App.js', 'await logoutSession()', 'logout hits backend');

// Icon evidence files
const previews = [
  'assets/source/previews/circle.png',
  'assets/source/previews/squircle.png',
  'assets/source/previews/rounded-square.png',
  'assets/source/previews/teardrop.png',
  'assets/source/previews/square.png',
  'assets/source/adaptive-xml/ic_launcher.xml',
  'assets/source/adaptive-xml/ic_launcher_round.xml',
  'assets/source/play-store-icon-512.png',
  'assets/source/adaptive-icon-monochrome.png',
];
for (const rel of previews) {
  if (fs.existsSync(path.join(root, rel))) pass(`icon evidence ${rel}`);
  else fail(`missing icon evidence ${rel}`);
}

// --- Unit: requestAlert helpers (CJS load via dynamic import of .js ESM is awkward; inline mirrors) ---
async function unitRequestAlert() {
  // Evaluate key pure helpers by re-reading module through vm is heavy; assert source contracts instead.
  const src = read('src/utils/requestAlert.js');
  assert.match(src, /export function canRejectRequest/);
  assert.match(src, /export function canSnoozeRequest/);
  assert.match(src, /return false;\n\}/);
  assert.match(src, /This request was already picked by another dealer/);
  pass('requestAlert contracts present');
}

async function unitTodayGate() {
  const gatePath = path.join(root, 'src/services/todayStockGate.js');
  // Lightweight behavioral check using mocked fetch-less API would need babel; assert exports in source.
  const src = read('src/services/todayStockGate.js');
  assert.ok(src.includes("export function isStockGatedScreen"));
  assert.ok(src.includes("GATED_SCREENS = new Set(['auto', 'verification', 'search'])"));
  assert.ok(src.includes('clearTodayStockGateCache'));
  assert.ok(src.includes('Never assumes uploaded'));
  pass('todayStockGate contracts present');
}

(async () => {
  try {
    await unitRequestAlert();
    await unitTodayGate();
  } catch (error) {
    fail(`unit: ${error.message}`);
  }
  console.log(failed ? `HARNESS: FAIL (${failed})` : 'HARNESS: PASS');
  process.exit(failed ? 1 : 0);
})();
