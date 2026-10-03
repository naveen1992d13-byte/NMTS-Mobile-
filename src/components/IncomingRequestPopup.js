import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BORDER, CARD_SOLID, MUTED, NEON_CYAN, NEON_YELLOW, TEXT } from '../theme';
import { canPickRequest, canSnoozeRequest, ownerName, requestStatus } from '../utils/requestAlert';

export default function IncomingRequestPopup({ visible, alert, onPick, onSnooze, onOpen }) {
  if (!alert) return null;
  const transferred = alert.type === 'request_transferred';
  const showPick = !transferred && canPickRequest(alert.group || alert);
  const skipAllowed = !transferred && canSnoozeRequest(alert.group || alert);
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSnooze}>
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
              {skipAllowed ? (
                <TouchableOpacity style={styles.snooze} onPress={onSnooze}>
                  <Text style={styles.snoozeText}>SNOOZE</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[styles.pick, !skipAllowed && styles.pickSolo]} onPress={onPick}>
                <Text style={styles.pickText}>PICK</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.dismiss} onPress={onSnooze}>
              <Text style={styles.snoozeText}>DISMISS</Text>
            </TouchableOpacity>
          )}
        </View>
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
  snooze: {
    flex: 1,
    minHeight: 48,
    marginRight: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeText: { color: MUTED, fontWeight: '900' },
  pick: {
    flex: 1.4,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: NEON_CYAN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickSolo: { flex: 1 },
  pickText: { color: '#041018', fontWeight: '900' },
  dismiss: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
