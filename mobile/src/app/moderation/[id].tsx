import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useModDecision, useModReport } from '@/api/hooks';
import { UserRow } from '@/components/cards';
import { REPORT_REASONS } from '@/components/safety/ReportSheet';
import { Badge, Button, Card, Chip, ErrorState, Header, Input, RowSkeleton, Screen, SectionHeader, Text, confirm } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const SUSPEND_DAYS = [1, 3, 7, 30];

export default function ReportReview() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const report = useModReport(id);
  const decide = useModDecision(id);
  const [note, setNote] = useState('');
  const [days, setDays] = useState(3);
  const r = report.data;

  const act = async (action: string, opts: { destructive?: boolean; title?: string } = {}) => {
    if (opts.destructive && !(await confirm({ title: opts.title ?? 'Are you sure?', message: 'This takes effect immediately and is recorded in the audit log.', confirmLabel: 'Confirm', destructive: true }))) return;
    try {
      await decide.mutateAsync({ action, note: note.trim() || undefined, suspend_days: action === 'suspend' ? days : undefined });
      toast.success('Decision saved');
      if (action !== 'mark_reviewing') router.back();
    } catch (e) {
      toast.error("Couldn't save decision", errorMessage(e));
    }
  };

  const reasonLabel = r ? REPORT_REASONS.find((x) => x.key === r.reason)?.label ?? r.reason : '';
  const closed = r?.status === 'actioned' || r?.status === 'dismissed';

  return (
    <Screen scroll keyboard header={<Header title="Report" subtitle={r ? `${reasonLabel} · ${timeAgo(r.created_at)}` : undefined} />}>
      {report.isLoading ? <RowSkeleton /> : null}
      {report.isError ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : null}
      {r ? (
        <View style={{ gap: space.xl, marginTop: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Badge label={r.status} tone={closed ? 'success' : 'warning'} />
            <Badge label={r.target_type.replace('_', ' ')} tone="neutral" />
            {r.prior_reports_against_target ? <Badge label={`${r.prior_reports_against_target} prior reports`} tone="danger" /> : null}
            {r.target_user_status && r.target_user_status !== 'active' ? <Badge label={`account ${r.target_user_status}`} tone="danger" /> : null}
          </View>

          <Card style={{ gap: space.sm }}>
            <Text variant="label" tone="muted">
              Reported content (snapshot)
            </Text>
            {Object.keys(r.evidence).length ? (
              Object.entries(r.evidence).map(([k, v]) => (
                <View key={k} style={{ gap: 2 }}>
                  <Text variant="caption" tone="faint">
                    {k.replace('_', ' ')}
                  </Text>
                  <Text selectable>{String(v ?? '—')}</Text>
                </View>
              ))
            ) : (
              <Text tone="muted">No snapshot (cleared by retention policy).</Text>
            )}
            {r.description ? (
              <View style={[styles.quote, { borderColor: colors.border }]}>
                <Text variant="caption" tone="faint">
                  Reporter's note
                </Text>
                <Text>{r.description}</Text>
              </View>
            ) : null}
          </Card>

          {r.target_user ? (
            <View>
              <SectionHeader title="Reported account" />
              <UserRow user={r.target_user} onPress={() => router.push(`/user/${r.target_user!.id}`)} />
            </View>
          ) : null}
          {r.reporter ? (
            <View>
              <SectionHeader title="Reporter" subtitle="Never shown to the reported person" />
              <UserRow user={r.reporter} />
            </View>
          ) : null}

          {!closed ? (
            <View style={{ gap: space.md }}>
              <SectionHeader title="Decision" />
              <Input label="Moderator note" value={note} onChangeText={setNote} multiline maxLength={1000} placeholder="Why you made this decision (internal, and shown to the user for warnings/suspensions)" />
              <View style={styles.actions}>
                {r.status === 'open' ? <Button title="Mark reviewing" variant="secondary" size="sm" onPress={() => act('mark_reviewing')} /> : null}
                <Button title="Dismiss" variant="secondary" size="sm" onPress={() => act('dismiss')} />
                {r.target_user ? <Button title="Warn" variant="secondary" size="sm" onPress={() => act('warn')} /> : null}
                {['message', 'room_message', 'community_post'].includes(r.target_type) ? (
                  <Button title="Remove content" variant="secondary" size="sm" onPress={() => act('remove_content', { destructive: true, title: 'Remove this content?' })} />
                ) : null}
                {r.target_type === 'room' ? <Button title="End room" variant="danger" size="sm" onPress={() => act('end_room', { destructive: true, title: 'End this room for everyone?' })} /> : null}
                {r.target_type === 'community' ? (
                  <Button title="Restrict community" variant="danger" size="sm" onPress={() => act('restrict_community', { destructive: true, title: 'Restrict this community?' })} />
                ) : null}
              </View>
              {r.target_user ? (
                <Card style={{ gap: space.md }}>
                  <Text variant="label" tone="muted">
                    Suspend for
                  </Text>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    {SUSPEND_DAYS.map((d) => (
                      <Chip key={d} label={`${d} day${d > 1 ? 's' : ''}`} selected={days === d} onPress={() => setDays(d)} size="sm" />
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button title="Suspend" variant="danger" size="sm" onPress={() => act('suspend', { destructive: true, title: `Suspend for ${days} days?` })} />
                    <Button title="Ban permanently" variant="danger" size="sm" onPress={() => act('ban', { destructive: true, title: 'Permanently ban this account?' })} />
                  </View>
                </Card>
              ) : null}
            </View>
          ) : (
            <Card style={{ gap: space.xs }}>
              <Text variant="bodyStrong">Resolved: {r.resolution?.replace('_', ' ')}</Text>
              {r.reviewer_note ? <Text tone="muted">{r.reviewer_note}</Text> : null}
            </Card>
          )}

          {r.history.length ? (
            <View>
              <SectionHeader title="History" />
              <View style={{ gap: space.sm }}>
                {r.history.map((h) => (
                  <View key={h.id} style={[styles.quote, { borderColor: colors.border }]}>
                    <Text variant="bodyStrong">{h.action.replace(/[_:]/g, ' ')}</Text>
                    <Text variant="caption" tone="muted">
                      {h.actor?.display_name ?? 'system'} · {timeAgo(h.created_at)}
                    </Text>
                    {h.reason ? <Text variant="caption">{h.reason}</Text> : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  quote: { borderLeftWidth: 3, paddingLeft: space.md, paddingVertical: space.xs, gap: 2, borderRadius: radius.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
