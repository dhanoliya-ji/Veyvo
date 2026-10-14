import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, ShieldCheck } from 'lucide-react-native';
import { create } from 'zustand';

import { useBlock, useReport } from '@/api/hooks';
import type { ReportTarget } from '@/api/types';
import { Button, Input, ListRow, PressableScale, Sheet, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

// Mirrors backend REPORT_REASONS.
export const REPORT_REASONS: { key: string; label: string }[] = [
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'hate', label: 'Hate speech' },
  { key: 'sexual', label: 'Sexual content' },
  { key: 'underage', label: 'User may be under 18' },
  { key: 'spam', label: 'Spam or scams' },
  { key: 'impersonation', label: 'Impersonation' },
  { key: 'threats', label: 'Threats or violence' },
  { key: 'self_harm', label: 'Self-harm concern' },
  { key: 'other', label: 'Something else' },
];

type ReportRequest = {
  targetType: ReportTarget;
  targetId: string;
  /** Shown in the sheet, e.g. "Maya's profile" or "this message". */
  subject: string;
  /** If set, offers "Also block this person". */
  blockUserId?: string;
  onBlocked?: () => void;
};

const useReportStore = create<{ request: ReportRequest | null; set: (r: ReportRequest | null) => void }>((set) => ({
  request: null,
  set: (request) => set({ request }),
}));

/** Open the report flow from anywhere: `openReport({ targetType: 'user', targetId, subject })`. */
export const openReport = (request: ReportRequest) => useReportStore.getState().set(request);

export function ReportHost() {
  const { colors } = useTheme();
  const { request, set } = useReportStore();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [done, setDone] = useState(false);
  const report = useReport();
  const block = useBlock();

  useEffect(() => {
    if (request) {
      setReason(null);
      setDetails('');
      setAlsoBlock(false);
      setDone(false);
    }
  }, [request]);

  const close = () => set(null);

  const submit = async () => {
    if (!request || !reason) return;
    try {
      await report.mutateAsync({ target_type: request.targetType, target_id: request.targetId, reason, description: details.trim() || undefined });
      if (alsoBlock && request.blockUserId) {
        await block.mutateAsync({ userId: request.blockUserId, block: true });
        request.onBlocked?.();
      }
      haptic.success();
      setDone(true);
    } catch (e) {
      toast.error("Couldn't send your report", errorMessage(e));
    }
  };

  return (
    <Sheet visible={!!request} onClose={close} title={done ? undefined : `Report ${request?.subject ?? ''}`} scroll>
      {done ? (
        <View style={styles.done}>
          <View style={[styles.doneIcon, { backgroundColor: colors.successSoft }]}>
            <ShieldCheck size={28} color={colors.success} />
          </View>
          <Text variant="heading" center>
            Thanks for telling us
          </Text>
          <Text tone="muted" center>
            Our moderators will review this. Reports are confidential — the person isn't told who reported them.
            {alsoBlock ? ' They are now blocked and can no longer contact you.' : ''}
          </Text>
          <Button title="Done" onPress={close} fullWidth style={{ marginTop: space.md }} />
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Text tone="muted">What's going on? Pick the closest reason.</Text>
          <View style={{ gap: space.xs }} accessibilityRole="radiogroup">
            {REPORT_REASONS.map((r) => {
              const active = reason === r.key;
              return (
                <PressableScale
                  key={r.key}
                  onPress={() => setReason(r.key)}
                  hapticFeedback="tap"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[styles.reason, { backgroundColor: active ? colors.primarySoft : colors.surfaceAlt, borderColor: active ? colors.primary : 'transparent' }]}
                >
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {r.label}
                  </Text>
                  {active ? <Check size={18} color={colors.primary} /> : null}
                </PressableScale>
              );
            })}
          </View>
          <Input label="Anything else? (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} counter placeholder="Add details that help our team understand" />
          {request?.blockUserId ? (
            <View style={[styles.blockRow, { backgroundColor: colors.surfaceAlt }]}>
              <ListRow title="Also block this person" subtitle="They won't be able to find or contact you." toggle={{ value: alsoBlock, onChange: setAlsoBlock }} />
            </View>
          ) : null}
          <Text variant="caption" tone="faint">
            If someone is in immediate danger, contact your local emergency services.
          </Text>
          <Button title="Send report" onPress={submit} disabled={!reason} loading={report.isPending || block.isPending} fullWidth />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reason: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1.5 },
  blockRow: { borderRadius: radius.lg, overflow: 'hidden' },
  done: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
});
