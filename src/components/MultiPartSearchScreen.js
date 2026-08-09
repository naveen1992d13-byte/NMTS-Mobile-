import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BLUE, BORDER, DARK, MUTED, SUCCESS, DANGER } from '../theme';
import { Empty, Header, PrimaryButton, StockResultCard } from './ui';

export default function MultiPartSearchScreen({
  onBack,
  input,
  setInput,
  onSearch,
  results,
  notFound,
  busy,
  agingThreshold,
}) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 12}
    >
      <Header title="Multiple Part Search" onBack={onBack} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.sectionLabel}>PASTE PART NUMBERS</Text>
        <Text style={styles.hint}>
          Supports newlines, commas, or spaces. Paste from Excel, WhatsApp, or Notes.
        </Text>
        <TextInput
          style={styles.multiInput}
          value={input}
          onChangeText={setInput}
          placeholder={'26300B1000\n28760H8030\n62419CU000\n95720B4500PJW'}
          placeholderTextColor="#8793a6"
          autoCapitalize="characters"
          autoCorrect={false}
          multiline
          textAlignVertical="top"
        />
        <PrimaryButton title="Search All" onPress={onSearch} busy={busy} />

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, styles.foundCard]}>
            <Text style={styles.summaryValue}>{results.length}</Text>
            <Text style={styles.summaryLabel}>Found</Text>
          </View>
          <View style={[styles.summaryCard, styles.missingCard]}>
            <Text style={[styles.summaryValue, { color: DANGER }]}>{notFound.length}</Text>
            <Text style={styles.summaryLabel}>Not Found</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>RESULTS ({results.length})</Text>
        {busy ? <ActivityIndicator color={BLUE} style={{ marginVertical: 16 }} /> : null}
        {!busy && results.length === 0 ? <Empty text="Matching parts will appear here." /> : null}
        {results.map((row) => (
          <StockResultCard key={`${row.partNumber}-${row.systemLocation}`} row={row} agingThreshold={agingThreshold} />
        ))}

        {notFound.length ? (
          <View style={styles.notFoundBox}>
            <Text style={styles.notFoundTitle}>Not Found ({notFound.length})</Text>
            {notFound.map((part) => (
              <Text key={part} style={styles.notFoundItem}>{part}</Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 14, paddingBottom: 40 },
  sectionLabel: { marginTop: 14, marginBottom: 8, color: DARK, fontSize: 11, fontWeight: '900' },
  hint: { marginBottom: 10, color: MUTED, fontSize: 12, lineHeight: 18 },
  multiInput: {
    minHeight: 180,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#fff',
    color: DARK,
    fontSize: 14,
    lineHeight: 22,
  },
  summaryRow: { marginTop: 16, flexDirection: 'row' },
  summaryCard: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  foundCard: { marginRight: 8, backgroundColor: '#f3fbf6', borderColor: '#9fd4b2' },
  missingCard: { backgroundColor: '#fff7f7', borderColor: '#f0b4b4' },
  summaryValue: { color: SUCCESS, fontSize: 22, fontWeight: '900' },
  summaryLabel: { marginTop: 4, color: MUTED, fontSize: 11, fontWeight: '800' },
  notFoundBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  notFoundTitle: { color: DARK, fontWeight: '900', marginBottom: 8 },
  notFoundItem: { color: MUTED, fontSize: 12, marginBottom: 4 },
});
