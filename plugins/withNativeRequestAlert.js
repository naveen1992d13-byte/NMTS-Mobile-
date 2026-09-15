const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SOUND_SRC = 'assets/sounds/sleeping_stock_alert_2_rising_dispatch.wav';
const SOUND_RAW_NAME = 'sleeping_stock_alert_2_rising_dispatch.wav';
const PERMISSIONS = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.WAKE_LOCK',
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
    const uses = manifest.manifest['uses-permission'] || [];
    const hasFullScreen = uses.some(
      (entry) => entry.$?.['android:name'] === 'android.permission.USE_FULL_SCREEN_INTENT'
    );
    if (hasFullScreen) {
      throw new Error('Native request alert must not add USE_FULL_SCREEN_INTENT');
    }
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
      return modConfig;
    },
  ]);

  return config;
}

module.exports = withNativeRequestAlert;
