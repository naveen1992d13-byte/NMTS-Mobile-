import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  findNodeHandle,
  FlatList,
  Image,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { extractTextFromImage } from 'expo-text-extractor';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

import {
  getSession,
  saveSession,
  clearSession,
  getBranchTransferredFlag,
  setBranchTransferredFlag,
  isBranchTransferredPayload,
  BRANCH_TRANSFERRED_MESSAGE,
} from './src/services/session';
import {
  ApiError,
  setOnSessionInvalidated,
  clearApiAuthCache,
  verifyPairing,
  validateSession,
  sessionHeartbeat,
  logoutSession,
  getNotifications,
  acceptNotification,
  rejectNotification,
  submitPartResponse,
  completePicking,
  getTransferTargets,
  transferOwnership,
  releaseOwnership,
  RELEASE_REASONS,
  errorCode,
  searchStock,
  getLatestAppVersion,
  getAutoPerpetualTasks,
  getAutoPerpetualSessionToday,
  getAutoPerpetualSessions,
  saveAutoCount,
  finalizeAutoCounts,
  isBranchTransferredError,
} from './src/api';
import { MANUAL_PAIRING_API_BASE_URL, normalizeApiBaseUrl } from './src/config/env';
import {
  initOfflineQueue,
  enqueueAndTrySync,
  getPendingCount,
  subscribeToQueueChanges,
  subscribeToSyncStatus,
  startAutoSync,
  syncQueue,
  clearQueuedRecords,
} from './src/services/offlineQueue';
import {
  dismissBranchRequestNotifications,
  dismissRequestNotification,
  initPushNotifications,
  registerForPushNotificationsAsync,
} from './src/services/pushNotifications';
import { startRequestRingtone, stopRequestRingtone } from './src/services/requestRingtone';
import {
  addNativePickListener,
  addNativeRejectListener,
  addNativeIncomingAlertListener,
  addNativeRequestPickedListener,
  stopRinging,
  logoutCleanup,
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
  canUseFullScreenIntent,
  requestUseFullScreenIntent,
} from './src/services/nativeRequestAlert';
import {
  verifyTodayStockUploaded,
  isStockGatedScreen,
  clearTodayStockGateCache,
  TODAY_STOCK_MISSING_MESSAGE,
} from './src/services/todayStockGate';
import {
  normalizePartNumber,
  splitPartNumbers,
  mapStockRow,
  calculateVerification,
  numberValue,
  isActionableAutoTask,
} from './src/utils/stockHelpers';
import { BLUE, BG, BORDER, CARD_SOLID, DANGER, DARK, MUTED, NEON_BLUE, NEON_CYAN, NEON_GREEN, NEON_YELLOW, SUCCESS, WARNING } from './src/theme';
import AutoPerpetualScreen from './src/components/AutoPerpetualScreen';
import StockAvailabilityScreen from './src/components/StockAvailabilityScreen';
import MultiPartSearchScreen from './src/components/MultiPartSearchScreen';
import { ScreenBackground } from './src/components/ScreenBackground';
import VoiceTypeButton from './src/components/VoiceTypeButton';
import MandatoryUpdateScreen from './src/components/MandatoryUpdateScreen';
import IncomingRequestPopup from './src/components/IncomingRequestPopup';
import {
  ALREADY_PICKED_MESSAGE,
  CONFIRM_WINDOW_SECONDS,
  asOwnedPickedRequest,
  buildIncomingAlert,
  canCompleteRequest,
  canEditRequest,
  canPickRequest,
  canRejectRequest,
  canReleaseRequest,
  canTransferRequest,
  confirmSecondsRemaining,
  findRequestGroup,
  formatSlaRemaining,
  isBranchRequest,
  isRequestClosedPush,
  isRequestPickedPush,
  isRequestTransferredPush,
  ownerName,
  requestStatus,
  resolveNotificationData,
  statusLabelFor,
} from './src/utils/requestAlert';
import {
  Empty,
  Field,
  Header,
  PrimaryButton,
  SecondaryButton,
  SquareButton,
  StatusPill,
  SyncStatusBanner,
} from './src/components/ui';

const CURRENT_VERSION_CODE = Constants.expoConfig?.android?.versionCode || 1;
const CURRENT_VERSION_NAME = Constants.expoConfig?.version || '1.0.0';
// Capture once. Do not subscribe to dimension changes — those listeners
// re-layout Pairing and cause the sideways jump seen when the keyboard
// opens, closes, or switches between text and numeric IMEs.
const PAIR_SCREEN = Dimensions.get('screen');
const PAIR_WINDOW = Dimensions.get('window');

function friendlyError(error) {
  if (error instanceof ApiError) return error.message;
  return error?.message || 'Something went wrong. Please try again.';
}

function requestPartLoc(part) {
  const candidates = [part?.loc, part?.loc_at_request, part?.bin_location];
  for (const value of candidates) {
    if (value != null && String(value) !== '') return value;
  }
  return '-';
}

function cleanPartNumber(value) {
  return normalizePartNumber(value);
}

function extractPartDetails(text) {
  const rawLines = String(text || '')
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const tokenCandidates = rawLines
    .flatMap((line) => line.split(/[\s,;:|]+/))
    .map((raw) => ({ raw, cleaned: cleanPartNumber(raw) }))
    .filter(({ cleaned }) => cleaned.length >= 4 && cleaned.length <= 40)
    .map((item) => {
      let score = 0;
      if (/\d/.test(item.cleaned)) score += 4;
      if (/[A-Z]/.test(item.cleaned)) score += 4;
      if (item.cleaned.length >= 7) score += 2;
      if (item.cleaned.length >= 10) score += 1;
      return { ...item, score };
    })
    .filter((item) => item.score >= 6)
    .sort((a, b) => b.score - a.score || b.cleaned.length - a.cleaned.length);

  const partNumber = tokenCandidates[0]?.cleaned || '';
  const description = rawLines
    .filter((line) => cleanPartNumber(line) !== partNumber)
    .filter((line) => /[A-Za-z]{3,}/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return { partNumber, description };
}

function differenceFor(systemQty, physicalQty, unitValue) {
  return calculateVerification(systemQty, physicalQty, unitValue);
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState('pair');
  const [session, setSession] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', message: '' });
  const [mandatoryUpdate, setMandatoryUpdate] = useState(null);

  const [mobileUserId, setMobileUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingScanned, setPairingScanned] = useState(false);
  const [showManualPairing, setShowManualPairing] = useState(false);
  const [branchTransferred, setBranchTransferred] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [incomingAlert, setIncomingAlert] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReasonDraft, setRejectReasonDraft] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [confirmSecondsLeft, setConfirmSecondsLeft] = useState(null);
  const [requestRows, setRequestRows] = useState([]);
  const [requestBusy, setRequestBusy] = useState(false);

  const [verificationInput, setVerificationInput] = useState('');
  const [physicalQty, setPhysicalQty] = useState('');
  const [physicalLocation, setPhysicalLocation] = useState('');
  const [verificationRemark, setVerificationRemark] = useState('');
  const [scannedPartDescription, setScannedPartDescription] = useState('');
  const [selectedPart, setSelectedPart] = useState(null);
  const [verificationList, setVerificationList] = useState([]);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [damageQty, setDamageQty] = useState('');

  const [autoTasks, setAutoTasks] = useState([]);
  const [autoSessionId, setAutoSessionId] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoAssignedCount, setAutoAssignedCount] = useState(0);
  const [autoCompletedCount, setAutoCompletedCount] = useState(0);
  const [autoLocalVerified, setAutoLocalVerified] = useState({});
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const [autoSessions, setAutoSessions] = useState([]);
  const [autoToday, setAutoToday] = useState('');
  const [autoTodayCreated, setAutoTodayCreated] = useState(false);
  const [autoTodayMessage, setAutoTodayMessage] = useState('');
  const [autoViewMode, setAutoViewMode] = useState('list');
  const [autoSelectedSession, setAutoSelectedSession] = useState(null);
  const [autoReadOnly, setAutoReadOnly] = useState(false);
  const [autoReaudit, setAutoReaudit] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchNotFound, setSearchNotFound] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchUploadMessage, setSearchUploadMessage] = useState('');
  const [agingThreshold, setAgingThreshold] = useState(90);

  const [multiInput, setMultiInput] = useState('');
  const [multiResults, setMultiResults] = useState([]);
  const [multiNotFound, setMultiNotFound] = useState([]);
  const [multiBusy, setMultiBusy] = useState(false);
  const [multiUploadMessage, setMultiUploadMessage] = useState('');

  const [scannerTarget, setScannerTarget] = useState('verification');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const scanLine = useRef(new Animated.Value(0)).current;
  const scanFrameLayout = useRef({ x: 36, y: 190, width: 320, height: 120 });
  const cameraLayout = useRef({ width: 390, height: 700 });
  const screenRef = useRef(screen);
  const loadAutoTasksRef = useRef(null);
  const loadNotificationsRef = useRef(null);
  const dismissedRequestKeysRef = useRef(new Set());
  const stockGateScopeRef = useRef('');
  const confirmExpiredAlertedRef = useRef(false);
  const sessionRef = useRef(null);
  const notificationsRef = useRef([]);
  const incomingNotificationRef = useRef(null);
  const incomingAlertRef = useRef(null);
  const incomingShownKeyRef = useRef(null);
  const fsiOnboardingRef = useRef({ initialShown: false, returnChecked: false });
  const openRequestRef = useRef(null);
  const pickRequestRef = useRef(null);
  const transferAlertedRef = useRef(false);
  const handleBranchTransferredRef = useRef(null);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const clearOldBranchCache = useCallback(async () => {
    try { await clearQueuedRecords(); } catch (_e) {}
    clearTodayStockGateCache();
    dismissedRequestKeysRef.current.clear();
    incomingAlertRef.current = null;
    incomingShownKeyRef.current = null;
    incomingNotificationRef.current = null;
    notificationsRef.current = [];
    setIncomingAlert(null);
    setNotifications([]);
    setSelectedRequest(null);
    setRequestRows([]);
    setVerificationList([]);
    setSelectedPart(null);
    setSearchResults([]);
    setSearchNotFound([]);
    setSearchInput('');
    setMultiResults([]);
    setMultiNotFound([]);
    setMultiInput('');
    setAutoTasks([]);
    setAutoSessionId('');
    setAutoLocalVerified({});
    setPendingCount(0);
    setMandatoryUpdate(null);
  }, []);

  const handleBranchTransferred = useCallback(async () => {
    stopRinging();
    await stopRequestRingtone();
    await dismissBranchRequestNotifications();
    logoutCleanup();
    clearApiAuthCache();
    await clearSession();
    await setBranchTransferredFlag(true);
    await clearOldBranchCache();
    setSession(null);
    setBranchTransferred(true);
    setScreen('pair');
    if (!transferAlertedRef.current) {
      transferAlertedRef.current = true;
      Alert.alert('Branch Transferred', BRANCH_TRANSFERRED_MESSAGE);
    }
  }, [clearOldBranchCache]);

  useEffect(() => {
    handleBranchTransferredRef.current = handleBranchTransferred;
  }, [handleBranchTransferred]);

  useEffect(() => {
    let mounted = true;
    const stopAutoSync = startAutoSync({ periodicIntervalMs: 30000 });
    const unsubscribeQueue = subscribeToQueueChanges(async () => {
      try {
        const count = await getPendingCount();
        if (mounted) setPendingCount(count);
      } catch (_e) {}
    });
    const unsubscribeSync = subscribeToSyncStatus((status) => {
      if (mounted) setSyncStatus(status);
    });
    const unsubscribeNetwork = NetInfo.addEventListener((state) => {
      if (mounted) setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
    });

    setOnSessionInvalidated(async (error) => {
      if (isBranchTransferredError(error) || isBranchTransferredPayload(error?.data)) {
        await handleBranchTransferredRef.current?.();
        return;
      }
      stopRinging();
      await stopRequestRingtone();
      await dismissBranchRequestNotifications();
      logoutCleanup();
      clearApiAuthCache();
      await clearSession();
      if (!mounted) return;
      incomingAlertRef.current = null;
      setIncomingAlert(null);
      setSession(null);
      setMandatoryUpdate(null);
      setScreen('pair');
      Alert.alert('Session Ended', 'This mobile must be paired again.');
    });

    (async () => {
      try {
        await initOfflineQueue();
        const count = await getPendingCount();
        if (mounted) setPendingCount(count);
      } catch (_e) {}

      try {
        const latest = await getLatestAppVersion();
        if (latest?.mandatory && numberValue(latest.version_code) > CURRENT_VERSION_CODE) {
          if (mounted) {
            setMandatoryUpdate(latest);
            setBooting(false);
            return;
          }
        }
      } catch (_e) {}

      try {
        const transferred = await getBranchTransferredFlag();
        if (transferred) {
          await handleBranchTransferredRef.current?.();
          return;
        }
        const saved = await getSession();
        if (saved) {
          setSession(saved);
          try {
            await validateSession();
          } catch (error) {
            if (error instanceof ApiError && error.kind === 'auth') return;
          }
          if (mounted) setScreen('home');
        }
      } finally {
        if (mounted) setBooting(false);
      }
    })();

    return () => {
      mounted = false;
      stopAutoSync?.();
      unsubscribeQueue?.();
      unsubscribeSync?.();
      unsubscribeNetwork?.();
    };
  }, []);

  const applyAutoTaskPayload = useCallback((data, { resetLocal = false } = {}) => {
    const tasks = (data?.tasks || []).filter((task) => isActionableAutoTask(task));
    setAutoTasks(tasks);
    if (data?.session_id) setAutoSessionId(data.session_id);
    setAutoAssignedCount(numberValue(data?.assigned_count || tasks.length || 0));
    setAutoCompletedCount(numberValue(data?.completed_count || 0));
    setAutoReadOnly(Boolean(data?.read_only));
    setAutoReaudit(Boolean(data?.reaudit));
    setAutoLocalVerified((current) => {
      const base = resetLocal ? {} : current;
      const pendingParts = new Set(tasks.map((t) => cleanPartNumber(t.part_number)));
      const next = {};
      Object.entries(base).forEach(([part, row]) => {
        if (pendingParts.has(part) || !row.synced) next[part] = row;
      });
      tasks.forEach((task) => {
        const part = cleanPartNumber(task.part_number);
        if (!task.count_saved) {
          // Residual offline risk: never copy restricted qty into UI state before first Save.
          if (next[part] && !next[part].verified) {
            next[part] = { ...next[part], systemQty: undefined, status: '', differenceQty: 0 };
          }
          return;
        }
        next[part] = {
          ...(next[part] || {}),
          verified: true,
          synced: true,
          physicalQty: task.physical_quantity,
          originalPhysicalQty: task.original_physical_quantity ?? next[part]?.originalPhysicalQty,
          systemQty: task.system_qty,
          status: String(task.quantity_status || next[part]?.status || '').toUpperCase(),
          differenceQty: task.difference,
          editCount: task.edit_count || next[part]?.editCount || 0,
          editHistory: task.quantity_edit_history || next[part]?.editHistory || [],
          finalized: Boolean(task.quantity_finalized),
        };
      });
      return next;
    });
    return tasks;
  }, []);

  const loadAutoSessions = useCallback(async () => {
    setAutoBusy(true);
    try {
      const [listResp, todayResp] = await Promise.all([
        getAutoPerpetualSessions(),
        getAutoPerpetualSessionToday().catch(() => null),
      ]);
      const today = listResp?.today || todayResp?.today || todayResp?.allocation_date || '';
      const created = Boolean(listResp?.today_created ?? todayResp?.today_created);
      setAutoToday(today);
      setAutoTodayCreated(created);
      setAutoTodayMessage(listResp?.message || todayResp?.message || (created ? '' : "Today's session is not created yet"));
      setAutoSessions(listResp?.sessions || []);
      if (!created) {
        setAutoSessionId('');
        setAutoTasks([]);
        setAutoAssignedCount(0);
        setAutoCompletedCount(0);
      }
    } catch (error) {
      Alert.alert('Auto Perpetual', friendlyError(error));
      setAutoSessions([]);
      setAutoTasks([]);
    } finally {
      setAutoBusy(false);
    }
  }, []);

  const loadAutoSessionTasks = useCallback(async (session, mode = 'view', { resetLocal = false } = {}) => {
    setAutoBusy(true);
    try {
      const isToday = Boolean(session?.is_today || session?.card_status === 'TODAY');
      const apiMode = 'reaudit';
      const data = await getAutoPerpetualTasks({
        sessionId: session?.session_id,
        mode: apiMode,
      });
      const openedToday = Boolean(data?.is_today) || isToday;
      setAutoSelectedSession({
        ...(session || {}),
        session_id: data?.session_id || session?.session_id,
        allocation_date: data?.allocation_date || session?.allocation_date,
        card_status: session?.card_status,
        is_today: openedToday,
      });
      setAutoViewMode(mode === 'reaudit' && !openedToday ? 'reaudit' : 'view');
      applyAutoTaskPayload(data, { resetLocal });
    } catch (error) {
      Alert.alert('Auto Perpetual', friendlyError(error));
      setAutoTasks([]);
    } finally {
      setAutoBusy(false);
    }
  }, [applyAutoTaskPayload]);

  const loadAutoTasks = useCallback(async () => {
    if (autoViewMode !== 'list' && autoSelectedSession?.session_id) {
      await loadAutoSessionTasks(autoSelectedSession, autoViewMode === 'reaudit' ? 'reaudit' : 'view');
      return;
    }
    setAutoViewMode('list');
    setAutoSelectedSession(null);
    setAutoReadOnly(false);
    setAutoReaudit(false);
    await loadAutoSessions();
  }, [autoViewMode, autoSelectedSession, loadAutoSessionTasks, loadAutoSessions]);

  const openAutoSession = useCallback((session, mode = 'view') => {
    setAutoLocalVerified({});
    loadAutoSessionTasks(session, mode, { resetLocal: true });
  }, [loadAutoSessionTasks]);

  const closeAutoSession = useCallback(() => {
    setAutoViewMode('list');
    setAutoSelectedSession(null);
    setAutoReadOnly(false);
    setAutoReaudit(false);
    setAutoTasks([]);
    setAutoLocalVerified({});
    setAutoSessionId('');
    loadAutoSessions();
  }, [loadAutoSessions]);

  const loadNotifications = useCallback(async () => {
    setNotificationsBusy(true);
    try {
      const rows = await getNotifications();
      const list = rows || [];
      setNotifications(list);
      notificationsRef.current = list;
      const currentAlert = incomingAlertRef.current;
      if (currentAlert) {
        const group = findRequestGroup(list, currentAlert);
        if (group) {
          const next = buildIncomingAlert(currentAlert.data || currentAlert, sessionRef.current, group);
          incomingAlertRef.current = next;
          setIncomingAlert(next);
          const keepTransferRing = currentAlert.type === 'request_transferred' && group.accepted_by_me && requestStatus(group) === 'picked';
          if (!canPickRequest(group) && !keepTransferRing) {
            stopRinging(group.request_group_key || group.request_number);
            stopRequestRingtone();
          }
        } else {
          stopRinging(currentAlert.request_group_key || currentAlert.request_number);
          stopRequestRingtone();
          incomingAlertRef.current = null;
          setIncomingAlert(null);
        }
      }
    } catch (error) {
      Alert.alert('Notifications', friendlyError(error));
    } finally {
      setNotificationsBusy(false);
    }
  }, []);

  useEffect(() => {
    loadAutoTasksRef.current = loadAutoTasks;
    loadNotificationsRef.current = loadNotifications;
  }, [loadAutoTasks, loadNotifications]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const key = [
      String(session?.brandName || '').trim().toLowerCase(),
      String(session?.dealerName || '').trim().toLowerCase(),
      String(session?.branch || '').trim().toLowerCase(),
    ].join('|');
    if (stockGateScopeRef.current && stockGateScopeRef.current !== key) {
      clearTodayStockGateCache();
    }
    stockGateScopeRef.current = key;
  }, [session?.brandName, session?.dealerName, session?.branch]);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    if (session?.deviceId) loadNotifications();
  }, [session?.deviceId, loadNotifications]);

  useEffect(() => {
    if (!session?.sessionToken) return undefined;
    let cancelled = false;
    const beat = async () => {
      if (cancelled || AppState.currentState !== 'active') return;
      try {
        await sessionHeartbeat();
      } catch (_error) {}
    };
    beat();
    const interval = setInterval(beat, 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') beat();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, [session?.sessionToken]);

  const showIncomingFromPush = useCallback(async (data, notification) => {
    const payload = resolveNotificationData(data);
    if (isBranchTransferredPayload(payload) || isBranchTransferredPayload(data)) {
      handleBranchTransferredRef.current?.();
      return;
    }
    if (isRequestPickedPush(payload) || isRequestClosedPush(payload)) {
      const key = payload.request_group_key || payload.requestId || payload.request_number;
      stopRinging(key);
      stopRequestRingtone();
      incomingAlertRef.current = null;
      setIncomingAlert(null);
      loadNotificationsRef.current?.();
      return;
    }
    if (!sessionRef.current?.sessionToken) return;
    if (!isBranchRequest(payload) && !isRequestTransferredPush(payload)) return;
    const key = String(payload.request_group_key || payload.requestId || payload.request_number || '');
    if (key && incomingShownKeyRef.current === key && incomingAlertRef.current) return;
    if (key) incomingShownKeyRef.current = key;
    incomingNotificationRef.current = notification || incomingNotificationRef.current || null;
    let rows = notificationsRef.current || [];
    try {
      rows = (await getNotifications()) || rows;
      setNotifications(rows);
    } catch (_e) {}
    const group = findRequestGroup(rows, payload);
    const alert = buildIncomingAlert(payload, sessionRef.current, group);
    incomingAlertRef.current = alert;
    setIncomingAlert(alert);
  }, []);

  const markRequestDismissed = useCallback((alertOrGroup) => {
    if (alertOrGroup?.request_group_key) dismissedRequestKeysRef.current.add(alertOrGroup.request_group_key);
    if (alertOrGroup?.request_number) dismissedRequestKeysRef.current.add(alertOrGroup.request_number);
    if (alertOrGroup?.requestId) dismissedRequestKeysRef.current.add(String(alertOrGroup.requestId));
  }, []);

  const clearIncomingPopupLocal = useCallback(async (alert) => {
    incomingShownKeyRef.current = null;
    incomingAlertRef.current = null;
    stopRinging(alert?.request_group_key || alert?.requestId || alert?.request_number);
    await dismissRequestNotification(incomingNotificationRef.current);
    await dismissBranchRequestNotifications();
    incomingNotificationRef.current = null;
    markRequestDismissed(alert);
    await stopRequestRingtone();
    setIncomingAlert(null);
  }, [markRequestDismissed]);

  const rejectIncomingAlert = useCallback(async (dataOrAlert, reason) => {
    const trimmed = String(reason || '').trim();
    if (!trimmed) {
      Alert.alert('Reason required', 'Please enter a rejection reason.');
      return;
    }
    const alert = dataOrAlert || incomingAlert || {};
    const key = alert.request_group_key || alert.requestId || '';
    try {
      if (key) await rejectNotification(key, trimmed);
    } catch (error) {
      Alert.alert('Unable to Reject', friendlyError(error));
      loadNotificationsRef.current?.();
      return;
    }
    await clearIncomingPopupLocal(alert);
    setRejectModal(null);
    setRejectReasonDraft('');
    loadNotificationsRef.current?.();
  }, [incomingAlert, clearIncomingPopupLocal]);

  const rejectRequest = useCallback(async (group, reason) => {
    const trimmed = String(reason || '').trim();
    if (!trimmed) {
      Alert.alert('Reason required', 'Please enter a rejection reason.');
      return;
    }
    if (!group?.request_group_key) return;
    try {
      stopRinging(group.request_group_key || group.request_number);
      await rejectNotification(group.request_group_key, trimmed);
      markRequestDismissed(group);
      await stopRequestRingtone();
      await dismissBranchRequestNotifications();
      setRejectModal(null);
      setRejectReasonDraft('');
      loadNotifications();
    } catch (error) {
      Alert.alert('Unable to Reject', friendlyError(error));
      loadNotifications();
    }
  }, [markRequestDismissed, loadNotifications]);

  const promptRejectReason = useCallback((groupOrAlert, onConfirm) => {
    if (Platform.OS === 'ios' && typeof Alert.prompt === 'function') {
      Alert.prompt(
        'Reject Request',
        'Enter a rejection reason (required).',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reject',
            style: 'destructive',
            onPress: (text) => {
              const trimmed = String(text || '').trim();
              if (!trimmed) {
                Alert.alert('Reason required', 'Please enter a rejection reason.');
                return;
              }
              onConfirm?.(trimmed);
            },
          },
        ],
        'plain-text'
      );
      return;
    }
    setRejectReasonDraft('');
    setRejectModal({
      visible: true,
      requestGroupKey: groupOrAlert?.request_group_key || '',
      alert: groupOrAlert,
      onConfirm,
    });
  }, []);

  const openRejectFromPush = useCallback(async (data) => {
    const payload = resolveNotificationData(data);
    let rows = notificationsRef.current || [];
    try {
      rows = (await getNotifications()) || rows;
      setNotifications(rows);
    } catch (_e) {}
    const group = findRequestGroup(rows, payload);
    const alert = buildIncomingAlert(payload, sessionRef.current, group);
    promptRejectReason(alert, (reason) => rejectIncomingAlert(alert, reason));
  }, [promptRejectReason, rejectIncomingAlert]);

  const pickIncomingFromPush = useCallback(async (data) => {
    let rows = notificationsRef.current || [];
    try {
      rows = (await getNotifications()) || rows;
      setNotifications(rows);
    } catch (_e) {}
    const group = findRequestGroup(rows, data);
    if (group && (group.accepted_by_me || data?.type === 'request_transferred') && openRequestRef.current) {
      incomingAlertRef.current = null;
      setIncomingAlert(null);
      openRequestRef.current(data?.type === 'request_transferred' ? group : asOwnedPickedRequest(group));
      return;
    }
    if (group && pickRequestRef.current) {
      await pickRequestRef.current(group);
      return;
    }
    setScreen('notifications');
  }, []);

  // Register push listeners once per device session — not on every screen change.
  useEffect(() => {
    if (!session?.deviceId) return undefined;
    let teardown = () => {};
    const pickSub = addNativePickListener((data) => {
      pickIncomingFromPush(data);
    });
    const rejectSub = addNativeRejectListener((data) => {
      openRejectFromPush(data);
    });
    const incomingSub = addNativeIncomingAlertListener((data) => {
      const key = data.request_group_key || data.requestId || data.request_number;
      if (key && dismissedRequestKeysRef.current.has(key) && data.type !== 'request_transferred') return;
      showIncomingFromPush(data);
    });
    const pickedSub = addNativeRequestPickedListener((data) => {
      const key = data.request_group_key || data.requestId || data.request_number;
      const name = data.picked_by_name;
      stopRinging(key);
      stopRequestRingtone();
      incomingAlertRef.current = null;
      setIncomingAlert(null);
      if (name) Alert.alert('Already Picked', `Already picked by ${name}`);
      loadNotificationsRef.current?.();
    });
    const promptFullScreenIntent = (isReturn) => {
      if (isReturn) {
        if (fsiOnboardingRef.current.returnChecked) return;
        fsiOnboardingRef.current.returnChecked = true;
      } else {
        if (fsiOnboardingRef.current.initialShown) return;
        fsiOnboardingRef.current.initialShown = true;
      }
      Alert.alert(
        'Allow lock-screen request alerts',
        'Incoming stock requests need permission to wake the screen and show the request over the lock screen. Please allow full-screen notifications on the next screen.',
        [{ text: 'Continue', onPress: () => requestUseFullScreenIntent() }]
      );
    };
    const onFsiAppState = (state) => {
      if (state !== 'active' || Platform.OS !== 'android') return;
      if (!fsiOnboardingRef.current.initialShown || fsiOnboardingRef.current.returnChecked) return;
      (async () => {
        try {
          const allowed = await canUseFullScreenIntent();
          if (!allowed) promptFullScreenIntent(true);
          else fsiOnboardingRef.current.returnChecked = true;
        } catch (_e) {}
      })();
    };
    const fsiAppSub = AppState.addEventListener('change', onFsiAppState);
    // One-time permission onboarding for this device session. Runs the
    // moment the app is logged in / paired (i.e. right after first install
    // + first open), so every permission the app needs is asked up front
    // instead of being scattered across screens:
    // 1. Notification permission — handled inside initPushNotifications()
    //    below (registerForPushNotificationsAsync), Android 13+ prompt.
    // 2. Battery-optimization exemption — standard Android API, same
    //    dialog on every OEM (Samsung, Xiaomi, Vivo, Oppo, OnePlus,
    //    stock Android). Without this, background/locked-screen alerts
    //    can be delayed or dropped by the OS regardless of phone brand.
    // 3. Android 14+ full-screen intent — needed to wake a locked phone
    //    and show IncomingRequestPopup. Re-checked once when the user
    //    returns from Settings; not re-prompted on every foreground.
    // 4. Camera permission — needed for QR pairing and part-number scan.
    if (Platform.OS === 'android') {
      (async () => {
        try {
          const exempt = await isIgnoringBatteryOptimizations();
          if (!exempt) {
            Alert.alert(
              'Allow request alerts in background',
              'To make sure incoming request alerts ring even when the app is closed or the phone is locked, please allow Sleeping Stock to run without battery restrictions on the next screen.',
              [{ text: 'Continue', onPress: () => requestIgnoreBatteryOptimizations() }]
            );
          }
        } catch (_e) {}
        try {
          const allowed = await canUseFullScreenIntent();
          if (!allowed) promptFullScreenIntent(false);
        } catch (_e) {}
        try {
          if (!permission?.granted) {
            await requestPermission();
          }
        } catch (_e) {}
      })();
    }
    initPushNotifications({
      deviceId: session.deviceId,
      onNotificationReceived: (data, notification) => {
        if (isBranchTransferredPayload(data) || isBranchTransferredPayload(resolveNotificationData(data))) {
          handleBranchTransferredRef.current?.();
          return;
        }
        if (data?.type === 'auto_perpetual') loadAutoTasksRef.current?.();
        if (isBranchRequest(data)) {
          const key = data.request_group_key || data.requestId || data.request_number;
          if (
            key &&
            !dismissedRequestKeysRef.current.has(key) &&
            AppState.currentState === 'active' &&
            Platform.OS !== 'android'
          ) {
            startRequestRingtone(key);
          }
          showIncomingFromPush(data, notification);
          loadNotificationsRef.current?.();
          return;
        }
        if (screenRef.current === 'notifications') loadNotificationsRef.current?.();
      },
      onNotificationTapped: (data) => {
        if (isBranchTransferredPayload(data) || isBranchTransferredPayload(resolveNotificationData(data))) {
          handleBranchTransferredRef.current?.();
          return;
        }
        if (data?.type === 'auto_perpetual') {
          loadAutoTasksRef.current?.()?.finally?.(() => setScreen('auto'));
          return;
        }
        if (isBranchRequest(data)) {
          const key = data.request_group_key || data.requestId || data.request_number;
          if (key && !dismissedRequestKeysRef.current.has(key) && Platform.OS !== 'android') {
            startRequestRingtone(key);
          }
          showIncomingFromPush(data);
          return;
        }
      },
      onNotificationPicked: (data) => {
        showIncomingFromPush(data);
      },
      onNotificationRejected: (data) => {
        openRejectFromPush(data);
      },
      onTokenError: (error) => {
        console.log('[push] token error', error);
      },
    })
      .then((fn) => {
        teardown = fn || teardown;
      })
      .catch(() => {});
    return () => {
      pickSub?.remove?.();
      rejectSub?.remove?.();
      incomingSub?.remove?.();
      pickedSub?.remove?.();
      fsiAppSub?.remove?.();
      teardown();
    };
  }, [session?.deviceId, showIncomingFromPush, pickIncomingFromPush, openRejectFromPush]);

  useEffect(() => {
    const onAppState = (state) => {
      if (state !== 'active') return;
      (async () => {
        try {
          const rows = await getNotifications();
          notificationsRef.current = rows || [];
          setNotifications(rows || []);
          const currentAlert = incomingAlertRef.current;
          if (currentAlert) {
            const group = findRequestGroup(rows || [], currentAlert);
            const keepTransfer = currentAlert.type === 'request_transferred' && group?.accepted_by_me && requestStatus(group) === 'picked';
            const deadlineRaw =
              currentAlert.ring_deadline_at ||
              currentAlert.ringDeadlineAt ||
              currentAlert.data?.ring_deadline_at ||
              currentAlert.data?.ringDeadlineAt;
            const deadlineMs = deadlineRaw ? Date.parse(String(deadlineRaw)) : NaN;
            const ringExpired = Number.isFinite(deadlineMs) && deadlineMs <= Date.now();
            if (!group || (!canPickRequest(group) && !keepTransfer) || ringExpired) {
              stopRinging(currentAlert.request_group_key || currentAlert.request_number);
              stopRequestRingtone();
              incomingAlertRef.current = null;
              setIncomingAlert(null);
            }
          }
        } catch (_e) {}
      })();
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const handleHardwareBack = () => {
      if (booting || mandatoryUpdate) return true;

      if (screen === 'scanner') {
        setPairingScanned(false);
        setOcrBusy(false);
        setScreen(
          scannerTarget === 'pairing'
            ? 'pair'
            : scannerTarget === 'verification'
              ? 'verification'
              : scannerTarget === 'search'
                ? 'search'
                : 'multi-search'
        );
        return true;
      }

      if (screen === 'request') {
        setScreen('notifications');
        return true;
      }

      if (screen === 'multi-search') {
        setScreen('search');
        return true;
      }

      if (screen === 'auto' && autoViewMode !== 'list') {
        closeAutoSession();
        return true;
      }

      if (screen === 'verification' || screen === 'search' || screen === 'notifications' || screen === 'auto') {
        setScreen('home');
        return true;
      }

      // Home / Pair root: allow normal Android exit behaviour (do not trap).
      if (screen === 'home' || screen === 'pair') {
        return false;
      }

      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleHardwareBack);
    return () => subscription.remove();
  }, [booting, screen, scannerTarget, mandatoryUpdate, autoViewMode, closeAutoSession]);

  useEffect(() => {
    if (screen !== 'scanner') return undefined;
    scanLine.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [screen, scanLine]);

  useEffect(() => {
    if (screen === 'auto') loadAutoTasks();
  }, [screen, loadAutoTasks]);

  useEffect(() => {
    if (screen === 'auto') return undefined;
    setAutoViewMode('list');
    setAutoSelectedSession(null);
    return undefined;
  }, [screen]);

  useEffect(() => {
    if (screen === 'notifications') loadNotifications();
  }, [screen, loadNotifications]);

  useEffect(() => {
    if (!session?.deviceId) return undefined;
    const watch = screen === 'notifications' || screen === 'request' || Boolean(incomingAlert);
    if (!watch) return undefined;
    const timer = setInterval(() => loadNotificationsRef.current?.(), 8000);
    return () => clearInterval(timer);
  }, [session?.deviceId, screen, incomingAlert]);

  useEffect(() => {
    const deadline = selectedRequest?.confirm_deadline_at;
    const picked = selectedRequest && requestStatus(selectedRequest) === 'picked' && selectedRequest.accepted_by_me;
    if (!deadline || !picked) {
      setConfirmSecondsLeft(null);
      return undefined;
    }
    const tick = () => {
      const left = confirmSecondsRemaining(deadline);
      setConfirmSecondsLeft(left);
      if (left === 0 && !confirmExpiredAlertedRef.current) {
        confirmExpiredAlertedRef.current = true;
        Alert.alert(
          'Confirm window expired',
          'The quantity confirmation window has expired. Return to notifications to continue if the request is still available.'
        );
        setSelectedRequest(null);
        setRequestRows([]);
        setConfirmSecondsLeft(null);
        setScreen('notifications');
        loadNotificationsRef.current?.();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [selectedRequest?.confirm_deadline_at, selectedRequest?.status, selectedRequest?.accepted_by_me]);

  useEffect(() => {
    if (!selectedRequest?.request_group_key) return;
    const next = findRequestGroup(notifications, selectedRequest);
    if (!next) return;
    if (selectedRequest.accepted_by_me && requestStatus(selectedRequest) === 'picked' && !next.accepted_by_me && requestStatus(next) === 'pending') {
      return;
    }
    if (
      next.status !== selectedRequest.status ||
      next.picked_by_name !== selectedRequest.picked_by_name ||
      next.accepted_by_me !== selectedRequest.accepted_by_me ||
      next.rejection_reason !== selectedRequest.rejection_reason
    ) {
      const merged =
        next.accepted_by_me && requestStatus(next) === 'picked'
          ? asOwnedPickedRequest(next, {
              confirm_deadline_at: selectedRequest.confirm_deadline_at || next.confirm_deadline_at,
              confirm_window_seconds:
                selectedRequest.confirm_window_seconds || next.confirm_window_seconds || CONFIRM_WINDOW_SECONDS,
            })
          : next;
      setSelectedRequest(merged);
      if (!canEditRequest(next) && canEditRequest(selectedRequest)) {
        setRequestRows(
          (next.parts || []).map((part) => ({
            orderRequestId: part.order_request_id,
            partNumber: part.part_number,
            partName: part.description || part.part_name || '-',
            requestedQty: numberValue(part.requested_qty),
            availableQty: numberValue(part.available_qty_at_request ?? part.available_qty),
            loc: requestPartLoc(part),
            purchaseAging: part.purchase_aging_days ?? part.purchase_aging ?? '-',
            salesAging: part.sales_aging_days ?? part.sales_aging ?? '-',
            value: numberValue(part.part_value ?? part.value),
            acceptedQty: part.response_saved || part.accepted_qty != null ? String(part.accepted_qty) : '',
            remark: part.remark || '',
          }))
        );
      }
    }
  }, [notifications, selectedRequest]);

  const pairDevice = async ({ qrMobileUserId, pairingType, qrPairingCode, apiBaseUrl, pairingToken }) => {
    if (!userName.trim() || !mobileNumber.trim()) {
      Alert.alert('Required', 'Enter your name and mobile number before pairing.');
      return;
    }
    if (!qrPairingCode?.trim() || !apiBaseUrl) {
      Alert.alert('Pairing required', 'Enter the website pairing code and HTTPS server URL, or scan the QR.');
      return;
    }
    if (pairingType === 'REPAIR' && pairingToken && !qrMobileUserId?.trim()) {
      Alert.alert('Scan QR Code', 'Re-pair QR is missing the Mobile User ID.');
      return;
    }
    setPairingBusy(true);
    try {
      let pushToken = null;
      try {
        pushToken = await registerForPushNotificationsAsync();
      } catch (pushError) {
        console.log('[push] pairing token skipped', pushError);
        Alert.alert(
          'Push setup',
          pushError?.message || 'Could not create an Expo push token. Pairing will continue; request alerts need Firebase/FCM on this APK.'
        );
      }
      const result = await verifyPairing({
        mobileUserId: qrMobileUserId?.trim()?.toUpperCase() || null,
        pairingType,
        pairingCode: qrPairingCode.trim().toUpperCase(),
        pairingToken: pairingToken || null,
        apiBaseUrl,
        deviceUserName: userName.trim(),
        deviceUserMobile: mobileNumber.trim(),
        deviceName: Device.deviceName || `${Platform.OS} device`,
        deviceInfo: `${Device.modelName || 'Unknown'} • ${Device.osName || Platform.OS} ${Device.osVersion || ''}`,
        appVersion: CURRENT_VERSION_NAME,
        pushToken,
      });
      const nextSession = {
        apiBaseUrl,
        sessionToken: result.session_token,
        deviceId: result.device_id,
        mobileUserId: result.mobile_user_id,
        name: result.device_user_name || result.name || userName.trim(),
        deviceUserMobile: result.device_user_mobile || mobileNumber.trim(),
        brandName: result.brand_name,
        dealerName: result.dealer_name,
        branch: result.branch,
      };
      clearApiAuthCache();
      await saveSession(nextSession);
      await setBranchTransferredFlag(false);
      transferAlertedRef.current = false;
      setBranchTransferred(false);
      setSession(nextSession);
      setPairingScanned(false);
      setScreen('home');
    } catch (error) {
      setPairingScanned(false);
      Alert.alert('Pairing Failed', friendlyError(error));
    } finally {
      setPairingBusy(false);
    }
  };

  const handlePairingQr = ({ data }) => {
    if (pairingScanned || pairingBusy) return;
    setPairingScanned(true);
    try {
      const parsed = JSON.parse(String(data || ''));
      const apiBaseUrl = normalizeApiBaseUrl(parsed?.api_base_url || parsed?.apiBaseUrl);
      const pairingType = String(parsed?.pairing_type || (parsed?.mobile_user_id ? 'REPAIR' : 'NEW')).toUpperCase();
      const valid =
        parsed?.issuer === 'NMTS_SLEEPING_STOCK_PAIRING' &&
        [2, 3].includes(Number(parsed?.version)) &&
        ['NEW', 'REPAIR'].includes(pairingType) &&
        parsed?.pairing_code &&
        parsed?.pairing_token &&
        apiBaseUrl &&
        (pairingType !== 'REPAIR' || parsed?.mobile_user_id);
      if (!valid) throw new Error('invalid-nmts-qr');
      const detectedId = parsed?.mobile_user_id ? String(parsed.mobile_user_id).trim().toUpperCase() : '';
      setMobileUserId(detectedId);
      setPairingCode(String(parsed.pairing_code).trim().toUpperCase());
      Alert.alert(
        'NMTS QR Detected',
        pairingType === 'REPAIR'
          ? `Re-pair Mobile User: ${detectedId}\nServer: ${apiBaseUrl}`
          : `New Mobile User Pairing\nYour Mobile User ID will be created after verification.\nServer: ${apiBaseUrl}`,
        [
          { text: 'Scan Again', style: 'cancel', onPress: () => setPairingScanned(false) },
          {
            text: pairingType === 'REPAIR' ? 'Re-pair Device' : 'Pair Device',
            onPress: () =>
              pairDevice({
                qrMobileUserId: detectedId,
                pairingType,
                qrPairingCode: String(parsed.pairing_code),
                apiBaseUrl,
                pairingToken: String(parsed.pairing_token),
              }),
          },
        ]
      );
    } catch (error) {
      Alert.alert(
        'Invalid QR Code',
        error?.message && /not allowed|HTTPS|invalid|not configured/i.test(error.message)
          ? error.message
          : 'Scan only the pairing QR code generated from the NMTS website.'
      );
      setPairingScanned(false);
    }
  };

  const logout = async () => {
    try {
      await logoutSession();
    } catch (_error) {}
    stopRinging();
    await stopRequestRingtone();
    await dismissBranchRequestNotifications();
    logoutCleanup();
    clearTodayStockGateCache();
    dismissedRequestKeysRef.current.clear();
    incomingAlertRef.current = null;
    setIncomingAlert(null);
    setRejectModal(null);
    setRejectReasonDraft('');
    clearApiAuthCache();
    await clearSession();
    setSession(null);
    setScreen('pair');
  };

  const navigateGuarded = async (next) => {
    if (branchTransferred || !sessionRef.current) {
      setScreen('pair');
      if (branchTransferred) Alert.alert('Branch Transferred', BRANCH_TRANSFERRED_MESSAGE);
      return;
    }
    if (isStockGatedScreen(next)) {
      const status = await verifyTodayStockUploaded(sessionRef.current, { force: true });
      if (status.error) {
        Alert.alert(
          'Stock check failed',
          status.message || "Unable to verify today's stock upload. Please retry.",
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: () => navigateGuarded(next) },
          ]
        );
        return;
      }
      if (!status.uploaded) {
        Alert.alert("Today's stock required", status.message || TODAY_STOCK_MISSING_MESSAGE);
        return;
      }
    }
    setScreen(next);
  };

  const openScanner = async (target) => {
    if (branchTransferred && target !== 'pairing') {
      setScreen('pair');
      Alert.alert('Branch Transferred', BRANCH_TRANSFERRED_MESSAGE);
      return;
    }
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Permission',
          target === 'pairing'
            ? 'Camera permission is required to scan the NMTS pairing QR code.'
            : 'Camera permission is required to scan a part number.'
        );
        return;
      }
    }
    setScannerTarget(target);
    setScreen('scanner');
  };

  const scanPartNumber = async () => {
    if (ocrBusy || !cameraRef.current) return;
    setOcrBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
        shutterSound: false,
      });
      if (!photo?.uri) throw new Error('Photo not available');

      const imageWidth = numberValue(photo.width) || 1080;
      const imageHeight = numberValue(photo.height) || 1920;
      const viewWidth = cameraLayout.current.width || 390;
      const viewHeight = cameraLayout.current.height || 700;
      const frame = scanFrameLayout.current;

      const scaleX = imageWidth / viewWidth;
      const scaleY = imageHeight / viewHeight;
      const originX = Math.max(0, Math.floor(frame.x * scaleX));
      const originY = Math.max(0, Math.floor(frame.y * scaleY));
      const cropWidth = Math.max(40, Math.min(imageWidth - originX, Math.floor(frame.width * scaleX)));
      const cropHeight = Math.max(40, Math.min(imageHeight - originY, Math.floor(frame.height * scaleY)));

      const cropped = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      const lines = await extractTextFromImage(cropped.uri);
      const recognizedText = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
      const { partNumber: detected, description } = extractPartDetails(recognizedText);
      if (!detected) {
        Alert.alert('Not Detected', 'Keep only the part number inside the scan box and try again.');
        return;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (scannerTarget === 'verification') {
        setScannedPartDescription(description || '');
        setVerificationInput(detected);
        setScreen('verification');
        await lookupVerificationPart(detected, description || '');
      } else if (scannerTarget === 'multi-search') {
        setMultiInput((current) => `${current ? `${current}\n` : ''}${detected}`);
        setScreen('multi-search');
      } else {
        setSearchInput(detected);
        setScreen('search');
      }
    } catch (error) {
      Alert.alert('Scan Failed', error?.message || 'Unable to scan the part number.');
    } finally {
      setOcrBusy(false);
    }
  };

  const lookupVerificationPart = async (partNumber = verificationInput, detectedDescription = scannedPartDescription) => {
    const cleaned = cleanPartNumber(partNumber);
    if (!cleaned) {
      Alert.alert('Part Number', 'Enter or scan a part number.');
      return;
    }
    setVerificationBusy(true);
    try {
      const response = await searchStock(cleaned, { mode: 'exact' });
      const match =
        (response?.results || []).map(mapStockRow).find((row) => row.partNumber === cleaned) ||
        (response?.results || []).map(mapStockRow)[0];
      if (!match) {
        setSelectedPart(null);
        Alert.alert(
          'Part Not Found',
          'This part number is not available in the paired branch data. Do you want to add it as an excess new part?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add New Part',
              onPress: () => {
                setVerificationInput(cleaned);
                setSelectedPart({
                  partNumber: cleaned,
                  partName: detectedDescription || '',
                  systemQty: 0,
                  availableQty: 0,
                  systemLocation: '-',
                  unitValue: 0,
                  isNewPart: true,
                });
                setPhysicalLocation('');
              },
            },
          ]
        );
        return;
      }
      setVerificationInput(match.partNumber);
      setSelectedPart(match);
      setPhysicalLocation(match.systemLocation === '-' ? '' : match.systemLocation);
      setScannedPartDescription('');
    } catch (error) {
      Alert.alert('Lookup Failed', friendlyError(error));
    } finally {
      setVerificationBusy(false);
    }
  };

  const addVerificationToList = () => {
    if (!selectedPart) {
      Alert.alert('Search Part', 'Search the part number first.');
      return;
    }
    if (selectedPart.isNewPart && !String(selectedPart.partName || '').trim()) {
      Alert.alert('Part Description', 'Enter or confirm the part name / description.');
      return;
    }
    if (physicalQty === '' || numberValue(physicalQty) < 0) {
      Alert.alert('Physical Quantity', 'Enter a valid physical quantity.');
      return;
    }
    if (!physicalLocation.trim()) {
      Alert.alert('Physical Location', 'Enter the physical location.');
      return;
    }
    const difference = differenceFor(selectedPart.systemQty, physicalQty, selectedPart.unitValue);
    const row = {
      id: `${Date.now()}-${Math.random()}`,
      ...selectedPart,
      physicalQty: numberValue(physicalQty),
      physicalLocation: physicalLocation.trim().toUpperCase(),
      remark: verificationRemark.trim(),
      damageQty: numberValue(damageQty),
      verificationType: 'physical',
      ...difference,
    };
    setVerificationList((current) => [...current.filter((x) => x.partNumber !== row.partNumber), row]);
    setVerificationInput('');
    setSelectedPart(null);
    setPhysicalQty('');
    setPhysicalLocation('');
    setVerificationRemark('');
    setDamageQty('');
    setScannedPartDescription('');
  };

  const submitVerificationList = async () => {
    if (!verificationList.length) return;
    // Instant local enqueue — do not block UI on network.
    setVerificationBusy(true);
    try {
      await Promise.all(
        verificationList.map((row) =>
          enqueueAndTrySync({
            partNumber: cleanPartNumber(row.partNumber),
            partName: row.partName || '',
            physicalQty: row.physicalQty,
            location: row.physicalLocation,
            remark: row.remark,
            entryMethod: 'MANUAL_OR_CAMERA',
            // Backend creates the authoritative daily MOPS session (IST).
            verificationSessionId: '',
            isNewPart: Boolean(row.isNewPart),
            verificationType: row.verificationType || 'physical',
            damageQty: numberValue(row.damageQty || 0),
          })
        )
      );
      Alert.alert('Saved', `${verificationList.length} verification record(s) saved locally. Sync continues in the background.`);
      setVerificationList([]);
      const count = await getPendingCount().catch(() => pendingCount);
      setPendingCount(count);
    } catch (error) {
      Alert.alert('Save Failed', friendlyError(error));
    } finally {
      setVerificationBusy(false);
    }
  };

  const saveAutoLocal = async ({ task, physicalQty: qty, damageQty: dmg, location, remark, status, differenceQty, correctionReason, isEdit }) => {
    const partNumber = cleanPartNumber(task.part_number);
    const existing = autoLocalVerified?.[partNumber];
    const originalPhysicalQty = existing?.originalPhysicalQty ?? existing?.physicalQty ?? qty;
    const previousQty = existing?.physicalQty;
    const editHistory = [...(existing?.editHistory || [])];
    let editCount = existing?.editCount || 0;
    if (isEdit && existing?.verified && previousQty !== qty) {
      if (!String(correctionReason || '').trim()) {
        Alert.alert('Correction reason', 'Enter a reason before changing the counted quantity.');
        return;
      }
      editCount += 1;
      editHistory.push({
        previous_quantity: previousQty,
        new_quantity: qty,
        correction_reason: String(correctionReason || '').trim(),
        edited_at: new Date().toISOString(),
      });
    }
    const payload = {
      partNumber,
      partName: task.part_name || '',
      physicalQty: qty,
      location,
      remark,
      entryMethod: 'MANUAL_OR_CAMERA',
      verificationSessionId: autoSessionId || '',
      sessionId: autoSessionId || undefined,
      isNewPart: false,
      verificationType: 'auto',
      damageQty: dmg,
      correctionReason: String(correctionReason || '').trim() || undefined,
      autoCountPhase: 'save',
    };
    let clientId = existing?.clientId;
    let revealed = {
      systemQty: existing?.systemQty,
      status,
      differenceQty,
    };
    try {
      const result = await saveAutoCount(payload);
      clientId = result?.id || clientId;
      revealed = {
        systemQty: result?.system_qty,
        status: String(result?.verification_status || status || '').toUpperCase(),
        differenceQty: result?.difference_qty ?? differenceQty,
        originalPhysicalQty: result?.original_physical_quantity ?? originalPhysicalQty,
        editCount: result?.edit_count ?? editCount,
        editHistory: result?.quantity_edit_history || editHistory,
      };
    } catch (error) {
      if (error instanceof ApiError && error.kind !== 'network' && error.kind !== 'timeout' && error.status && error.status < 500) {
        Alert.alert('Save Failed', friendlyError(error));
        return;
      }
      clientId = await enqueueAndTrySync(payload);
    }
    setAutoLocalVerified((current) => ({
      ...current,
      [partNumber]: {
        verified: true,
        synced: Boolean(revealed.systemQty != null),
        finalized: false,
        clientId,
        physicalQty: qty,
        originalPhysicalQty: revealed.originalPhysicalQty ?? originalPhysicalQty,
        damageQty: dmg,
        location,
        remark,
        status: revealed.status,
        differenceQty: revealed.differenceQty,
        systemQty: revealed.systemQty,
        editCount: revealed.editCount ?? editCount,
        editHistory: revealed.editHistory || editHistory,
        correctionReason: String(correctionReason || '').trim(),
      },
    }));
    const count = await getPendingCount().catch(() => pendingCount);
    setPendingCount(count);
  };

  const submitAutoVerified = async () => {
    setAutoSubmitting(true);
    try {
      const result = await syncQueue();
      const stillPending = await getPendingCount().catch(() => 0);
      setPendingCount(stillPending);
      if (result?.skipped && result?.reason === 'offline') {
        Alert.alert('Saved Offline', 'Saved counts stay on this device until you are online. System quantity is not shown until the first Save syncs.');
        return;
      }
      const partNumbers = Object.entries(autoLocalVerified || {})
        .filter(([, row]) => row.verified && !row.finalized)
        .map(([part]) => part);
      await finalizeAutoCounts(partNumbers, autoSessionId);
      const submitted = new Set(partNumbers);
      setAutoLocalVerified((current) => {
        const next = {};
        Object.entries(current || {}).forEach(([part, row]) => {
          if (submitted.has(part)) return;
          next[part] = { ...row, synced: true };
        });
        return next;
      });
      setAutoTasks((current) => (current || []).filter((task) => !submitted.has(cleanPartNumber(task.part_number))));
      await loadAutoTasks();
      if (stillPending > 0) {
        Alert.alert('Partial Sync', `${stillPending} record(s) still pending. They will retry automatically.`);
      }
    } catch (error) {
      Alert.alert('Final Submit Failed', friendlyError(error));
    } finally {
      setAutoSubmitting(false);
    }
  };

  const runPrefixSearch = async () => {
    const q = String(searchInput || '').trim();
    if (!q) {
      Alert.alert('Search', 'Enter a part number prefix or description.');
      return;
    }
    setSearchBusy(true);
    try {
      const response = await searchStock(q, { mode: 'prefix' });
      const unavailable = response?.today_upload_available === false;
      const uploadMsg = unavailable
        ? (response?.message || 'No stock uploaded today for this branch.')
        : '';
      setSearchUploadMessage(uploadMsg);
      const rows = unavailable ? [] : (response?.results || []).map(mapStockRow);
      setSearchResults(rows);
      // Prefix/partial search must never list the query itself as Not Found.
      setSearchNotFound([]);
      if (unavailable) {
        Alert.alert('Stock Unavailable', uploadMsg);
      } else if (!rows.length) {
        Alert.alert('No Matches', `No parts start with or match "${q}" in today's uploaded stock.`);
      }
    } catch (error) {
      Alert.alert('Search Failed', friendlyError(error));
      setSearchResults([]);
      setSearchNotFound([]);
      setSearchUploadMessage('');
    } finally {
      setSearchBusy(false);
    }
  };

  const runMultiSearch = async () => {
    const parts = splitPartNumbers(multiInput);
    if (!parts.length) {
      Alert.alert('Part Numbers', 'Paste or type one or more part numbers.');
      return;
    }
    setMultiBusy(true);
    try {
      // Exact full part numbers only — never prefix for Multiple Search.
      const response = await searchStock(parts, { mode: 'exact' });
      const unavailable = response?.today_upload_available === false;
      const uploadMsg = unavailable
        ? (response?.message || 'No stock uploaded today for this branch.')
        : '';
      setMultiUploadMessage(uploadMsg);
      if (unavailable) {
        setMultiResults([]);
        setMultiNotFound(parts);
        Alert.alert('Stock Unavailable', uploadMsg);
        return;
      }
      const results = (response?.results || []).map(mapStockRow);
      const foundSet = new Set(results.map((row) => row.partNumber));
      const missing = response?.not_found?.length
        ? response.not_found.map(cleanPartNumber).filter(Boolean)
        : parts.filter((part) => !foundSet.has(part));
      setMultiResults(results);
      setMultiNotFound(missing);
    } catch (error) {
      Alert.alert('Search Failed', friendlyError(error));
      setMultiResults([]);
      setMultiNotFound([]);
      setMultiUploadMessage('');
    } finally {
      setMultiBusy(false);
    }
  };

  const pickRequest = async (group) => {
    if (group?.accepted_by_me) {
      openRequest(group);
      return;
    }
    if (!canPickRequest(group)) {
      Alert.alert(
        requestStatus(group) === 'picked' ? 'Already Picked' : 'Unavailable',
        requestStatus(group) === 'picked'
          ? ALREADY_PICKED_MESSAGE
          : statusLabelFor(requestStatus(group))
      );
      loadNotifications();
      return;
    }
    setRequestBusy(true);
    try {
      const result = await acceptNotification(group.request_group_key);
      incomingShownKeyRef.current = null;
      incomingAlertRef.current = null;
      stopRinging(group.request_group_key || group.request_number);
      await dismissRequestNotification(incomingNotificationRef.current);
      await dismissBranchRequestNotifications();
      incomingNotificationRef.current = null;
      setIncomingAlert(null);
      stopRequestRingtone();
      markRequestDismissed(group);
      const rows = await getNotifications().catch(() => notificationsRef.current || []);
      setNotifications(rows || []);
      notificationsRef.current = rows || [];
      const windowSeconds = Number(result?.confirm_window_seconds) || CONFIRM_WINDOW_SECONDS;
      const confirmDeadline =
        result?.confirm_deadline_at ||
        new Date(Date.now() + windowSeconds * 1000).toISOString();
      const next = asOwnedPickedRequest(findRequestGroup(rows, group) || group, {
        confirm_deadline_at: confirmDeadline,
        confirm_window_seconds: windowSeconds,
      });
      openRequest(next);
    } catch (error) {
      const code = errorCode(error) || error?.code;
      if (code === 'ALREADY_PICKED' || error?.status === 409) {
        stopRinging(group.request_group_key || group.request_number);
        incomingAlertRef.current = null;
        setIncomingAlert(null);
        Alert.alert('Already Picked', ALREADY_PICKED_MESSAGE);
      } else {
        Alert.alert('Unable to Pick', friendlyError(error));
      }
      loadNotifications();
    } finally {
      setRequestBusy(false);
    }
  };

  const openRequest = (group) => {
    markRequestDismissed(group);
    stopRinging(group?.request_group_key || group?.request_number);
    stopRequestRingtone();
    confirmExpiredAlertedRef.current = false;
    setSelectedRequest(group);
    setRequestRows(
      (group.parts || []).map((part) => ({
        orderRequestId: part.order_request_id,
        partNumber: part.part_number,
        partName: part.description || part.part_name || '-',
        requestedQty: numberValue(part.requested_qty),
        availableQty: numberValue(part.available_qty_at_request ?? part.available_qty),
        loc: requestPartLoc(part),
        purchaseAging: part.purchase_aging_days ?? part.purchase_aging ?? '-',
        salesAging: part.sales_aging_days ?? part.sales_aging ?? '-',
        value: numberValue(part.part_value ?? part.value),
        acceptedQty: part.response_saved || part.accepted_qty != null ? String(part.accepted_qty) : '',
        remark: part.remark || '',
      }))
    );
    setScreen('request');
  };

  useEffect(() => {
    openRequestRef.current = openRequest;
    pickRequestRef.current = pickRequest;
  });

  const submitRequestResponse = async () => {
    if (!canEditRequest(selectedRequest)) {
      Alert.alert(
        'Already Picked',
        `This request is locked${ownerName(selectedRequest) ? ` by ${ownerName(selectedRequest)}` : ''}.`
      );
      return;
    }
    for (const row of requestRows) {
      if (String(row.acceptedQty ?? '').trim() === '') {
        Alert.alert('Response required', `Enter an accepted quantity for ${row.partNumber}.`);
        return;
      }
      const qty = numberValue(row.acceptedQty);
      if (qty < 0 || qty > row.requestedQty) {
        Alert.alert('Invalid Quantity', `Check accepted quantity for ${row.partNumber}.`);
        return;
      }
      if (qty < row.requestedQty && !row.remark.trim()) {
        Alert.alert('Remark Required', `Enter a remark for ${row.partNumber}. Zero accepted qty covers a rejection.`);
        return;
      }
    }
    setRequestBusy(true);
    try {
      await submitPartResponse(
        selectedRequest.request_group_key,
        requestRows.map((row) => ({
          orderRequestId: row.orderRequestId,
          partNumber: row.partNumber,
          acceptedQty: numberValue(row.acceptedQty),
          remark: row.remark.trim(),
        }))
      );
      Alert.alert('Responses saved', 'Accepted quantities saved. Complete picking when every line is answered.');
      const rows = await getNotifications().catch(() => notificationsRef.current || []);
      setNotifications(rows || []);
      const next = findRequestGroup(rows, selectedRequest);
      if (next) setSelectedRequest(next);
    } catch (error) {
      Alert.alert('Submit Failed', friendlyError(error));
      loadNotifications();
    } finally {
      setRequestBusy(false);
    }
  };

  const completeRequestPicking = async () => {
    if (!canEditRequest(selectedRequest)) {
      Alert.alert('Unavailable', 'Only the owner can complete picking.');
      return;
    }
    const unanswered = requestRows.some((row) => String(row.acceptedQty ?? '').trim() === '');
    if (unanswered) {
      Alert.alert('Response required', 'Enter an accepted quantity for every line before finishing picking.');
      return;
    }
    setRequestBusy(true);
    try {
      await completePicking(selectedRequest.request_group_key);
      Alert.alert('Picking completed', 'This request is now waiting for web dispatch.');
      loadNotifications();
      setScreen('notifications');
    } catch (error) {
      Alert.alert('Unable to complete', friendlyError(error));
      loadNotifications();
    } finally {
      setRequestBusy(false);
    }
  };

  const transferRequestOwnership = async () => {
    if (!canTransferRequest(selectedRequest)) {
      Alert.alert('Unavailable', 'Only the owner can transfer this request.');
      return;
    }
    setRequestBusy(true);
    try {
      const targets = await getTransferTargets(selectedRequest.request_group_key);
      if (!targets?.length) {
        Alert.alert('No users', 'No other active paired user on this branch.');
        return;
      }
      Alert.alert(
        'Transfer ownership',
        'Choose a same-branch user. They become the owner immediately.',
        [
          { text: 'Cancel', style: 'cancel' },
          ...targets.slice(0, 5).map((target) => ({
            text: target.name || target.mobile_user_id,
            onPress: async () => {
              try {
                await transferOwnership(selectedRequest.request_group_key, target.mobile_user_id);
                Alert.alert('Transferred', `Now owned by ${target.name || target.mobile_user_id}.`);
                loadNotifications();
                setScreen('notifications');
              } catch (error) {
                Alert.alert('Transfer failed', friendlyError(error));
              }
            },
          })),
        ]
      );
    } catch (error) {
      Alert.alert('Transfer failed', friendlyError(error));
    } finally {
      setRequestBusy(false);
    }
  };

  const releaseRequestOwnership = async () => {
    if (!canReleaseRequest(selectedRequest)) {
      Alert.alert('Unavailable', 'Only the owner can release this request.');
      return;
    }
    Alert.alert('Release ownership', 'Choose a reason. The request returns to the branch pool.', [
      { text: 'Cancel', style: 'cancel' },
      ...RELEASE_REASONS.map((reason) => ({
        text: reason.label,
        onPress: () => {
          if (reason.value === 'OTHER') {
            Alert.prompt
              ? Alert.prompt('Release note', 'Optional note', async (note) => {
                try {
                  await releaseOwnership(selectedRequest.request_group_key, reason.value, note || '');
                  Alert.alert('Released', 'The request is back in the branch pool.');
                  loadNotifications();
                  setScreen('notifications');
                } catch (error) {
                  Alert.alert('Release failed', friendlyError(error));
                }
              })
              : releaseOwnership(selectedRequest.request_group_key, reason.value, '').then(() => {
                Alert.alert('Released', 'The request is back in the branch pool.');
                loadNotifications();
                setScreen('notifications');
              }).catch((error) => Alert.alert('Release failed', friendlyError(error)));
            return;
          }
          releaseOwnership(selectedRequest.request_group_key, reason.value, '').then(() => {
            Alert.alert('Released', 'The request is back in the branch pool.');
            loadNotifications();
            setScreen('notifications');
          }).catch((error) => Alert.alert('Release failed', friendlyError(error)));
        },
      })),
    ]);
  };

  const pairManually = async () => {
    try {
      await pairDevice({
        qrMobileUserId: mobileUserId.trim().toUpperCase() || null,
        pairingType: mobileUserId.trim() ? 'REPAIR' : 'NEW',
        qrPairingCode: pairingCode.trim().toUpperCase(),
        apiBaseUrl: MANUAL_PAIRING_API_BASE_URL,
        pairingToken: null,
      });
    } catch (error) {
      Alert.alert('Pairing Failed', friendlyError(error));
    }
  };

  if (booting) {
    return <LoadingScreen label="Opening Sleeping Stock Mobile..." />;
  }

  if (mandatoryUpdate) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <MandatoryUpdateScreen versionInfo={mandatoryUpdate} currentVersionCode={CURRENT_VERSION_CODE} />
      </SafeAreaView>
    );
  }

  const goBack = () => {
    if (screen === 'scanner') {
      setScreen(
        scannerTarget === 'pairing'
          ? 'pair'
          : scannerTarget === 'verification'
            ? 'verification'
            : scannerTarget === 'multi-search'
              ? 'multi-search'
              : 'search'
      );
    } else if (screen === 'request') setScreen('notifications');
    else if (screen === 'multi-search') setScreen('search');
    else setScreen('home');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      {isOffline && (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>Offline — uploads will sync automatically</Text>
        </View>
      )}
      {screen !== 'auto' && <SyncStatusBanner status={syncStatus} />}

      {screen === 'pair' && (
        <PairScreen
          mobileUserId={mobileUserId}
          setMobileUserId={setMobileUserId}
          userName={userName}
          setUserName={setUserName}
          mobileNumber={mobileNumber}
          setMobileNumber={setMobileNumber}
          pairingCode={pairingCode}
          setPairingCode={setPairingCode}
          showManual={showManualPairing}
          setShowManual={setShowManualPairing}
          busy={pairingBusy}
          branchTransferred={branchTransferred}
          onScanQr={() => openScanner('pairing')}
          onManualPair={pairManually}
        />
      )}
      {screen === 'home' && (
          <HomeScreen
            session={session}
            pendingCount={pendingCount}
            notificationCount={notifications.filter((row) => requestStatus(row) === 'pending').length}
            navigate={navigateGuarded}
            logout={logout}
          />
      )}
      {screen === 'auto' && (
        <AutoPerpetualScreen
          onBack={goBack}
          sessions={autoSessions}
          today={autoToday}
          todayCreated={autoTodayCreated}
          todayMessage={autoTodayMessage}
          viewMode={autoViewMode}
          selectedSession={autoSelectedSession}
          readOnly={autoReadOnly}
          reaudit={autoReaudit}
          sessionId={autoSessionId}
          tasks={autoTasks}
          localVerified={autoLocalVerified}
          assignedCount={autoAssignedCount}
          completedCount={autoCompletedCount}
          busy={autoBusy}
          syncStatus={syncStatus}
          onRefresh={loadAutoTasks}
          onOpenSession={openAutoSession}
          onCloseSession={closeAutoSession}
          onSaveLocal={saveAutoLocal}
          onSubmitVerified={submitAutoVerified}
          submitting={autoSubmitting}
        />
      )}
      {screen === 'verification' && (
        <VerificationScreen
          onBack={goBack}
          input={verificationInput}
          setInput={setVerificationInput}
          onLookup={() => lookupVerificationPart()}
          onScan={() => openScanner('verification')}
          selectedPart={selectedPart}
          setSelectedPart={setSelectedPart}
          physicalQty={physicalQty}
          setPhysicalQty={setPhysicalQty}
          physicalLocation={physicalLocation}
          setPhysicalLocation={setPhysicalLocation}
          remark={verificationRemark}
          setRemark={setVerificationRemark}
          damageQty={damageQty}
          setDamageQty={setDamageQty}
          list={verificationList}
          removeRow={(id) => setVerificationList((rows) => rows.filter((x) => x.id !== id))}
          onAdd={addVerificationToList}
          onSubmit={submitVerificationList}
          busy={verificationBusy}
        />
      )}
      {screen === 'search' && (
        <StockAvailabilityScreen
          onBack={goBack}
          input={searchInput}
          setInput={setSearchInput}
          onSearch={runPrefixSearch}
          onScan={() => openScanner('search')}
          onOpenMulti={() => setScreen('multi-search')}
          results={searchResults}
          notFound={searchNotFound}
          busy={searchBusy}
          agingThreshold={agingThreshold}
          setAgingThreshold={setAgingThreshold}
          uploadMessage={searchUploadMessage}
        />
      )}
      {screen === 'multi-search' && (
        <MultiPartSearchScreen
          onBack={goBack}
          input={multiInput}
          setInput={setMultiInput}
          onSearch={runMultiSearch}
          results={multiResults}
          notFound={multiNotFound}
          busy={multiBusy}
          agingThreshold={agingThreshold}
          setAgingThreshold={setAgingThreshold}
          uploadMessage={multiUploadMessage}
        />
      )}
      {screen === 'notifications' && (
        <NotificationsScreen
          onBack={goBack}
          rows={notifications}
          busy={notificationsBusy || requestBusy}
          refresh={loadNotifications}
          openRequest={openRequest}
          pickRequest={pickRequest}
          rejectRequest={(item) => promptRejectReason(item, (reason) => rejectRequest(item, reason))}
        />
      )}
      {screen === 'request' && (
        <RequestScreen
          onBack={goBack}
          request={selectedRequest}
          rows={requestRows}
          updateRow={(id, field, value) =>
            setRequestRows((items) => items.map((x) => (x.orderRequestId === id ? { ...x, [field]: value } : x)))
          }
          onSubmit={submitRequestResponse}
          onComplete={completeRequestPicking}
          onTransfer={transferRequestOwnership}
          onRelease={releaseRequestOwnership}
          busy={requestBusy}
          canEdit={canEditRequest(selectedRequest)}
          confirmDeadlineAt={selectedRequest?.confirm_deadline_at}
          confirmSecondsLeft={confirmSecondsLeft}
        />
      )}
      {screen === 'scanner' &&
        (scannerTarget === 'pairing' ? (
          <PairingScannerScreen
            onBack={goBack}
            onBarcodeScanned={handlePairingQr}
            scanned={pairingScanned || pairingBusy}
            onScanAgain={() => setPairingScanned(false)}
          />
        ) : (
          <ScannerScreen
            onBack={goBack}
            permission={permission}
            cameraRef={cameraRef}
            cameraLayout={cameraLayout}
            scanFrameLayout={scanFrameLayout}
            scanLine={scanLine}
            onScan={scanPartNumber}
            busy={ocrBusy}
          />
        ))}
      <IncomingRequestPopup
        visible={Boolean(incomingAlert)}
        alert={incomingAlert}
        onPick={() => pickIncomingFromPush(incomingAlert?.data || incomingAlert)}
        onReject={(alert, reason) => rejectIncomingAlert(alert, reason)}
        onDismiss={() => {
          clearIncomingPopupLocal(incomingAlert);
        }}
        onOpen={() => pickIncomingFromPush(incomingAlert?.data || incomingAlert)}
      />
      <Modal
        visible={Boolean(rejectModal?.visible)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRejectModal(null);
          setRejectReasonDraft('');
        }}
      >
        <View style={styles.rejectModalBackdrop}>
          <View style={styles.rejectModalCard}>
            <Text style={styles.rejectModalTitle}>REJECT REQUEST</Text>
            <Text style={styles.rejectModalHint}>Rejection reason is mandatory.</Text>
            {rejectModal?.alert?.request_number ? (
              <Text style={styles.rejectModalMeta}>#{rejectModal.alert.request_number}</Text>
            ) : null}
            <TextInput
              style={styles.rejectModalInput}
              value={rejectReasonDraft}
              onChangeText={setRejectReasonDraft}
              placeholder="Enter reason"
              placeholderTextColor={MUTED}
              multiline
              autoFocus
            />
            <View style={styles.requestActions}>
              <TouchableOpacity
                style={styles.snoozeButton}
                onPress={() => {
                  setRejectModal(null);
                  setRejectReasonDraft('');
                }}
              >
                <Text style={styles.snoozeText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pickButton, !String(rejectReasonDraft || '').trim() && styles.rejectModalDisabled]}
                disabled={!String(rejectReasonDraft || '').trim()}
                onPress={() => {
                  const trimmed = String(rejectReasonDraft || '').trim();
                  if (!trimmed) return;
                  const confirmFn = rejectModal?.onConfirm;
                  setRejectModal(null);
                  setRejectReasonDraft('');
                  confirmFn?.(trimmed);
                }}
              >
                <Text style={styles.pickText}>Confirm Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function PairForm(props) {
  return (
    <ScrollView
      style={styles.pairScroll}
      contentContainerStyle={styles.pairPage}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Image source={require('./assets/sleeping-stock-logo.png')} style={styles.brandLogo} resizeMode="contain" />
      <Text style={styles.appTitle}>Sleeping Stock Mobile</Text>
      <Text style={styles.appSub}>PAIR THIS DEVICE</Text>
      {props.branchTransferred ? (
        <View style={styles.transferBanner}>
          <Text style={styles.transferBannerTitle}>BRANCH TRANSFERRED</Text>
          <Text style={styles.transferBannerText}>{BRANCH_TRANSFERRED_MESSAGE}</Text>
        </View>
      ) : null}
      <View style={styles.card}>
        <Field label="Your Name" value={props.userName} onChangeText={props.setUserName} />
        <Field
          label="Mobile Number"
          value={props.mobileNumber}
          onChangeText={props.setMobileNumber}
          keyboardType="phone-pad"
        />
        <Text style={styles.qrInfo}>
          The NMTS website QR contains a one-time pairing code and secure server URL. A new Mobile User ID is created after
          first pairing; Re-pair keeps the same ID. Manual pairing code always uses Testing.
        </Text>
        <PrimaryButton title="Scan NMTS Pairing QR" onPress={props.onScanQr} busy={props.busy} />
        <TouchableOpacity style={{ marginTop: 14 }} onPress={() => props.setShowManual(!props.showManual)}>
          <Text style={styles.pendingAction}>Enter Code Manually</Text>
        </TouchableOpacity>
        {props.showManual ? (
          <View style={{ marginTop: 14 }}>
            <Field
              label="Website pairing code"
              value={props.pairingCode}
              onChangeText={(value) => props.setPairingCode(String(value || '').toUpperCase())}
              autoCapitalize="characters"
            />
            <Field
              label="Re-pair Mobile User ID (optional)"
              value={props.mobileUserId}
              onChangeText={(value) => props.setMobileUserId(String(value || '').toUpperCase())}
              autoCapitalize="characters"
            />
            <PrimaryButton title="Pair with Code" onPress={props.onManualPair} busy={props.busy} />
          </View>
        ) : null}
        {!!props.mobileUserId && !props.showManual && <Text style={styles.detectedUser}>Detected User: {props.mobileUserId}</Text>}
      </View>
    </ScrollView>
  );
}

function PairScreen(props) {
  const form = <PairForm {...props} />;
  return (
    <View style={styles.pairRoot} collapsable={false}>
      <Image
        source={require('./assets/login-background.png')}
        style={styles.loginBackground}
        resizeMode="cover"
        blurRadius={18}
        pointerEvents="none"
      />
      <View style={styles.loginDim} pointerEvents="none" />
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {form}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.flex} collapsable={false}>
          {form}
        </View>
      )}
    </View>
  );
}

function HomeScreen({ session, pendingCount, notificationCount, navigate, logout }) {
  return (
    <ScreenBackground>
    <ScrollView contentContainerStyle={styles.homePage}>
      <View style={styles.homeHeader}>
        <View style={styles.flex}>
          <Text style={styles.hello}>WELCOME BACK,</Text>
          <Text style={styles.homeName}>{session?.name || 'Mobile User'}</Text>
          <Text style={styles.homeAppLabel}>NMTS / Sleeping Stock</Text>
        </View>
        <TouchableOpacity style={styles.headerIconButton} onPress={() => navigate('notifications')}>
          <Text style={styles.headerIcon}>🔔</Text>
          {notificationCount > 0 ? (
            <View style={styles.headerDot} />
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutChip} onPress={logout}>
          <Text style={styles.logout}>Logout</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.branchCard}>
        <Text style={styles.branchKicker}>PAIRED LOCATION</Text>
        <Text style={styles.branchTitle}>{session?.branch || 'Paired Branch'}</Text>
        <Text style={styles.branchSub}>
          {[session?.dealerName, session?.brandName].filter(Boolean).join(' • ') || 'Multi-brand dealer network'}
        </Text>
      </View>
      <MenuButton
        icon="🔔"
        accent={NEON_YELLOW}
        title="Notifications"
        subtitle="Pick and process parts requests"
        badge={notificationCount > 0 ? `${notificationCount} New` : null}
        onPress={() => navigate('notifications')}
      />
      <MenuButton
        icon="✓"
        accent={NEON_GREEN}
        title="Physical Perpetual"
        subtitle="Manual / scan stock verification (MOPS)"
        onPress={() => navigate('verification')}
      />
      <MenuButton
        icon="⚡"
        accent={NEON_CYAN}
        title="Auto Perpetual"
        subtitle="Today's assigned verification tasks (AOPS)"
        onPress={() => navigate('auto')}
      />
      <MenuButton
        icon="⌕"
        accent={NEON_BLUE}
        title="Stock Availability"
        subtitle="Product Hub style search + multiple parts"
        onPress={() => navigate('search')}
      />
      {pendingCount > 0 && (
        <View style={styles.pendingCard}>
          <Text style={styles.pendingText}>{pendingCount} verification record(s) pending upload</Text>
          <TouchableOpacity onPress={() => syncQueue()}>
            <Text style={styles.pendingAction}>Upload Now</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
    </ScreenBackground>
  );
}

function VerificationScreen(props) {
  const totals = props.list.reduce(
    (a, x) => ({
      matched: a.matched + (x.status === 'MATCHED' ? 1 : 0),
      shortage: a.shortage + (x.status === 'SHORTAGE' ? 1 : 0),
      excess: a.excess + (x.status === 'EXCESS' ? 1 : 0),
    }),
    { matched: 0, shortage: 0, excess: 0 }
  );
  const diff = props.selectedPart ? differenceFor(props.selectedPart.systemQty, props.physicalQty, props.selectedPart.unitValue) : null;
  const appendVoice = (chunk) => {
    props.setInput((current) => `${current || ''}${chunk}`);
  };
  return (
    <ScreenBackground>
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 18}
    >
      <Header title="Stock Verification" onBack={props.onBack} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.topContent, { paddingBottom: 220 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Text style={styles.sectionLabel}>ADDED PARTS ({props.list.length})</Text>
        {props.list.length === 0 ? (
          <Empty text="Added parts will appear here." />
        ) : (
          props.list.map((row) => <VerificationRow key={row.id} row={row} onDelete={() => props.removeRow(row.id)} />)
        )}
        <View style={styles.summaryRow}>
          <MiniStat label="Total" value={props.list.length} />
          <MiniStat label="Matched" value={totals.matched} />
          <MiniStat label="Shortage" value={totals.shortage} />
          <MiniStat label="Excess" value={totals.excess} />
        </View>
        {props.selectedPart && (
          <View style={styles.detailCard}>
            <Text style={styles.partBig}>{props.selectedPart.partNumber}</Text>
            {props.selectedPart.isNewPart ? (
              <TextInput
                style={[styles.bottomInput, { marginTop: 10 }]}
                value={props.selectedPart.partName}
                onChangeText={(value) => props.setSelectedPart((current) => ({ ...current, partName: value }))}
                placeholder="Part Name / Description"
                placeholderTextColor={MUTED}
              />
            ) : (
              <Text style={styles.partName}>{props.selectedPart.partName}</Text>
            )}
            <InfoGrid
              rows={[
                ['System Qty', props.selectedPart.systemQty],
                ['System LOC', props.selectedPart.systemLocation],
                ['Available Qty', props.selectedPart.availableQty],
                ['Unit Value', `₹${props.selectedPart.unitValue.toLocaleString('en-IN')}`],
                ['Shortage Qty', diff?.shortageQty ?? 0],
                ['Excess Qty', diff?.excessQty ?? 0],
              ]}
            />
            {diff && <StatusPill value={diff.status} />}
          </View>
        )}
      </ScrollView>
      <View style={styles.bottomPanel}>
        <View style={styles.inlineInputRow}>
          <TextInput
            style={styles.bottomInput}
            value={props.input}
            onChangeText={(v) => props.setInput(cleanPartNumber(v))}
            placeholder="Enter Part Number"
            placeholderTextColor={MUTED}
            autoCapitalize="characters"
          />
          <SquareButton title="⌕" onPress={props.onLookup} />
          <SquareButton title="▣" onPress={props.onScan} />
          <VoiceTypeButton onAppend={appendVoice} />
        </View>
        {props.selectedPart && (
          <>
            <View style={styles.twoInputs}>
              <TextInput
                style={[styles.bottomInput, styles.halfInput]}
                value={props.physicalQty}
                onChangeText={(v) => props.setPhysicalQty(v.replace(/[^0-9.]/g, ''))}
                placeholder="Physical Qty"
                keyboardType="decimal-pad"
                placeholderTextColor={MUTED}
              />
              <TextInput
                style={[styles.bottomInput, styles.halfInput]}
                value={props.physicalLocation}
                onChangeText={props.setPhysicalLocation}
                placeholder="Physical LOC"
                autoCapitalize="characters"
                placeholderTextColor={MUTED}
              />
            </View>
            <TextInput
              style={styles.bottomInput}
              value={props.remark}
              onChangeText={props.setRemark}
              placeholder="Remark (optional)"
              placeholderTextColor={MUTED}
            />
            <TextInput
              style={styles.bottomInput}
              value={props.damageQty}
              onChangeText={(v) => props.setDamageQty(v.replace(/[^0-9.]/g, ''))}
              placeholder="Damage Qty (optional)"
              keyboardType="decimal-pad"
              placeholderTextColor={MUTED}
            />
          </>
        )}
        <View style={styles.actionRow}>
          <SecondaryButton title="Add to List" onPress={props.onAdd} disabled={!props.selectedPart} />
          <PrimaryButton title={`Submit All (${props.list.length})`} onPress={props.onSubmit} disabled={!props.list.length} busy={props.busy} compact />
        </View>
      </View>
    </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

function NotificationsScreen({ onBack, rows, busy, refresh, openRequest, pickRequest, rejectRequest }) {
  return (
    <ScreenBackground>
    <View style={styles.flex}>
      <Header title="Request List" onBack={onBack} action="Refresh" onAction={refresh} />
      {busy && <ActivityIndicator style={{ marginTop: 16 }} color={BLUE} />}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.request_group_key}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={!busy ? <Empty text="No pending request for your branch." /> : null}
        renderItem={({ item }) => {
          const status = requestStatus(item);
          const label = item.status_label || statusLabelFor(status);
          const owner = ownerName(item);
          const showPick = canPickRequest(item);
          const showReject = canRejectRequest(item);
          const showOwner = owner && status !== 'pending';
          return (
            <View style={styles.requestCard}>
              <TouchableOpacity onPress={() => openRequest(item)}>
                <View style={styles.rowBetween}>
                  <Text style={styles.requestNo}>{item.request_number}</Text>
                  <Text style={[styles.newBadge, status !== 'pending' && styles.statusBadgeMuted]}>{label}</Text>
                </View>
                <Text style={styles.requestFrom}>From: {item.requesting_dealer || '-'} / {item.requesting_branch || '-'}</Text>
                <Text style={styles.requestFrom}>To: {item.supplying_dealer || '-'} / {item.supplying_branch || '-'}</Text>
                {showOwner ? (
                  <Text style={styles.requestOwner}>
                    {status === 'accepted' || status === 'picking_completed' ? 'Accepted by' : status === 'rejected' ? 'Rejected by' : 'Picked by'} {owner}
                  </Text>
                ) : null}
                {status === 'rejected' && item.rejection_reason ? (
                  <Text style={styles.requestOwner}>Reason: {item.rejection_reason}</Text>
                ) : null}
                <Text style={styles.requestMeta}>
                  Items: {item.total_items || 0}    Qty: {item.total_quantity || 0}    SLA: {formatSlaRemaining(item.response_deadline)}
                </Text>
              </TouchableOpacity>
              {(showPick || showReject) && (
                <View style={styles.requestActions}>
                  {showReject ? (
                    <TouchableOpacity style={styles.rejectListButton} onPress={() => rejectRequest(item)}>
                      <Text style={styles.rejectListText}>Reject</Text>
                    </TouchableOpacity>
                  ) : null}
                  {showPick ? (
                    <TouchableOpacity style={styles.pickButton} onPress={() => pickRequest(item)}>
                      <Text style={styles.pickText}>Pick Request</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
    </ScreenBackground>
  );
}

function RequestScreen({
  onBack,
  request,
  rows,
  updateRow,
  onSubmit,
  onComplete,
  onTransfer,
  onRelease,
  busy,
  canEdit,
  confirmDeadlineAt,
  confirmSecondsLeft,
}) {
  const scrollRef = useRef(null);
  const qtyRefs = useRef({});
  const status = requestStatus(request);
  const owner = ownerName(request);
  const locked = !canEdit;
  const allAnswered = rows.length > 0 && rows.every((row) => String(row.acceptedQty ?? '').trim() !== '');

  const keepQtyVisible = (orderRequestId) => {
    const node = qtyRefs.current[orderRequestId];
    if (!node || !scrollRef.current) return;
    const scrollHandle = findNodeHandle(scrollRef.current);
    if (!scrollHandle) return;
    setTimeout(() => {
      node.measureLayout(
        scrollHandle,
        (_x, y) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
        },
        () => {}
      );
    }, Platform.OS === 'android' ? 280 : 80);
  };

  const lockMessage =
    status === 'expired'
      ? 'EXPIRED – NO RESPONSE'
      : status === 'picking_completed'
        ? `PICKING COMPLETED${owner ? ` · ${owner}` : ''}`
        : status === 'picked' && owner && locked
          ? `Picked by ${owner}`
          : status === 'accepted' && owner
            ? `Accepted by ${owner}`
            : status === 'rejected' && owner
              ? `Rejected by ${owner}${request?.rejection_reason ? ` — ${request.rejection_reason}` : ''}`
              : locked
                ? 'Pick this request to edit and submit.'
                : '';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <Header title="Request Parts" onBack={onBack} />
      <View style={styles.requestHeader}>
        <Text style={styles.requestHeaderNo}>{request?.request_number}</Text>
        <Text style={styles.requestHeaderSub}>{request?.requesting_branch || request?.requesting_dealer || '-'}</Text>
        {lockMessage ? <Text style={styles.requestLockNote}>{lockMessage}</Text> : null}
        {canEdit && confirmDeadlineAt && confirmSecondsLeft != null && confirmSecondsLeft > 0 ? (
          <View style={styles.confirmBanner}>
            <Text style={styles.confirmBannerText}>
              Confirm quantities within {confirmSecondsLeft}s
            </Text>
          </View>
        ) : null}
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.requestPartsContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {rows.map((row) => {
          const confirmed = String(row.acceptedQty ?? '').trim() !== '';
          const accepted = numberValue(row.acceptedQty);
          const partStatus = !confirmed
            ? 'UNCONFIRMED'
            : accepted === row.requestedQty
              ? 'ACCEPTED'
              : accepted === 0
                ? 'ZERO'
                : 'PARTIAL';
          return (
            <View key={row.orderRequestId} style={styles.requestPartCard}>
              <Text style={styles.partNumberText}>{row.partNumber}</Text>
              <Text style={styles.partDescriptionText}>{row.partName}</Text>
              <Text style={styles.locValueText}>LOC  {row.loc}</Text>
              <View style={styles.agingBlock}>
                <Text style={styles.agingLabelText}>Purchase Aging  {row.purchaseAging}</Text>
                <Text style={styles.agingLabelText}>Sales Aging  {row.salesAging}</Text>
              </View>
              <View style={styles.qtyBlock}>
                <View style={styles.qtyField}>
                  <Text style={styles.qtyLabel}>Request Qty</Text>
                  <Text style={styles.qtyReadOnly}>{row.requestedQty}</Text>
                </View>
                <View style={styles.qtyField}>
                  <Text style={styles.qtyLabel}>Accepted Qty</Text>
                  {locked ? (
                    <Text style={styles.qtyReadOnly}>{confirmed ? row.acceptedQty : '—'}</Text>
                  ) : (
                    <TextInput
                      ref={(el) => {
                        qtyRefs.current[row.orderRequestId] = el;
                      }}
                      style={styles.acceptedQtyInput}
                      value={row.acceptedQty}
                      onChangeText={(v) => updateRow(row.orderRequestId, 'acceptedQty', v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor={MUTED}
                      onFocus={() => keepQtyVisible(row.orderRequestId)}
                    />
                  )}
                </View>
              </View>
              <View style={styles.requestCardStatus}>
                <StatusPill value={partStatus} />
              </View>
              {confirmed && partStatus !== 'ACCEPTED' && (
                locked ? (
                  row.remark ? <Text style={styles.remarkReadOnly}>{row.remark}</Text> : null
                ) : (
                  <TextInput
                    style={styles.remarkInput}
                    value={row.remark}
                    onChangeText={(v) => updateRow(row.orderRequestId, 'remark', v)}
                    placeholder="Remark required if qty is below requested"
                    placeholderTextColor={MUTED}
                    onFocus={() => keepQtyVisible(row.orderRequestId)}
                  />
                )
              )}
            </View>
          );
        })}
      </ScrollView>
      {canEdit ? (
        <View style={styles.submitBar}>
          <PrimaryButton title="Submit Responses" onPress={onSubmit} busy={busy} />
          <View style={{ height: 10 }} />
          <PrimaryButton
            title="Picking Finished"
            onPress={onComplete}
            busy={busy}
            disabled={!allAnswered}
          />
          <View style={styles.requestActions}>
            <TouchableOpacity style={styles.snoozeButton} onPress={onTransfer} disabled={busy || !canTransferRequest(request)}>
              <Text style={styles.snoozeText}>Transfer Picking</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.snoozeButton} onPress={onRelease} disabled={busy}>
              <Text style={styles.snoozeText}>Release</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function PairingScannerScreen({ onBack, onBarcodeScanned, scanned, onScanAgain }) {
  return (
    <View style={styles.scannerPage}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
      />
      <View style={styles.scannerShade} />
      <TouchableOpacity style={styles.scannerClose} onPress={onBack}>
        <Text style={styles.scannerCloseText}>×</Text>
      </TouchableOpacity>
      <View style={styles.qrFrame}>
        <View style={styles.qrCornerTL} />
        <View style={styles.qrCornerTR} />
        <View style={styles.qrCornerBL} />
        <View style={styles.qrCornerBR} />
      </View>
      <Text style={styles.scanHelp}>Scan the pairing QR generated from the NMTS website</Text>
      {scanned && (
        <View style={styles.scannerBottomBar}>
          <SecondaryButton title="Scan Again" onPress={onScanAgain} />
        </View>
      )}
    </View>
  );
}

function ScannerScreen({ onBack, cameraRef, cameraLayout, scanFrameLayout, scanLine, onScan, busy }) {
  const translateY = scanLine.interpolate({ inputRange: [0, 1], outputRange: [0, 94] });
  return (
    <View
      style={styles.scannerPage}
      onLayout={(e) => {
        cameraLayout.current = e.nativeEvent.layout;
      }}
    >
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="picture" />
      <View style={styles.scannerShade} />
      <TouchableOpacity style={styles.scannerClose} onPress={onBack}>
        <Text style={styles.scannerCloseText}>×</Text>
      </TouchableOpacity>
      <View
        style={styles.scanFrame}
        onLayout={(e) => {
          scanFrameLayout.current = e.nativeEvent.layout;
        }}
      >
        <Animated.View style={[styles.scanBeam, { transform: [{ translateY }] }]} />
      </View>
      <Text style={styles.scanHelp}>Keep only the part number inside this box</Text>
      <View style={styles.scannerBottomBar}>
        <TouchableOpacity style={styles.scanButton} onPress={onScan} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.scanButtonText}>Scan Part Number</Text>}
        </TouchableOpacity>
        <Text style={styles.vibrationNote}>Vibration only • No camera sound</Text>
      </View>
    </View>
  );
}

function MenuButton({ icon, title, subtitle, onPress, accent, badge }) {
  return (
    <TouchableOpacity
      style={[styles.menuButton, accent ? { borderColor: `${accent}55`, shadowColor: accent } : null]}
      onPress={onPress}
    >
      <View style={[styles.menuIcon, accent ? { backgroundColor: `${accent}22` } : null]}>
        <Text style={{ fontSize: 22 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSub}>{subtitle}</Text>
      </View>
      {badge ? (
        <View style={styles.menuBadge}>
          <Text style={styles.menuBadgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}
function LoadingScreen({ label }) {
  return (
    <SafeAreaView style={[styles.safeArea, styles.center]}>
      <ActivityIndicator size="large" color={BLUE} />
      <Text style={{ marginTop: 12, color: MUTED }}>{label}</Text>
    </SafeAreaView>
  );
}
function MiniStat({ label, value }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}
function InfoGrid({ rows }) {
  return (
    <View style={styles.infoGrid}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.infoCell}>
          <Text style={styles.infoLabel}>{label}</Text>
          <Text style={styles.infoValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
function VerificationRow({ row, onDelete }) {
  return (
    <View style={styles.verificationRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowPartNo}>{row.partNumber}</Text>
        <Text style={styles.rowPartName}>{row.partName}</Text>
        <Text style={styles.rowMeta}>
          Sys: {row.systemQty}   Phys: {row.physicalQty}   LOC: {row.physicalLocation}
          {row.damageQty ? `   Dmg: ${row.damageQty}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <StatusPill value={row.status} />
        <TouchableOpacity onPress={onDelete}>
          <Text style={styles.delete}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },
  offline: { backgroundColor: '#fff2c7', paddingVertical: 7, alignItems: 'center' },
  offlineText: { color: '#7b5b00', fontSize: 12, fontWeight: '700' },
  pairRoot: { flex: 1, width: PAIR_WINDOW.width, overflow: 'hidden' },
  pairScroll: { flex: 1, width: PAIR_WINDOW.width, alignSelf: 'stretch' },
  pairPage: {
    flexGrow: 1,
    width: PAIR_WINDOW.width,
    maxWidth: PAIR_WINDOW.width,
    alignSelf: 'stretch',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 56,
    minHeight: PAIR_WINDOW.height,
  },
  loginBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: PAIR_SCREEN.width,
    height: PAIR_SCREEN.height,
  },
  loginDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: PAIR_SCREEN.width,
    height: PAIR_SCREEN.height,
    backgroundColor: 'rgba(5,7,6,0.70)',
  },
  transferBanner: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: 'rgba(255, 93, 108, 0.16)',
    borderWidth: 1,
    borderColor: DANGER,
    borderRadius: 16,
  },
  transferBannerTitle: { color: DANGER, fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  transferBannerText: { marginTop: 8, color: DARK, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  qrInfo: { color: MUTED, fontSize: 12, lineHeight: 18, marginBottom: 16 },
  detectedUser: { marginTop: 12, color: SUCCESS, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  brandLogo: { alignSelf: 'center', width: 190, height: 190 },
  appTitle: { marginTop: 16, textAlign: 'center', color: DARK, fontSize: 24, fontWeight: '900' },
  appSub: { marginTop: 4, marginBottom: 22, textAlign: 'center', color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  card: { backgroundColor: CARD_SOLID, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: BORDER },
  homePage: { padding: 20, paddingBottom: 50 },
  homeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hello: { color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  homeName: { marginTop: 3, color: DARK, fontSize: 24, fontWeight: '900' },
  homeAppLabel: { marginTop: 4, color: MUTED, fontSize: 11, fontWeight: '700' },
  headerIconButton: {
    width: 42,
    height: 42,
    marginRight: 8,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_SOLID,
  },
  headerIcon: { fontSize: 16 },
  headerDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SUCCESS,
  },
  logoutChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_SOLID,
  },
  logout: { color: DANGER, fontWeight: '800', fontSize: 12 },
  branchCard: {
    marginTop: 20,
    marginBottom: 22,
    padding: 18,
    backgroundColor: CARD_SOLID,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: NEON_CYAN,
    shadowColor: NEON_CYAN,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  branchKicker: { color: NEON_CYAN, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  branchTitle: { marginTop: 6, color: DARK, fontSize: 22, fontWeight: '900' },
  branchSub: { marginTop: 6, color: MUTED, fontSize: 12 },
  menuButton: {
    minHeight: 82,
    marginBottom: 13,
    padding: 15,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: 'rgba(62, 224, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  menuTitle: { color: DARK, fontSize: 16, fontWeight: '900' },
  menuSub: { marginTop: 4, color: MUTED, fontSize: 11 },
  menuBadge: {
    marginRight: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: WARNING,
  },
  menuBadgeText: { color: '#041018', fontSize: 10, fontWeight: '900' },
  chevron: { color: BLUE, fontSize: 28 },
  pendingCard: {
    marginTop: 10,
    padding: 14,
    backgroundColor: 'rgba(240, 193, 77, 0.12)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: WARNING,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pendingText: { color: WARNING, flex: 1 },
  pendingAction: { color: BLUE, fontWeight: '900' },
  topContent: { padding: 14, paddingBottom: 20 },
  sectionLabel: { marginBottom: 10, color: DARK, fontSize: 11, fontWeight: '900' },
  verificationRow: {
    marginBottom: 10,
    padding: 14,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
    flexDirection: 'row',
  },
  rowPartNo: { color: DARK, fontSize: 14, fontWeight: '900' },
  rowPartName: { marginTop: 3, color: MUTED, fontSize: 11 },
  rowMeta: { marginTop: 7, color: MUTED, fontSize: 11 },
  delete: { marginTop: 10, color: DANGER, fontSize: 11, fontWeight: '800' },
  summaryRow: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  miniStat: {
    flex: 1,
    marginRight: 6,
    paddingVertical: 10,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    alignItems: 'center',
  },
  miniValue: { color: BLUE, fontSize: 17, fontWeight: '900' },
  miniLabel: { marginTop: 3, color: MUTED, fontSize: 9 },
  detailCard: { padding: 16, backgroundColor: CARD_SOLID, borderWidth: 1, borderColor: BORDER, borderRadius: 18 },
  partBig: { color: DARK, fontSize: 19, fontWeight: '900' },
  partName: { marginTop: 4, color: MUTED },
  infoGrid: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap' },
  infoCell: { width: '50%', paddingVertical: 8 },
  infoLabel: { color: MUTED, fontSize: 10, fontWeight: '700' },
  infoValue: { marginTop: 3, color: DARK, fontWeight: '900' },
  bottomPanel: {
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 22 : 12,
    backgroundColor: CARD_SOLID,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center' },
  bottomInput: {
    flex: 1,
    minHeight: 48,
    marginBottom: 9,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: 'rgba(8, 16, 28, 0.92)',
    color: DARK,
  },
  twoInputs: { flexDirection: 'row' },
  halfInput: { marginRight: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  listContent: { padding: 14, paddingBottom: 30 },
  requestCard: { marginBottom: 12, padding: 16, backgroundColor: CARD_SOLID, borderWidth: 1, borderColor: BORDER, borderRadius: 17 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  requestNo: { color: DARK, fontSize: 16, fontWeight: '900' },
  newBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: DANGER, color: '#fff', fontSize: 9, fontWeight: '900', overflow: 'hidden' },
  statusBadgeMuted: { backgroundColor: MUTED },
  requestFrom: { marginTop: 9, color: MUTED, fontSize: 12 },
  requestOwner: { marginTop: 6, color: NEON_YELLOW, fontSize: 12, fontWeight: '800' },
  requestLockNote: { marginTop: 8, color: NEON_YELLOW, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  remarkReadOnly: { marginTop: 8, color: MUTED, fontSize: 12 },
  requestMeta: { marginTop: 7, color: MUTED, fontSize: 11 },
  requestActions: { marginTop: 13, flexDirection: 'row' },
  snoozeButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  snoozeText: { color: MUTED, fontWeight: '800' },
  rejectListButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: DANGER,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  rejectListText: { color: DANGER, fontWeight: '800' },
  pickButton: { flex: 1.5, minHeight: 42, backgroundColor: BLUE, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pickText: { color: '#041018', fontWeight: '900' },
  confirmBanner: {
    marginTop: 10,
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(245, 197, 66, 0.18)',
    borderWidth: 1,
    borderColor: NEON_YELLOW,
  },
  confirmBannerText: { color: NEON_YELLOW, fontWeight: '800', fontSize: 13, textAlign: 'center' },
  rejectModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  rejectModalCard: {
    backgroundColor: CARD_SOLID,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
  },
  rejectModalTitle: { color: DANGER, fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  rejectModalHint: { marginTop: 8, color: MUTED, fontSize: 12 },
  rejectModalMeta: { marginTop: 6, color: DARK, fontWeight: '800' },
  rejectModalInput: {
    marginTop: 12,
    minHeight: 88,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    color: DARK,
    textAlignVertical: 'top',
    backgroundColor: 'rgba(8, 16, 28, 0.92)',
  },
  rejectModalDisabled: { opacity: 0.45 },
  requestHeader: { padding: 14, backgroundColor: CARD_SOLID, borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: 'center' },
  requestHeaderNo: { color: DARK, fontSize: 17, fontWeight: '900' },
  requestHeaderSub: { marginTop: 3, color: MUTED, fontSize: 11 },
  requestPartsContent: { padding: 10, paddingBottom: 220 },
  requestPartCard: { marginTop: 10, padding: 14, backgroundColor: CARD_SOLID, borderWidth: 1, borderColor: BORDER, borderRadius: 14 },
  partNumberText: { color: DARK, fontSize: 20, fontWeight: '900' },
  partDescriptionText: { marginTop: 4, color: MUTED, fontSize: 12, fontWeight: '600' },
  locValueText: { marginTop: 10, color: DARK, fontSize: 16, fontWeight: '800' },
  agingBlock: { marginTop: 10 },
  agingLabelText: { color: DARK, fontSize: 13, fontWeight: '700', marginTop: 3 },
  qtyBlock: { marginTop: 12, flexDirection: 'row' },
  qtyField: { flex: 1, marginRight: 8 },
  qtyLabel: { color: MUTED, fontSize: 11, fontWeight: '800', marginBottom: 6 },
  qtyReadOnly: { minHeight: 48, borderWidth: 1, borderColor: BORDER, borderRadius: 10, textAlign: 'center', textAlignVertical: 'center', color: DARK, fontSize: 18, fontWeight: '800', paddingTop: 12, backgroundColor: 'rgba(62, 224, 255, 0.08)' },
  acceptedQtyInput: { minHeight: 48, borderWidth: 2, borderColor: BLUE, borderRadius: 10, textAlign: 'center', color: DARK, fontSize: 22, fontWeight: '900', backgroundColor: CARD_SOLID },
  requestCardStatus: { marginTop: 10, alignItems: 'flex-start' },
  tableHeader: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 9, backgroundColor: 'rgba(62, 224, 255, 0.12)', borderRadius: 10 },
  th: { flex: 1, color: DARK, fontSize: 9, fontWeight: '900', textAlign: 'center' },
  requestPartRow: { marginTop: 9, padding: 10, backgroundColor: CARD_SOLID, borderWidth: 1, borderColor: BORDER, borderRadius: 13 },
  requestMainLine: { flexDirection: 'row', alignItems: 'center' },
  tdStrong: { color: DARK, fontSize: 10, fontWeight: '900' },
  td: { flex: 1, textAlign: 'center', color: DARK, fontSize: 10 },
  qtyInput: { flex: 1, height: 38, paddingHorizontal: 5, borderWidth: 1, borderColor: BORDER, borderRadius: 7, textAlign: 'center', color: DARK },
  requestExtra: { marginTop: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  requestExtraText: { flex: 1, color: MUTED, fontSize: 9 },
  remarkInput: { marginTop: 8, minHeight: 40, paddingHorizontal: 10, borderWidth: 1, borderColor: BORDER, borderRadius: 9, color: DARK },
  submitBar: { padding: 12, backgroundColor: CARD_SOLID, borderTopWidth: 1, borderTopColor: BORDER },
  scannerPage: { flex: 1, backgroundColor: '#000' },
  qrFrame: { position: 'absolute', top: '28%', left: '15%', right: '15%', aspectRatio: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  qrCornerTL: { position: 'absolute', left: -2, top: -2, width: 34, height: 34, borderLeftWidth: 4, borderTopWidth: 4, borderColor: '#62f08d' },
  qrCornerTR: { position: 'absolute', right: -2, top: -2, width: 34, height: 34, borderRightWidth: 4, borderTopWidth: 4, borderColor: '#62f08d' },
  qrCornerBL: { position: 'absolute', left: -2, bottom: -2, width: 34, height: 34, borderLeftWidth: 4, borderBottomWidth: 4, borderColor: '#62f08d' },
  qrCornerBR: { position: 'absolute', right: -2, bottom: -2, width: 34, height: 34, borderRightWidth: 4, borderBottomWidth: 4, borderColor: '#62f08d' },
  scannerShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  scannerClose: {
    position: 'absolute',
    top: 18,
    left: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerCloseText: { color: '#fff', fontSize: 30 },
  scanFrame: {
    position: 'absolute',
    left: 36,
    right: 36,
    top: 190,
    height: 120,
    borderWidth: 2,
    borderColor: '#4ee070',
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  scanBeam: { height: 3, backgroundColor: '#70ff8d', shadowColor: '#70ff8d', shadowOpacity: 1, shadowRadius: 8, elevation: 8 },
  scanHelp: { position: 'absolute', top: 330, left: 20, right: 20, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: '700' },
  scannerBottomBar: { position: 'absolute', left: 20, right: 20, bottom: 38, alignItems: 'center' },
  scanButton: { width: '100%', minHeight: 54, borderRadius: 15, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  scanButtonText: { color: '#041018', fontWeight: '900' },
  vibrationNote: { marginTop: 10, color: '#d6dbe5', fontSize: 11 },
});
