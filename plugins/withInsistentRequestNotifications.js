const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'NMTS_INSISTENT_REQUEST_NOTIFICATION';
const BUILDER_REL =
  'node_modules/expo-notifications/android/src/main/java/expo/modules/notifications/notifications/presentation/builders/ExpoNotificationBuilder.kt';

const PATCH = `
    val built = builder.build()
    // ${MARKER}: repeat request-alert sound until Pick or Snooze cancels the notification.
    val channelId = built.channelId ?: ""
    if (channelId.startsWith("sleeping-stock-requests")) {
      built.flags = built.flags or android.app.Notification.FLAG_INSISTENT
    }
    return built
`;

function withInsistentRequestNotifications(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const builderPath = path.join(modConfig.modRequest.projectRoot, BUILDER_REL);
      if (!fs.existsSync(builderPath)) {
        throw new Error(`expo-notifications builder not found at ${builderPath}`);
      }
      let source = fs.readFileSync(builderPath, 'utf8');
      if (source.includes(MARKER)) {
        return modConfig;
      }
      const needle = '    return builder.build()\n  }';
      if (!source.includes(needle)) {
        throw new Error('ExpoNotificationBuilder.kt no longer contains the expected return builder.build() site');
      }
      source = source.replace(needle, `${PATCH}  }`);
      fs.writeFileSync(builderPath, source);
      return modConfig;
    },
  ]);
}

module.exports = withInsistentRequestNotifications;
