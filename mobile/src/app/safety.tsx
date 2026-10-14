import type { ComponentType } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { BookOpen, DoorOpen, EyeOff, Flag, HeartHandshake, LifeBuoy, Lock, MicOff, Shield, ShieldCheck, UserX, type LucideProps } from 'lucide-react-native';

import { useMyReports } from '@/api/hooks';
import { Badge, Card, Header, ListGroup, ListRow, Screen, SectionHeader, Text } from '@/components/ui';
import { REPORT_REASONS } from '@/components/safety/ReportSheet';
import { LEGAL_URLS, SUPPORT_EMAIL } from '@/lib/config';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const TOOLS: { icon: ComponentType<LucideProps>; title: string; body: string }[] = [
  { icon: DoorOpen, title: 'Leave instantly', body: 'The Leave button is always visible in every room and game.' },
  { icon: UserX, title: 'Block anyone', body: 'From a profile, chat or room. They can no longer find or contact you, and aren’t notified.' },
  { icon: Flag, title: 'Report', body: 'Every profile, message, room and community has Report. Reports are confidential.' },
  { icon: MicOff, title: 'Host controls', body: 'Hosts can mute, remove or ban people from their rooms.' },
  { icon: Lock, title: 'Friends-only messages', body: 'Strangers can never message you. You control requests and invites.' },
  { icon: EyeOff, title: 'Your camera, your choice', body: 'Cameras start off, strangers’ video stays hidden until you tap, and photo location data is removed. We never ask for your location.' },
];

const STATUS: Record<string, { label: string; tone: 'neutral' | 'warning' | 'success' | 'primary' }> = {
  open: { label: 'Received', tone: 'neutral' },
  reviewing: { label: 'In review', tone: 'warning' },
  actioned: { label: 'Action taken', tone: 'success' },
  dismissed: { label: 'Reviewed', tone: 'primary' },
};

export default function SafetyCentre() {
  const { colors } = useTheme();
  const reports = useMyReports();
  const reasonLabel = (key: string) => REPORT_REASONS.find((r) => r.key === key)?.label ?? key;

  return (
    <Screen scroll header={<Header title="Safety centre" />}>
      <View style={{ gap: space.xxl, marginTop: space.sm }}>
        <Card style={{ gap: space.sm, backgroundColor: colors.successSoft, borderColor: 'transparent' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <ShieldCheck size={22} color={colors.success} />
            <Text variant="heading">You're in control</Text>
          </View>
          <Text tone="muted">
            Veyvo is adults-only and built around consent. Every safety tool is free, always.
          </Text>
        </Card>

        <View>
          <SectionHeader title="Your safety tools" />
          <View style={{ gap: space.sm }}>
            {TOOLS.map(({ icon: Icon, title, body }) => (
              <View key={title} style={[styles.tool, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.toolIcon, { backgroundColor: colors.primarySoft }]}>
                  <Icon size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{title}</Text>
                  <Text variant="caption" tone="muted">
                    {body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <ListGroup title="Manage">
          <ListRow icon={Shield} iconTone="success" title="Privacy settings" onPress={() => router.push('/settings/privacy')} />
          <ListRow icon={UserX} iconTone="success" title="Blocked accounts" onPress={() => router.push('/settings/blocked')} />
        </ListGroup>

        <View>
          <SectionHeader title="Your reports" subtitle="We'll update the status as our team reviews them." />
          {reports.data?.length ? (
            <View style={{ gap: space.sm }}>
              {reports.data.map((r) => {
                const s = STATUS[r.status] ?? STATUS.open;
                return (
                  <View key={r.id} style={[styles.report, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{reasonLabel(r.reason)}</Text>
                      <Text variant="caption" tone="muted">
                        {r.target_type.replace('_', ' ')} · {timeAgo(r.created_at)}
                      </Text>
                    </View>
                    <Badge label={s.label} tone={s.tone} />
                  </View>
                );
              })}
            </View>
          ) : (
            <Text tone="muted">{reports.isLoading ? 'Loading…' : "You haven't reported anything."}</Text>
          )}
        </View>

        <ListGroup title="Learn more">
          <ListRow icon={BookOpen} title="Community Guidelines" onPress={() => Linking.openURL(LEGAL_URLS.guidelines)} />
          <ListRow icon={HeartHandshake} title="Child safety standards" onPress={() => Linking.openURL(LEGAL_URLS.childSafety)} />
          <ListRow icon={LifeBuoy} title="Contact the safety team" onPress={() => Linking.openURL(`mailto:safety@veyvo.app`)} />
        </ListGroup>

        <Card style={{ gap: space.xs }}>
          <Text variant="bodyStrong">In immediate danger?</Text>
          <Text variant="caption" tone="muted">
            Contact your local emergency services right away. If you're struggling, reach out to a local crisis line — you don't have to go through it alone. For account help, email {SUPPORT_EMAIL}.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tool: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  toolIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  report: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
