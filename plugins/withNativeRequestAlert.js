const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SOUND_SRC = 'assets/sounds/sleeping_stock_alert_2_rising_dispatch.wav';
const SOUND_RAW_NAME = 'sleeping_stock_alert_2_rising_dispatch.wav';
const LOGO_SRC = 'assets/sleeping-stock-logo.png';
const LOGO_DRAWABLE_NAME = 'sleeping_stock_logo.png';
const PERMISSIONS = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.WAKE_LOCK',
  'android.permission.USE_FULL_SCREEN_INTENT',
];

function ensurePermission(manifest, name) {
  AndroidConfig.Permissions.ensurePermission(manifest, name);
}

function withNativeRequestAlert(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    PERMISSIONS.forEach((permission) => ensurePermission(manifest, permission));
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const services = application.service || [];
    const ringing = services.find(
      (service) =>
        String(service.$?.['android:name'] || '').endsWith('RequestAlertRingingService')
    );
    if (ringing) {
      ringing.$['android:foregroundServiceType'] = 'mediaPlayback';
      ringing.$['android:stopWithTask'] = 'false';
    }
    // Only one service receives each MESSAGING_EVENT. intent-filter
    // priority is ignored for services; Firebase bindService picks an
    // unspecified match when Expo + the firebase-messaging stub remain.
    // ExpoFirebaseMessagingService only delegates to FirebaseMessagingDelegate,
    // which RequestAlertFirebaseMessagingService already forwards to.
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const servicesList = application.service || [];
    const removeNames = [
      'expo.modules.notifications.service.ExpoFirebaseMessagingService',
      'com.google.firebase.messaging.FirebaseMessagingService',
    ];
    application.service = [
      ...servicesList.filter((service) => !removeNames.includes(String(service.$?.['android:name'] || ''))),
      ...removeNames.map((name) => ({
        $: {
          'android:name': name,
          'tools:node': 'remove',
        },
      })),
    ];
    return mod;
  });

  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const src = path.join(projectRoot, SOUND_SRC);
      const appRawDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'raw');
      const moduleRawDir = path.join(
        projectRoot,
        'modules',
        'native-request-alert',
        'android',
        'src',
        'main',
        'res',
        'raw'
      );
      if (fs.existsSync(src)) {
        fs.mkdirSync(appRawDir, { recursive: true });
        fs.copyFileSync(src, path.join(appRawDir, SOUND_RAW_NAME));
        fs.mkdirSync(moduleRawDir, { recursive: true });
        fs.copyFileSync(src, path.join(moduleRawDir, SOUND_RAW_NAME));
      }
      const logoSrc = path.join(projectRoot, LOGO_SRC);
      const appDrawableDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'drawable');
      const moduleDrawableDir = path.join(
        projectRoot,
        'modules',
        'native-request-alert',
        'android',
        'src',
        'main',
        'res',
        'drawable'
      );
      if (fs.existsSync(logoSrc)) {
        fs.mkdirSync(appDrawableDir, { recursive: true });
        fs.copyFileSync(logoSrc, path.join(appDrawableDir, LOGO_DRAWABLE_NAME));
        fs.mkdirSync(moduleDrawableDir, { recursive: true });
        fs.copyFileSync(logoSrc, path.join(moduleDrawableDir, LOGO_DRAWABLE_NAME));
      }
      return modConfig;
    },
  ]);

  return config;
}

module.exports = withNativeRequestAlert;
