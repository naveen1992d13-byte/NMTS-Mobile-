import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Image,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { Camera as OcrCamera } from 'react-native-vision-camera-ocr-plus';
import { api, message } from './src/api';

const GREEN = '#176b43';
const BACKGROUND = '#eef1ef';
const SCAN_REGION = { left: '8%', top: '30%', width: '84%', height: '22%' };

const cleanPartNumber = value =>
  String(value || '')
    .toUpperCase()
    .split(/\r?\n/)
    .map(line => line.trim().replace(/[^A-Z0-9-]/g, ''))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || '';

function Button({ title, onPress, disabled, outline = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        outline && styles.buttonOutline,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, outline && styles.buttonOutlineText]}>{title}</Text>
    </Pressable>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#89918d" style={styles.input} {...props} />
    </View>
  );
}

function Card({ children }) {
  return <View style={styles.card}>{children}</View>;
}

export default function App() {
  const [screen, setScreen] = useState('loading');
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ mobile_user_id: '', password: '', pairing_code: '' });
  const scannedPartRef = useRef('');

  useEffect(() => {
    boot();
  }, []);

  async function boot() {
    const token = await SecureStore.getItemAsync('device_session');
    if (!token) {
      setScreen('pair');
      return;
    }

    try {
      const sessionResponse = await api.get('/session');
      setSession(sessionResponse.data);

      const appVersion = Application.nativeApplicationVersion || '1.0.1';
      const configResponse = await api.get('/config', { params: { app_version: appVersion } });
      setConfig(configResponse.data);

      const latest = configResponse.data?.latest_version;
      const mandatoryUpdate = latest?.mandatory_update && latest?.version_name !== appVersion;
      setScreen(mandatoryUpdate ? 'update' : 'home');
    } catch (requestError) {
      await SecureStore.deleteItemAsync('device_session');
      setSession(null);
      setScreen('pair');
    }
  }

  async function pair() {
    setBusy(true);
    setError('');
    try {
      let deviceId = await Application.getAndroidId();
      deviceId = deviceId || `${Device.modelName || 'Android'}-${Date.now()}`;

      const response = await api.post('/pair', {
        ...form,
        device_id: deviceId,
        device_name: Device.deviceName || Device.modelName || 'Android',
        android_info: {
          brand: Device.brand,
          model: Device.modelName,
          os: Device.osVersion,
        },
        app_version: Application.nativeApplicationVersion || '1.0.1',
      });

      await Promise.all([
        SecureStore.setItemAsync('device_session', response.data.session_token),
        SecureStore.setItemAsync('device_id', deviceId),
      ]);
      await boot();
    } catch (requestError) {
      setError(message(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await Promise.all([
      SecureStore.deleteItemAsync('device_session'),
      SecureStore.deleteItemAsync('device_id'),
    ]);
    setSession(null);
    setScreen('pair');
  }

  if (screen === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={GREEN} size="large" />
      </SafeAreaView>
    );
  }

  if (screen === 'pair') {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar backgroundColor={GREEN} barStyle="light-content" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
            <Image source={require('./assets/icon.png')} style={styles.pairLogo} resizeMode="contain" />
            <Text style={styles.title}>Mobile Pairing</Text>
            <Text style={styles.sub}>
              Enter the Mobile User credentials and the one-time code generated in NMTS Web.
            </Text>
            <Card>
              <Field
                label="Mobile User ID"
                autoCapitalize="characters"
                value={form.mobile_user_id}
                onChangeText={value =>
                  setForm(current => ({ ...current, mobile_user_id: value.trim().toUpperCase() }))
                }
              />
              <Field
                label="Password"
                secureTextEntry
                value={form.password}
                onChangeText={value => setForm(current => ({ ...current, password: value }))}
              />
              <Field
                label="Manual Pairing Code / QR Payload"
                autoCapitalize="characters"
                value={form.pairing_code}
                onChangeText={value => setForm(current => ({ ...current, pairing_code: value.trim() }))}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button
                title={busy ? 'Pairing...' : 'Pair Device'}
                disabled={busy || !form.mobile_user_id || !form.password || !form.pairing_code}
                onPress={pair}
              />
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (screen === 'update') {
    return (
      <SafeAreaView style={styles.center}>
        <Card>
          <Text style={styles.title}>New Update Available</Text>
          <Text style={styles.sub}>
            {config?.latest_version?.release_notes || 'Install the latest approved build to continue.'}
          </Text>
          <Button
            title="Open NMTS APK Download"
            onPress={() => Linking.openURL(config?.latest_version?.download_url || 'https://sleepingstock.in')}
          />
        </Card>
      </SafeAreaView>
    );
  }

  return (
    <Main
      session={session}
      screen={screen}
      go={setScreen}
      logout={logout}
      scannedPartRef={scannedPartRef}
    />
  );
}

function Main({ session, screen, go, logout, scannedPartRef }) {
  if (screen === 'home') {
    return (
      <SafeAreaView style={styles.root}>
        <Header
          title="Sleeping Stock Mobile"
          subtitle={session?.mobile_user?.branch_name || ''}
          rightLabel="Reset"
          onRightPress={logout}
        />
        <ScrollView contentContainerStyle={styles.wrap}>
          <Image source={require('./assets/icon.png')} style={styles.homeLogo} resizeMode="contain" />
          <Text style={styles.welcome}>Welcome, {session?.mobile_user?.name || 'User'}</Text>
          {[
            ['Notifications', 'notifications'],
            ['Stock Verification', 'verify'],
            ['Stock Search', 'search'],
          ].map(([label, destination]) => (
            <Pressable key={destination} style={styles.menu} onPress={() => go(destination)}>
              <Text style={styles.menuText}>{label}</Text>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const title =
    screen === 'notifications'
      ? 'Notifications'
      : screen === 'verify'
        ? 'Stock Verification'
        : screen === 'scanner'
          ? 'Camera OCR'
          : 'Stock Search';

  return (
    <SafeAreaView style={styles.root}>
      <Header title={title} leftLabel="‹ Back" onLeftPress={() => go('home')} />
      {screen === 'notifications' ? <Notifications /> : null}
      {screen === 'verify' ? <Verification go={go} scannedPartRef={scannedPartRef} /> : null}
      {screen === 'scanner' ? <Scanner go={go} scannedPartRef={scannedPartRef} /> : null}
      {screen === 'search' ? <Search /> : null}
    </SafeAreaView>
  );
}

function Header({ title, subtitle, leftLabel, onLeftPress, rightLabel, onRightPress }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {leftLabel ? (
          <Pressable onPress={onLeftPress}>
            <Text style={styles.back}>{leftLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.headerSide, styles.headerSideRight]}>
        {rightLabel ? (
          <Pressable onPress={onRightPress}>
            <Text style={styles.back}>{rightLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Notifications() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);

  async function load() {
    setBusy(true);
    try {
      const response = await api.get('/notifications');
      setRows(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      Alert.alert('Unable to load', message(requestError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function act(id, type) {
    try {
      await api.post(`/notifications/${id}/${type}`, {});
      await load();
    } catch (requestError) {
      Alert.alert(type === 'accept' ? 'Accept failed' : 'Skip failed', message(requestError));
    }
  }

  if (busy) return <ActivityIndicator style={styles.loader} color={GREEN} />;

  return (
    <FlatList
      contentContainerStyle={styles.wrap}
      data={rows}
      keyExtractor={(item, index) => String(item.id || item.request_number || index)}
      ListEmptyComponent={<Text style={styles.sub}>No active requests for this branch.</Text>}
      renderItem={({ item }) => (
        <Card>
          <Text style={styles.cardTitle}>{item.request_number || item.id}</Text>
          <Text>Reference: {item.order_number || '-'}</Text>
          <Text>Total Qty: {item.quantity ?? item.requested_qty ?? 0}</Text>
          <Text>Status: {item.status || '-'}</Text>
          <Text>Skips: {item.skip_count || 0}/2</Text>
          <View style={styles.row}>
            <Button title="Accept" onPress={() => act(item.id, 'accept')} />
            <Button
              title="Skip"
              outline
              disabled={!item.skip_allowed}
              onPress={() => act(item.id, 'skip')}
            />
          </View>
        </Card>
      )}
    />
  );
}

function Verification({ go, scannedPartRef }) {
  const [form, setForm] = useState({
    part_number: scannedPartRef.current || '',
    physical_quantity: '',
    location: '',
    remark: '',
    entry_method: scannedPartRef.current ? 'CAMERA_OCR' : 'MANUAL',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (scannedPartRef.current) {
      setForm(current => ({
        ...current,
        part_number: scannedPartRef.current,
        entry_method: 'CAMERA_OCR',
      }));
      scannedPartRef.current = '';
    }
  }, [scannedPartRef]);

  const manualRemarkMissing = form.entry_method === 'MANUAL' && !form.remark.trim();
  const invalidQuantity = form.physical_quantity === '' || Number.isNaN(Number(form.physical_quantity));

  async function submit() {
    setBusy(true);
    try {
      await api.post('/stock-verifications', {
        ...form,
        part_number: cleanPartNumber(form.part_number),
        physical_quantity: Number(form.physical_quantity),
        location: form.location.trim(),
        remark: form.remark.trim(),
      });
      Alert.alert('Saved', 'Verification stored as a separate history record.');
      setForm({
        part_number: '',
        physical_quantity: '',
        location: '',
        remark: '',
        entry_method: 'MANUAL',
      });
    } catch (requestError) {
      Alert.alert('Unable to submit', message(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Field
          label="Part Number"
          autoCapitalize="characters"
          value={form.part_number}
          onChangeText={value =>
            setForm(current => ({
              ...current,
              part_number: value.toUpperCase(),
              entry_method: 'MANUAL',
            }))
          }
        />
        <Button title="Open Camera OCR" outline onPress={() => go('scanner')} />
        <Field
          label="Physical Quantity"
          keyboardType="decimal-pad"
          value={form.physical_quantity}
          onChangeText={value => setForm(current => ({ ...current, physical_quantity: value }))}
        />
        <Field
          label="Location"
          value={form.location}
          onChangeText={value => setForm(current => ({ ...current, location: value }))}
        />
        <Field
          label={form.entry_method === 'MANUAL' ? 'Remark (Required for manual entry)' : 'Remark (Optional)'}
          multiline
          value={form.remark}
          onChangeText={value => setForm(current => ({ ...current, remark: value }))}
        />
        <Button
          title={busy ? 'Submitting...' : 'Submit Verification'}
          disabled={
            busy ||
            !cleanPartNumber(form.part_number) ||
            invalidQuantity ||
            !form.location.trim() ||
            manualRemarkMissing
          }
          onPress={submit}
        />
      </Card>
    </ScrollView>
  );
}

function Scanner({ go, scannedPartRef }) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [scanRequested, setScanRequested] = useState(false);
  const [detected, setDetected] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  function handleOcr(data) {
    if (!scanRequested) return;
    const value = cleanPartNumber(data?.resultText || data?.text || '');
    if (!value) return;
    setDetected(value);
    setScanRequested(false);
    setBusy(false);
  }

  function beginScan() {
    setDetected('');
    setBusy(true);
    setScanRequested(true);
    setTimeout(() => {
      setBusy(false);
      setScanRequested(false);
    }, 3500);
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Camera permission is required. You can continue with manual entry.</Text>
        <Button title="Request Camera Permission" onPress={requestPermission} />
        <Button title="Back to Manual Entry" outline onPress={() => go('verify')} />
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>Back camera is unavailable.</Text>
        <Button title="Back" onPress={() => go('verify')} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <OcrCamera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        mode="recognize"
        options={{
          language: 'latin',
          frameSkipThreshold: 8,
          useLightweightMode: true,
          scanRegion: SCAN_REGION,
        }}
        callback={handleOcr}
      />
      <View pointerEvents="none" style={styles.roi} />
      <View style={styles.scanPanel}>
        <Button title={busy ? 'Scanning...' : 'Scan'} disabled={busy} onPress={beginScan} />
        {detected ? (
          <Pressable
            onPress={() => {
              scannedPartRef.current = detected;
              go('verify');
            }}
          >
            <Text style={styles.detected}>{detected}</Text>
          </Pressable>
        ) : (
          <Text style={styles.scanHelp}>
            Align the complete part number inside the box, then tap Scan. Tap detected text to fill the Part Number field.
          </Text>
        )}
      </View>
    </View>
  );
}

function Search() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    const parts = [...new Set(text.split(/\r?\n/).map(cleanPartNumber).filter(Boolean))];
    if (!parts.length) return;

    setBusy(true);
    try {
      const response = await api.post('/stock-search', { part_numbers: parts });
      setRows(Array.isArray(response.data) ? response.data : []);
    } catch (requestError) {
      Alert.alert('Search failed', message(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Field
          label="Part Numbers (one per line)"
          multiline
          autoCapitalize="characters"
          value={text}
          onChangeText={setText}
        />
        <Button
          title={busy ? 'Searching...' : 'Search Branch Stock'}
          disabled={busy || !text.trim()}
          onPress={run}
        />
      </Card>
      {rows.map((row, index) => (
        <Card key={`${row.part_number || 'part'}-${index}`}>
          <Text style={styles.cardTitle}>{row.part_number || '-'}</Text>
          <Text>{row.part_name || row.item_name || '-'}</Text>
          <Text>Available: {row.quantity ?? 0}</Text>
          <Text>Location: {row.location || row.loc || '-'}</Text>
          <Text>Category: {row.part_category || row.category || '-'}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: BACKGROUND },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BACKGROUND,
    padding: 24,
    gap: 12,
  },
  loader: { marginTop: 40 },
  wrap: { padding: 18, gap: 14 },
  header: {
    backgroundColor: GREEN,
    paddingHorizontal: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSide: { width: 74 },
  headerSideRight: { alignItems: 'flex-end' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: 'white', fontWeight: '800', fontSize: 18, textAlign: 'center' },
  headerSub: { color: '#dbece4', marginTop: 2, textAlign: 'center' },
  back: { color: 'white', fontWeight: '700' },
  pairLogo: { width: 220, height: 220, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  homeLogo: { width: 150, height: 150, alignSelf: 'center', marginBottom: 2 },
  title: { fontSize: 24, fontWeight: '800', color: '#25312c', textAlign: 'center', marginTop: 8 },
  sub: { color: '#67716c', textAlign: 'center', marginVertical: 10, lineHeight: 21 },
  welcome: { fontSize: 20, fontWeight: '800', color: '#25312c' },
  card: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d9dfdc',
    gap: 8,
    width: '100%',
  },
  cardTitle: { fontWeight: '800', fontSize: 17, color: '#24322b' },
  fieldWrap: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: '#51605a', marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd3cf',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#18221d',
    backgroundColor: '#fafcfb',
    minHeight: 46,
  },
  button: {
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    minWidth: 110,
    marginTop: 8,
  },
  buttonOutline: { backgroundColor: 'white', borderWidth: 1, borderColor: GREEN },
  buttonText: { color: 'white', fontWeight: '800' },
  buttonOutlineText: { color: GREEN },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  error: { color: '#b42318' },
  menu: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: '#d4dbd7',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuText: { fontSize: 20, fontWeight: '800', color: '#26342d' },
  arrow: { fontSize: 30, color: GREEN },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  roi: {
    position: 'absolute',
    left: '8%',
    width: '84%',
    top: '30%',
    height: '22%',
    borderWidth: 3,
    borderColor: '#7ee2aa',
    borderRadius: 12,
  },
  scanPanel: { position: 'absolute', left: 16, right: 16, bottom: 25, gap: 12 },
  detected: {
    backgroundColor: 'white',
    padding: 14,
    borderRadius: 10,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 18,
    color: GREEN,
  },
  scanHelp: { color: 'white', textAlign: 'center', lineHeight: 20 },
});
