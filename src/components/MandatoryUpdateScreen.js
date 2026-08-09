import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { BLUE, BORDER, DARK, MUTED } from '../theme';
import { PrimaryButton } from './ui';

export default function MandatoryUpdateScreen({ versionInfo, currentVersionCode }) {
  const downloadUrl = versionInfo?.download_url || versionInfo?.apk_url || versionInfo?.url;
  const versionName = versionInfo?.version_name || versionInfo?.version || 'latest';

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>UPDATE REQUIRED</Text>
        <Text style={styles.title}>Install the latest Sleeping Stock Mobile</Text>
        <Text style={styles.body}>
          This device is running build {currentVersionCode}. Version {versionName}
          {versionInfo?.version_code ? ` (build ${versionInfo.version_code})` : ''} is required
          before you can continue.
        </Text>
        {versionInfo?.release_notes ? (
          <Text style={styles.notes}>{versionInfo.release_notes}</Text>
        ) : null}
        <PrimaryButton
          title={downloadUrl ? 'Download Update' : 'Update Required'}
          onPress={() => {
            if (downloadUrl) Linking.openURL(downloadUrl);
          }}
          disabled={!downloadUrl}
        />
        {!downloadUrl ? (
          <Text style={styles.help}>
            Ask your NMTS admin for the latest APK from the Sleeping Stock Mobile page.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f3f6fb',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 22,
  },
  eyebrow: { color: BLUE, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  title: { marginTop: 10, color: DARK, fontSize: 22, fontWeight: '900' },
  body: { marginTop: 12, marginBottom: 18, color: MUTED, fontSize: 14, lineHeight: 21 },
  notes: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f5f7fb',
    color: DARK,
    fontSize: 12,
    lineHeight: 18,
  },
  help: { marginTop: 14, color: MUTED, fontSize: 12, textAlign: 'center' },
});
