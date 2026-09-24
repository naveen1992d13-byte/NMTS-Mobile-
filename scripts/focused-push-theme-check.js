#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};
const pass = (msg) => console.log(`PASS: ${msg}`);

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');

const appJson = JSON.parse(read('app.json'));
const expo = appJson.expo;
if (expo.android.googleServicesFile === './google-services.json' && exists('google-services.json')) {
  pass('googleServicesFile wired');
} else fail('googleServicesFile missing');

const gs = JSON.parse(read('google-services.json'));
if (gs.client?.[0]?.client_info?.android_client_info?.package_name === 'in.sleepingstock.mobile') {
  pass('google-services package_name matches app');
} else fail('google-services package_name mismatch');

if (expo.extra?.eas?.projectId === '545530df-24b8-4e30-a35d-0fb66b3c3f81') pass('EAS projectId present');
else fail('EAS projectId missing');

const plugin = (expo.plugins || []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
if (plugin?.[1]?.defaultChannel === 'sleeping-stock-requests-v3') pass('notification defaultChannel configured');
else fail('notification plugin channel missing');

const SOUND_REL = './assets/sounds/sleeping_stock_alert_2_rising_dispatch.wav';
const sounds = plugin?.[1]?.sounds || [];
if (sounds.includes(SOUND_REL) && exists('assets/sounds/sleeping_stock_alert_2_rising_dispatch.wav')) {
  const buf = fs.readFileSync(path.join(root, 'assets/sounds/sleeping_stock_alert_2_rising_dispatch.wav'));
  if (buf.slice(0, 4).toString() === 'RIFF') pass('selected custom sound packaged exactly');
  else fail('sound file is not a valid WAV');
} else fail('selected custom sound file not packaged');

const requestAlert = read('src/utils/requestAlert.js');
if (
  requestAlert.includes("sleeping_stock_alert_2_rising_dispatch.wav") &&
  requestAlert.includes("sleeping-stock-requests-v3")
) pass('channel uses selected sound name');
else fail('channel sound name mismatch');

const push = read('src/services/pushNotifications.js');
if (push.includes('getExpoPushTokenAsync') && push.includes('AndroidImportance.MAX') && push.includes("buttonTitle: 'PICK'")) {
  pass('token + MAX channel + PICK category present');
} else fail('pushNotifications setup incomplete');

if (push.includes('throw new Error') && !read('App.js').includes('registerForPushNotificationsAsync().catch(() => null)')) {
  pass('token errors are no longer swallowed');
} else fail('token errors still swallowed');

const app = read('App.js');
if (app.includes('pickIncomingFromPush') && app.includes('IncomingRequestPopup') && app.includes('request_group_key')) {
  pass('PICK exact routing wired');
} else fail('PICK routing missing');

if (app.includes('snoozeIncomingAlert') && !read('src/components/IncomingRequestPopup.js').includes('skipNotification')) {
  pass('popup SNOOZE is local dismiss only');
} else fail('popup SNOOZE wired incorrectly');
if (read('src/components/IncomingRequestPopup.js').includes('Skip') || read('src/components/IncomingRequestPopup.js').includes('SKIP')) {
  fail('popup includes Skip');
} else pass('popup has no Skip');
if (
  read('src/components/IncomingRequestPopup.js').includes('Request Number') &&
  read('src/components/IncomingRequestPopup.js').includes('Requested Branch') &&
  read('src/components/IncomingRequestPopup.js').includes('Total Items') &&
  read('src/components/IncomingRequestPopup.js').includes('Total Quantity') &&
  read('src/components/IncomingRequestPopup.js').includes('PICK') &&
  read('src/components/IncomingRequestPopup.js').includes('SNOOZE') &&
  !read('src/components/IncomingRequestPopup.js').includes('OPEN REQUEST') &&
  !read('src/components/IncomingRequestPopup.js').includes('SLA remaining')
) pass('popup shows only required fields and Pick/Snooze');
else fail('popup fields/actions do not match requirement');
if (
  requestAlert.includes('sleeping-stock-requests-v3') &&
  requestAlert.includes("sleeping-stock-requests'") &&
  push.includes('ANDROID_CHANNEL_IDS') &&
  push.includes('ANDROID_SOUND_NAME')
) pass('request channels registered with custom sound');
else fail('request channel/sound not aligned');
if (read('plugins/withInsistentRequestNotifications.js').includes('FLAG_INSISTENT')) {
  pass('insistent notification plugin present');
} else fail('insistent notification plugin missing');
if ((expo.plugins || []).includes('./plugins/withInsistentRequestNotifications.js')) {
  pass('insistent plugin wired in app.json');
} else fail('insistent plugin not wired in app.json');

const nativePlugin = read('plugins/withNativeRequestAlert.js');
if (
  nativePlugin.includes('FOREGROUND_SERVICE_MEDIA_PLAYBACK') &&
  nativePlugin.includes('WAKE_LOCK') &&
  nativePlugin.includes('POST_NOTIFICATIONS') &&
  nativePlugin.includes('FOREGROUND_SERVICE') &&
  nativePlugin.includes('mediaPlayback') &&
  nativePlugin.includes('USE_FULL_SCREEN_INTENT')
) pass('native request-alert plugin declares FGS type and four permissions');
else fail('native request-alert plugin missing FGS/permissions');
if ((expo.plugins || []).includes('./plugins/withNativeRequestAlert.js')) {
  pass('native request-alert plugin wired in app.json');
} else fail('native request-alert plugin not wired in app.json');

const nativeKt = [
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertFirebaseMessagingService.kt',
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertRingingService.kt',
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertActionReceiver.kt',
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertModule.kt',
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertLockGateActivity.kt',
  'modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertLockFlags.kt',
];
if (nativeKt.every((rel) => exists(rel))) pass('native Kotlin alert pipeline files present');
else fail('native Kotlin alert pipeline files missing');

const ringing = read('modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertRingingService.kt');
const fcm = read('modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertFirebaseMessagingService.kt');
const moduleKt = read('modules/native-request-alert/android/src/main/java/in/sleepingstock/mobile/requestalert/RequestAlertModule.kt');
const manifestSrc = read('modules/native-request-alert/android/src/main/AndroidManifest.xml');
const nativeJs = read('src/services/nativeRequestAlert.js');
if (
  ringing.includes('setFullScreenIntent') &&
  manifestSrc.includes('USE_FULL_SCREEN_INTENT') &&
  manifestSrc.includes('RequestAlertLockGateActivity') &&
  ringing.includes('CATEGORY_ALARM') &&
  !ringing.includes('setCategory(NotificationCompat.CATEGORY_CALL)') &&
  moduleKt.includes('onIncomingAlert') &&
  moduleKt.includes('canUseFullScreenIntent') &&
  nativeJs.includes('addNativeIncomingAlertListener') &&
  nativeJs.includes('canUseFullScreenIntent') &&
  app.includes('addNativeIncomingAlertListener') &&
  app.includes('requestUseFullScreenIntent') &&
  !app.includes('SYSTEM_ALERT_WINDOW') &&
  !nativeJs.includes('SYSTEM_ALERT_WINDOW')
) pass('full-screen intent + incoming-alert + CATEGORY_ALARM wired');
else fail('full-screen intent / incoming-alert pipeline incomplete');
if (
  manifestSrc.includes('FOREGROUND_SERVICE_MEDIA_PLAYBACK') &&
  manifestSrc.includes('foregroundServiceType="mediaPlayback"') &&
  ringing.includes('startForegroundService') &&
  fcm.includes('RequestAlertRingingService.startNow')
) pass('FCM starts ringing FGS immediately');
else fail('FCM does not start ringing FGS immediately');
if (ringing.includes('PARTIAL_WAKE_LOCK') && ringing.includes('MediaPlayer') && ringing.includes('stopForeground(true)')) {
  pass('wake lock, MediaPlayer loop, and stopForeground(true) present');
} else fail('ringing service missing wake lock / player / stopForeground');
if (read('src/services/nativeRequestAlert.js').includes('stopRinging') && app.includes('stopRinging(')) {
  pass('JS stopRinging bridge wired');
} else fail('JS stopRinging bridge missing');
if (app.includes('stopRinging(group.request_group_key') && app.includes('stopRinging(alert.request_group_key')) {
  pass('existing Pick/Snooze handlers call stopRinging');
} else fail('Pick/Snooze handlers missing stopRinging');
if (expo.version === '1.4.0' && expo.android.versionCode === 19) pass('APK version bumped to 1.4.0 / 19');
else fail('android versionCode/version not bumped');

if (/Hyundai|HYUNDAI/.test(app) || /Hyundai|HYUNDAI/.test(read('src/components/IncomingRequestPopup.js'))) {
  fail('OEM Hyundai branding still present');
} else pass('no hardcoded OEM branding');

const uploadedIcon = '/home/ubuntu/.cursor/projects/agent/assets/411844e4-65c8-4390-b4bc-da8b1dffae32.png';
const uploadedLogo = '/home/ubuntu/.cursor/projects/agent/assets/666c130f-7890-4e30-9e2a-f21961b3f2d1.png';
if (exists('assets/icon.png') && fs.existsSync(uploadedIcon) && sha('assets/icon.png') === crypto.createHash('sha256').update(fs.readFileSync(uploadedIcon)).digest('hex')) {
  pass('uploaded app icon used exactly');
} else fail('app icon does not match uploaded file');
if (exists('assets/sleeping-stock-logo.png') && fs.existsSync(uploadedLogo) && sha('assets/sleeping-stock-logo.png') === crypto.createHash('sha256').update(fs.readFileSync(uploadedLogo)).digest('hex')) {
  pass('uploaded logo used exactly');
} else fail('logo does not match uploaded file');

if (expo.icon === './assets/icon.png' && expo.splash?.image === './assets/splash-logo.png') pass('icon/splash wired in app.json');
else fail('icon/splash not wired');

if (read('src/theme.js').includes('#05070d') && read('src/theme.js').includes('3ee0ff')) pass('dark neon theme tokens present');
else fail('theme tokens missing');

const gsKey = gs.client?.[0]?.api_key?.[0]?.current_key || '';
if (gsKey === 'REPLACE_WITH_FIREBASE_ANDROID_API_KEY' || gsKey.includes('REPLACE') || !gsKey) {
  fail('google-services.json is a placeholder — real Firebase Android key required for live tokens');
} else pass('google-services.json has a non-placeholder API key');

const uploadedGs = '/home/ubuntu/.cursor/projects/agent/uploads/google-services_571f.json';
if (fs.existsSync(uploadedGs) && sha('google-services.json') === crypto.createHash('sha256').update(fs.readFileSync(uploadedGs)).digest('hex')) {
  pass('google-services.json matches uploaded Firebase file exactly');
} else if (gs.project_info?.project_id === 'nmts-mobile' && gs.project_info?.project_number === '295465839675') {
  pass('google-services.json is the nmts-mobile Firebase Android file');
} else fail('google-services.json does not match the uploaded Firebase file');

console.log(process.exitCode ? 'FOCUSED CHECKS: FAIL' : 'FOCUSED CHECKS: PASS');
