import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { BORDER, CARD_SOLID, DANGER, MUTED, NEON_CYAN, NEON_YELLOW, TEXT } from '../theme';
import { canPickRequest, canRejectRequest, ownerName, requestStatus } from '../utils/requestAlert';

export default function IncomingRequestPopup({ visible, alert, onPick, onReject, onOpen, onDismiss }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!alert) return null;
  const transferred = alert.type === 'request_transferred';
  const showPick = !transferred && canPickRequest(alert.group || alert);
  const showReject = !transferred && canRejectRequest(alert.group || alert);
  const owner = ownerName(alert) || alert.picked_by_name || '';
  const status = requestStatus(alert);
  const statusText =
    status === 'picked' && owner
      ? `PICKED by ${owner}`
      : status === 'accepted' && owner
        ? `ACCEPTED by ${owner}`
        : status === 'picking_completed'
          ? 'PICKING COMPLETED'
          : status === 'rejected' && owner
            ? `REJECTED by ${owner}`
            : status === 'expired'
              ? 'EXPIRED – NO RESPONSE'
              : alert.status_label || '';

  const submitReject = () => {
    const trimmed = String(reason || '').trim();
    if (!trimmed) return;
    setRejectOpen(false);
    setReason('');
    onReject?.(alert, trimmed);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.kicker}>{transferred ? 'REQUEST TRANSFERRED' : 'INCOMING REQUEST'}</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Request Number</Text>
            <Text style={styles.value}>{alert.request_number || '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Requested Branch</Text>
            <Text style={styles.value}>{alert.requested_branch || '—'}</Text>
          </View>
          <View style={styles.metaRow}>
            <View style={styles.metaBox}>
              <Text style={styles.label}>Total Items</Text>
              <Text style={styles.metaValue}>{alert.total_items || 0}</Text>
            </View>
            <View style={styles.metaBox}>
              <Text style={styles.label}>Total Quantity</Text>
              <Text style={styles.metaValue}>{alert.total_qty || 0}</Text>
            </View>
          </View>

          {!showPick && Boolean(statusText) && <Text style={styles.ownerNote}>{statusText}</Text>}

          {transferred ? (
            <TouchableOpacity style={styles.pick} onPress={onOpen || onPick}>
              <Text style={styles.pickText}>OPEN REQUEST</Text>
            </TouchableOpacity>
          ) : showPick ? (
            <View style={styles.actions}>
              {showReject ? (
                <TouchableOpacity style={styles.reject} onPress={() => setRejectOpen(true)}>
                  <Text style={styles.rejectText}>REJECT</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[styles.pick, !showReject && styles.pickSolo]} onPress={onPick}>
                <Text style={styles.pickText}>PICK</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.dismiss} onPress={onDismiss}>
              <Text style={styles.rejectText}>DISMISS</Text>
            </TouchableOpacity>
          )}
        </View>

        <Modal visible={rejectOpen} transparent animationType="fade" onRequestClose={() => setRejectOpen(false)}>
          <View style={styles.backdrop}>
            <View style={styles.card}>
              <Text style={styles.kicker}>REJECT REQUEST</Text>
              <Text style={styles.reasonHint}>Rejection reason is mandatory.</Text>
              <TextInput
                style={styles.reasonInput}
                value={reason}
                onChangeText={setReason}
                placeholder="Enter reason"
                placeholderTextColor={MUTED}
                multiline
                autoFocus
              />
              <View style={styles.actions}>
                <TouchableOpacity style={styles.reject} onPress={() => { setRejectOpen(false); setReason(''); }}>
                  <Text style={styles.rejectText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pick, !String(reason || '').trim() && styles.pickDisabled]}
                  disabled={!String(reason || '').trim()}
                  onPress={submitReject}
                >
                  <Text style={styles.pickText}>CONFIRM REJECT</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 14, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: 20,
    borderRadius: 22,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: NEON_CYAN,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 12,
  },
  kicker: { color: NEON_YELLOW, fontSize: 11, fontWeight: '900', letterSpacing: 1.4, marginBottom: 12 },
  row: { marginBottom: 12 },
  label: { color: MUTED, fontSize: 11, fontWeight: '800' },
  value: { marginTop: 4, color: TEXT, fontSize: 14, fontWeight: '800' },
  metaRow: { flexDirection: 'row', marginTop: 4, marginBottom: 18 },
  metaBox: { flex: 1 },
  metaValue: { marginTop: 4, color: TEXT, fontSize: 16, fontWeight: '900' },
  ownerNote: { color: NEON_YELLOW, fontWeight: '800', marginBottom: 14, fontSize: 13 },
  actions: { flexDirection: 'row' },
  reject: {
    flex: 1,
    minHeight: 48,
    marginRight: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: DANGER || '#ff5c7a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: { color: MUTED, fontWeight: '900' },
  pick: {
    flex: 1.4,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: NEON_CYAN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickSolo: { flex: 1 },
  pickDisabled: { opacity: 0.45 },
  pickText: { color: '#041018', fontWeight: '900' },
  dismiss: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonHint: { color: MUTED, marginBottom: 10, fontWeight: '700' },
  reasonInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    color: TEXT,
    padding: 12,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
});
