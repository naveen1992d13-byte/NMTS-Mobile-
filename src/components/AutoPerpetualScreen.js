import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BLUE, BORDER, CARD_SOLID, DARK, MUTED, SUCCESS, WARNING } from '../theme';
import { calculateVerification, numberValue } from '../utils/stockHelpers';
import { Empty, Header, PrimaryButton, SecondaryButton, StatusPill, SyncStatusBanner } from './ui';
import { ScreenBackground } from './ScreenBackground';

function ProgressBar({ verified, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((verified / total) * 100)) : 0;
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressText}>Verified: {verified} / {total}</Text>
        <Text style={styles.progressPending}>Pending: {Math.max(0, total - verified)}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

function revealedSystemQty(task, local) {
  if (local?.finalized || local?.verified) {
    if (local?.systemQty != null && local.systemQty !== '') return local.systemQty;
  }
  if (task?.count_saved) return task.system_qty;
  return null;
}

function TaskCard({ task, local, onPress }) {
  const verified = Boolean(local?.verified || task?.count_saved);
  const finalized = Boolean(local?.finalized || task?.quantity_finalized);
  const systemQty = revealedSystemQty(task, local);
  const status = local?.status || (task?.quantity_status ? String(task.quantity_status).toUpperCase() : '');
  const matched = status === 'MATCHED';
  const mismatch = verified && status && status !== 'MATCHED';

  return (
    <TouchableOpacity
      style={[
        styles.taskCard,
        verified && matched && styles.taskCardMatched,
        verified && mismatch && styles.taskCardWarn,
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.taskTopRow}>
          <Text style={styles.partNo}>{task.part_number}</Text>
          {finalized ? <StatusPill value="SUBMITTED" /> : verified ? <StatusPill value="SAVED" /> : null}
        </View>
        <Text style={styles.partName}>{task.part_name || '-'}</Text>
        <Text style={styles.meta}>
          LOC: {task.loc || '-'}
          {task.coverage_kind === 'recheck' ? ' · RECHECK' : ''}
          {local?.editCount ? ` · Edits: ${local.editCount}` : ''}
        </Text>
        {verified ? (
          <View style={styles.verifiedMeta}>
            <Text style={styles.verifiedLine}>Physical Qty: {local?.physicalQty ?? task.physical_quantity}</Text>
            {systemQty != null ? <Text style={styles.verifiedLine}>Sys: {systemQty}</Text> : null}
            {status ? <StatusPill value={status} /> : null}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function VerifyModal({
  visible,
  task,
  physicalQty,
  setPhysicalQty,
  damageQty,
  setDamageQty,
  location,
  setLocation,
  remark,
  setRemark,
  correctionReason,
  setCorrectionReason,
  isEdit,
  revealed,
  finalized,
  onClose,
  onSave,
  busy,
}) {
  if (!task) return null;
  const systemQty = revealed ? (task.revealedSystemQty ?? task.system_qty) : null;
  const diff = revealed ? calculateVerification(systemQty, physicalQty, 0) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>
            {finalized ? 'Submitted Count' : isEdit ? 'Correct Physical Quantity' : 'Blind Physical Count'}
          </Text>
          <Text style={styles.partNo}>{task.part_number}</Text>
          <Text style={styles.partName}>{task.part_name || '-'}</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>LOC</Text>
              <Text style={styles.infoValue}>{task.loc || '-'}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>{revealed ? 'System Qty' : 'Physical Quantity'}</Text>
              <Text style={styles.infoValue}>
                {revealed ? (systemQty ?? '-') : 'Count on shelf, then Save'}
              </Text>
            </View>
            {revealed ? (
              <>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Difference</Text>
                  <Text style={styles.infoValue}>{diff?.differenceQty ?? '-'}</Text>
                </View>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Status</Text>
                  {diff ? <StatusPill value={diff.status} /> : <Text style={styles.infoValue}>-</Text>}
                </View>
              </>
            ) : null}
          </View>

          <TextInput
            style={styles.input}
            value={physicalQty}
            onChangeText={(v) => setPhysicalQty(v.replace(/[^0-9.]/g, ''))}
            placeholder="Physical Qty"
            keyboardType="decimal-pad"
            placeholderTextColor={MUTED}
            editable={!finalized}
            autoFocus={!finalized}
          />
          <View style={styles.twoCol}>
            <TextInput
              style={[styles.input, styles.half]}
              value={damageQty}
              onChangeText={(v) => setDamageQty(v.replace(/[^0-9.]/g, ''))}
              placeholder="Damage Qty"
              keyboardType="decimal-pad"
              placeholderTextColor={MUTED}
              editable={!finalized}
            />
            <TextInput
              style={[styles.input, styles.half, { marginRight: 0 }]}
              value={location}
              onChangeText={setLocation}
              placeholder="Physical LOC"
              autoCapitalize="characters"
              placeholderTextColor={MUTED}
              editable={!finalized}
            />
          </View>
          <TextInput
            style={styles.input}
            value={remark}
            onChangeText={setRemark}
            placeholder="Remark (optional)"
            placeholderTextColor={MUTED}
            editable={!finalized}
          />
          {isEdit && !finalized ? (
            <TextInput
              style={styles.input}
              value={correctionReason}
              onChangeText={setCorrectionReason}
              placeholder="Correction reason (required)"
              placeholderTextColor={MUTED}
            />
          ) : null}

          <View style={styles.modalActions}>
            <SecondaryButton title={finalized ? 'Close' : 'Cancel'} onPress={onClose} />
            {finalized ? null : <PrimaryButton title="Save" onPress={onSave} busy={busy} compact />}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function AutoPerpetualScreen({
  onBack,
  sessionId,
  tasks,
  localVerified,
  assignedCount,
  completedCount,
  busy,
  syncStatus,
  onRefresh,
  onSaveLocal,
  onSubmitVerified,
  submitting,
}) {
  const [selected, setSelected] = useState(null);
  const [physicalQty, setPhysicalQty] = useState('');
  const [damageQty, setDamageQty] = useState('');
  const [location, setLocation] = useState('');
  const [remark, setRemark] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [saving, setSaving] = useState(false);

  const totalAssigned = assignedCount || tasks.length;
  const localVerifiedCount = Object.keys(localVerified || {}).length;
  const verifiedCount = Math.max(completedCount || 0, localVerifiedCount);

  const unsyncedVerified = useMemo(
    () => Object.values(localVerified || {}).filter((row) => row.verified && !row.finalized),
    [localVerified]
  );

  const openTask = (task) => {
    const existing = localVerified?.[task.part_number];
    setSelected({
      ...task,
      revealedSystemQty: revealedSystemQty(task, existing),
    });
    setPhysicalQty(existing ? String(existing.physicalQty) : (task.physical_quantity != null && task.count_saved ? String(task.physical_quantity) : ''));
    setDamageQty(existing?.damageQty ? String(existing.damageQty) : '');
    setLocation(existing?.location || (task.loc && task.loc !== '-' ? task.loc : ''));
    setRemark(existing?.remark || '');
    setCorrectionReason('');
  };

  const closeModal = () => {
    setSelected(null);
    setPhysicalQty('');
    setDamageQty('');
    setLocation('');
    setRemark('');
    setCorrectionReason('');
  };

  const handleSave = async () => {
    if (!selected) return;
    if (physicalQty === '' || numberValue(physicalQty) < 0) {
      Alert.alert('Physical Quantity', 'Enter a valid physical quantity.');
      return;
    }
    const existing = localVerified?.[selected.part_number];
    const isEdit = Boolean(existing?.verified || selected.count_saved);
    const finalized = Boolean(existing?.finalized || selected.quantity_finalized);
    if (finalized) {
      Alert.alert('Locked', 'Quantity editing is locked after Final Submit.');
      return;
    }
    if (isEdit && existing?.physicalQty != null && numberValue(physicalQty) !== numberValue(existing.physicalQty) && !String(correctionReason || '').trim()) {
      Alert.alert('Correction reason', 'Enter a reason before changing the counted quantity.');
      return;
    }
    setSaving(true);
    try {
      const systemQty = revealedSystemQty(selected, existing);
      const diff = systemQty == null ? { status: '', differenceQty: 0 } : calculateVerification(systemQty, physicalQty, 0);
      await onSaveLocal({
        task: selected,
        physicalQty: numberValue(physicalQty),
        damageQty: numberValue(damageQty),
        location: (location || selected.loc || '').trim().toUpperCase(),
        remark: remark.trim(),
        status: diff.status,
        differenceQty: diff.differenceQty,
        correctionReason: String(correctionReason || '').trim(),
        isEdit,
      });
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const confirmSubmit = () => {
    Alert.alert(
      'Final Submit',
      `Submit ${unsyncedVerified.length} saved part(s)? The latest saved quantity on the server becomes the final Physical Quantity.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', onPress: onSubmitVerified },
      ]
    );
  };

  const selectedLocal = selected ? localVerified?.[selected.part_number] : null;
  const selectedRevealed = Boolean(selectedLocal?.verified || selected?.count_saved);
  const selectedFinalized = Boolean(selectedLocal?.finalized || selected?.quantity_finalized);

  return (
    <ScreenBackground>
      <View style={styles.flex}>
        <Header title="Auto Perpetual" onBack={onBack} action="Refresh" onAction={onRefresh} />
        <SyncStatusBanner status={syncStatus} />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>TODAY&apos;S SESSION</Text>
          <View style={styles.sessionCard}>
            <Text style={styles.sessionId}>{sessionId || 'Loading session…'}</Text>
            <Text style={styles.sessionSub}>Backend daily Auto Perpetual session (IST)</Text>
          </View>

          <ProgressBar verified={verifiedCount} total={totalAssigned || tasks.length} />

          <Text style={styles.sectionLabel}>ASSIGNED PARTS ({tasks.length})</Text>
          {busy && !tasks.length ? <ActivityIndicator color={BLUE} style={{ marginVertical: 20 }} /> : null}
          {!busy && tasks.length === 0 ? <Empty text="No Auto Perpetual tasks for today." /> : null}
          {tasks.map((task) => (
            <TaskCard
              key={`${task.part_number}-${task.id || ''}`}
              task={task}
              local={localVerified?.[task.part_number]}
              onPress={() => openTask(task)}
            />
          ))}
        </ScrollView>

        <View style={styles.stickyBar}>
          <PrimaryButton
            title={`Final Submit (${unsyncedVerified.length})`}
            onPress={confirmSubmit}
            busy={submitting}
            disabled={!unsyncedVerified.length}
          />
        </View>

        <VerifyModal
          visible={Boolean(selected)}
          task={selected ? { ...selected, revealedSystemQty: revealedSystemQty(selected, selectedLocal) } : null}
          physicalQty={physicalQty}
          setPhysicalQty={setPhysicalQty}
          damageQty={damageQty}
          setDamageQty={setDamageQty}
          location={location}
          setLocation={setLocation}
          remark={remark}
          setRemark={setRemark}
          correctionReason={correctionReason}
          setCorrectionReason={setCorrectionReason}
          isEdit={selectedRevealed}
          revealed={selectedRevealed}
          finalized={selectedFinalized}
          onClose={closeModal}
          onSave={handleSave}
          busy={saving}
        />
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 14, paddingBottom: 120 },
  sectionLabel: { marginBottom: 10, color: DARK, fontSize: 11, fontWeight: '900' },
  sessionCard: {
    padding: 14,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    marginBottom: 12,
  },
  sessionId: { color: DARK, fontSize: 16, fontWeight: '900' },
  sessionSub: { marginTop: 4, color: MUTED, fontSize: 11 },
  progressWrap: {
    marginBottom: 14,
    padding: 14,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressText: { color: DARK, fontWeight: '900', fontSize: 13 },
  progressPending: { color: MUTED, fontWeight: '800', fontSize: 12 },
  progressTrack: { height: 8, borderRadius: 8, backgroundColor: 'rgba(62, 224, 255, 0.16)', overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: SUCCESS },
  taskCard: {
    marginBottom: 10,
    padding: 14,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
  },
  taskCardMatched: { borderColor: SUCCESS, backgroundColor: 'rgba(61, 255, 138, 0.10)' },
  taskCardWarn: { borderColor: WARNING, backgroundColor: 'rgba(240, 193, 77, 0.10)' },
  taskTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  partNo: { color: DARK, fontSize: 14, fontWeight: '900' },
  partName: { marginTop: 3, color: MUTED, fontSize: 11 },
  meta: { marginTop: 7, color: MUTED, fontSize: 11 },
  verifiedMeta: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  verifiedLine: { color: SUCCESS, fontSize: 12, fontWeight: '800' },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 22 : 12,
    backgroundColor: CARD_SOLID,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  modalSheet: {
    backgroundColor: CARD_SOLID,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
  },
  modalTitle: { color: MUTED, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  infoGrid: { marginTop: 14, marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap' },
  infoCell: { width: '50%', paddingVertical: 8 },
  infoLabel: { color: MUTED, fontSize: 10, fontWeight: '700' },
  infoValue: { marginTop: 3, color: DARK, fontWeight: '900' },
  input: {
    minHeight: 48,
    marginBottom: 9,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: 'rgba(8, 16, 28, 0.92)',
    color: DARK,
  },
  twoCol: { flexDirection: 'row' },
  half: { flex: 1, marginRight: 8 },
  modalActions: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
});
