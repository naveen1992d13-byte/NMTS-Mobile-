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
if (push.includes('getExpoPushTokenAsync') && push.includes('AndroidImportance.MAX') && push.includes('OPEN_REQUEST')) {
  pass('token + MAX channel + OPEN REQUEST category present');
} else fail('pushNotifications setup incomplete');

if (push.includes('throw new Error') && !read('App.js').includes('registerForPushNotificationsAsync().catch(() => null)')) {
  pass('token errors are no longer swallowed');
} else fail('token errors still swallowed');

const app = read('App.js');
if (app.includes('openExactRequestFromPush') && app.includes('IncomingRequestPopup') && app.includes('request_group_key')) {
  pass('OPEN REQUEST exact routing wired');
} else fail('OPEN REQUEST routing missing');

if (app.includes('snoozeIncomingAlert') && !read('src/components/IncomingRequestPopup.js').includes('skipNotification')) {
  pass('popup SNOOZE is local dismiss only');
} else fail('popup SNOOZE wired incorrectly');
if (read('src/components/IncomingRequestPopup.js').includes('Skip') || read('src/components/IncomingRequestPopup.js').includes('SKIP')) {
  fail('popup includes Skip');
} else pass('popup has no Skip');

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
if (gsKey === 'REPLACE_WITH_FIREBASE_ANDROID_API_KEY' || gsKey.includes('REPLACE')) {
  fail('google-services.json is a placeholder — real Firebase Android key required for live tokens');
} else pass('google-services.json has a non-placeholder API key');

console.log(process.exitCode ? 'FOCUSED CHECKS: FAIL' : 'FOCUSED CHECKS: PASS');
