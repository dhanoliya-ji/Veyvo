import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Gavel, Inbox, Search, ShieldAlert } from 'lucide-react-native';

import { useAudit, useMe, useModReports, useModUserAction, useModUsers } from '@/api/hooks';
import type { AdminUser } from '@/api/types';
import { Avatar } from '@/components/avatar/Avatar';
import { REPORT_REASONS } from '@/components/safety/ReportSheet';
import { Badge, Button, Chip, EmptyState, ErrorState, Header, Input, PressableScale, RowSkeleton, Screen, SegmentedControl, Sheet, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Tab = 'queue' | 'users' | 'audit';
const STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'] as const;
const URGENT = new Set(['underage', 'threats', 'self_harm', 'sexual']);

function Queue() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('open');
  const reports = useModReports(status);
  const label = (k: string) => REPORT_REASONS.find((r) => r.key === k)?.label ?? k;

  return (
    <View style={{ flex: 1, gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <Chip key={s} label={s[0].toUpperCase() + s.slice(1)} selected={status === s} onPress={() => setStatus(s)} size="sm" />
        ))}
      </View>
      {reports.isLoading ? <RowSkeleton /> : null}
      {reports.isError ? <ErrorState error={reports.error} onRetry={() => reports.refetch()} /> : null}
      {reports.data ? (
        <FlatList
          data={reports.data.items}
          keyExtractor={(r) => r.id}
          onRefresh={() => reports.refetch()}
          refreshing={reports.isRefetching}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          ListEmptyComponent={<EmptyState icon={Inbox} title="Queue is clear" message={`No ${status} reports right now.`} />}
          renderItem={({ item }) => (
            <PressableScale
              onPress={() => router.push(`/moderation/${item.id}`)}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: URGENT.has(item.reason) ? colors.danger : colors.border }]}
              accessibilityLabel={`${label(item.reason)} report about a ${item.target_type}, ${timeAgo(item.created_at)}`}
            >
              {URGENT.has(item.reason) ? <ShieldAlert size={18} color={colors.danger} /> : <Gavel size={18} color={colors.textMuted} />}
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{label(item.reason)}</Text>
                <Text variant="caption" tone="muted">
                  {item.target_type.replace('_', ' ')} · {timeAgo(item.created_at)}
                </Text>
              </View>
              {URGENT.has(item.reason) ? <Badge label="Priority" tone="danger" /> : null}
            </PressableScale>
          )}
        />
      ) : null}
    </View>
  );
}

function Users() {
  const { colors } = useTheme();
  const me = useMe();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const users = useModUsers(debounced);
  const act = useModUserAction();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (action: string, extra: { suspend_days?: number; role?: string } = {}) => {
    if (!target) return;
    if (reason.trim().length < 3) {
      toast.error('Add a reason', 'Every action is recorded in the audit log.');
      return;
    }
    try {
      await act.mutateAsync({ userId: target.id, action, reason: reason.trim(), ...extra });
      toast.success('Done', 'Recorded in the audit log.');
      setTarget(null);
      setReason('');
      users.refetch();
    } catch (e) {
      toast.error("Couldn't apply action", errorMessage(e));
    }
  };

  return (
    <View style={{ flex: 1, gap: space.md }}>
      <Input icon={Search} value={q} onChangeText={setQ} placeholder={me.data?.role === 'admin' ? 'Username, or exact email' : 'Username'} autoCapitalize="none" />
      {users.isFetching && !users.data ? <RowSkeleton count={3} /> : null}
      <FlatList
        data={users.data ?? []}
        keyExtractor={(u) => u.id}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListEmptyComponent={debounced.length >= 2 && !users.isFetching ? <Text tone="muted">No accounts found.</Text> : null}
        renderItem={({ item }) => (
          <PressableScale onPress={() => setTarget(item)} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLabel={`${item.display_name}, ${item.status}`}>
            <Avatar config={item.avatar} size={40} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{item.display_name}</Text>
              <Text variant="caption" tone="muted">
                @{item.username} · {item.reports_against} reports · joined {timeAgo(item.created_at)}
              </Text>
            </View>
            <Badge label={item.status} tone={item.status === 'active' ? 'success' : 'danger'} />
          </PressableScale>
        )}
      />
      <Sheet visible={!!target} onClose={() => setTarget(null)} title={target ? `@${target.username}` : undefined} scroll>
        {target ? (
          <View style={{ gap: space.md }}>
            <Text tone="muted">
              Role: {target.role} · Status: {target.status}
              {target.suspended_until ? ` until ${new Date(target.suspended_until).toLocaleString()}` : ''}
            </Text>
            <Input label="Reason (required, shown to the user for warnings/suspensions)" value={reason} onChangeText={setReason} multiline maxLength={1000} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Button title="View profile" variant="secondary" size="sm" onPress={() => { setTarget(null); router.push(`/user/${target.id}`); }} />
              <Button title="Warn" variant="secondary" size="sm" onPress={() => run('warn')} />
              <Button title="Suspend 1d" variant="secondary" size="sm" onPress={() => run('suspend', { suspend_days: 1 })} />
              <Button title="Suspend 7d" variant="secondary" size="sm" onPress={() => run('suspend', { suspend_days: 7 })} />
              <Button title="Ban" variant="danger" size="sm" onPress={() => run('ban')} />
              {target.status !== 'active' ? <Button title="Reinstate" variant="secondary" size="sm" onPress={() => run('reinstate')} /> : null}
              {me.data?.role === 'admin' && target.role !== 'admin' ? (
                <Button title={target.role === 'moderator' ? 'Remove moderator' : 'Make moderator'} variant="outline" size="sm" onPress={() => run('set_role', { role: target.role === 'moderator' ? 'user' : 'moderator' })} />
              ) : null}
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function Audit() {
  const { colors } = useTheme();
  const audit = useAudit();
  if (audit.isLoading) return <RowSkeleton />;
  if (audit.isError) return <ErrorState error={audit.error} onRetry={() => audit.refetch()} />;
  return (
    <FlatList
      data={audit.data ?? []}
      keyExtractor={(a) => a.id}
      onRefresh={() => audit.refetch()}
      refreshing={audit.isRefetching}
      ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />}
      ListEmptyComponent={<EmptyState icon={Gavel} title="No actions yet" />}
      renderItem={({ item }) => (
        <View style={{ paddingVertical: space.md, gap: 2 }}>
          <Text variant="bodyStrong">{item.action.replace(/[_:]/g, ' ')}</Text>
          <Text variant="caption" tone="muted">
            by {item.actor?.display_name ?? 'system'} · {item.target_type} {item.target_id.slice(0, 8)} · {timeAgo(item.created_at)}
          </Text>
          {item.reason ? (
            <Text variant="caption" tone="faint" numberOfLines={2}>
              {item.reason}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

export default function Moderation() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('queue');
  const isStaff = me.data?.role === 'moderator' || me.data?.role === 'admin';

  return (
    <Screen header={<Header title="Moderation" subtitle="Every action is checked by the server and logged" />}>
      {!isStaff ? (
        <EmptyState icon={ShieldAlert} title="Staff only" message="You don't have access to moderation tools." />
      ) : (
        <View style={{ flex: 1, gap: space.lg }}>
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'queue', label: 'Reports' },
              { value: 'users', label: 'Users' },
              { value: 'audit', label: 'Audit log' },
            ]}
          />
          {tab === 'queue' ? <Queue /> : tab === 'users' ? <Users /> : <Audit />}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
});
