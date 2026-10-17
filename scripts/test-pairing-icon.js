#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appJs = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const envJs = fs.readFileSync(path.join(root, 'src/config/env.js'), 'utf8');
const easIgnore = fs.readFileSync(path.join(root, '.easignore'), 'utf8');

assert.strictEqual(appJson.expo.version, '1.5.1');
assert.strictEqual(appJson.expo.android.versionCode, 33);
assert.strictEqual(pkg.version, '1.5.1');
assert.strictEqual(appJson.expo.name, 'Sleeping Stock');
assert.ok(appJson.expo.android.adaptiveIcon.monochromeImage);

assert.strictEqual(
  appJson.expo.android.adaptiveIcon.foregroundImage,
  './assets/source/adaptive-icon-foreground-logo-only.png'
);
assert.strictEqual(
  appJson.expo.android.adaptiveIcon.backgroundImage,
  './assets/source/adaptive-icon-background.png'
);
assert.strictEqual(appJson.expo.android.adaptiveIcon.backgroundColor, '#05070d');
assert.strictEqual(appJson.expo.icon, './assets/icon.png');
assert.strictEqual(appJson.expo.splash.image, './assets/splash-logo.png');
assert.strictEqual(appJson.expo.android.icon, './assets/icon.png');
assert.strictEqual(appJson.expo.android.softwareKeyboardLayoutMode, 'resize');
assert.ok(appJson.expo.plugins.includes('./plugins/withAdaptiveLauncherIcon.js'));

const notifPlugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
assert.strictEqual(notifPlugin[1].icon, './assets/notification-icon.png');

assert.ok(appJs.includes('const PAIR_SCREEN = Dimensions.get(\'screen\');'));
assert.ok(appJs.includes('const PAIR_WINDOW = Dimensions.get(\'window\');'));
assert.ok(!appJs.includes('Dimensions.addEventListener'));
assert.ok(!appJs.includes('useWindowDimensions'));
const pairScreen = appJs.slice(appJs.indexOf('function PairScreen('), appJs.indexOf('function HomeScreen('));
assert.ok(pairScreen.includes("Platform.OS === 'ios'"));
assert.ok(pairScreen.includes('behavior="padding"'));
assert.ok(!pairScreen.includes("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}"));
assert.ok(!pairScreen.includes('keyboardVerticalOffset'));
assert.ok(!pairScreen.includes("behavior=\"height\""));
assert.ok(appJs.includes('function PairForm('));
assert.ok(appJs.includes('function PairScreen('));
assert.ok(appJs.includes("Platform.OS === 'ios'"));
assert.ok(appJs.includes('minHeight: PAIR_WINDOW.height'));
assert.ok(appJs.includes('width: PAIR_SCREEN.width'));
assert.ok(appJs.includes('height: PAIR_SCREEN.height'));
assert.ok(appJs.includes('width: PAIR_WINDOW.width'));
assert.ok(!/loginBackground:[\s\S]{0,180}width: '100%'/.test(appJs));
assert.ok(appJs.includes('keyboardShouldPersistTaps="handled"'));
assert.ok(appJs.includes('Scan NMTS Pairing QR'));
assert.ok(
  appJs.includes('Manual pairing code always uses Production') ||
    appJs.includes('Manual pairing code always uses Testing') ||
    appJs.includes('testing.sleepingstock.in')
);
assert.ok(appJs.includes('Re-pair keeps the same ID'));
assert.ok(appJs.includes("openScanner('pairing')"));
assert.ok(appJs.includes('onManualPair={pairManually}'));
assert.ok(envJs.includes('MANUAL_PAIRING_API_BASE_URL = TESTING_API_BASE_URL'));
assert.ok(envJs.includes('TESTING_API_BASE_URL'));
assert.ok(easIgnore.includes('assets/source/previews'));

const fg = fs.readFileSync(path.join(root, 'assets/source/adaptive-icon-foreground-logo-only.png'));
assert.ok(fg.length > 100000, 'safe-zone foreground PNG should be non-trivial');
const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
assert.ok(fg.slice(0, 4).equals(pngSig), 'foreground is a PNG');
assert.ok(fs.existsSync(path.join(root, 'plugins/withAdaptiveLauncherIcon.js')));

console.log('pairing-icon: pass');
