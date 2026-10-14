import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { del, get, patch, post, put } from '@/lib/api';
import type {
  AdminUser,
  AppConfig,
  AuditEntry,
  AvatarConfig,
  Blocked,
  Community,
  CommunityMember,
  CommunityPost,
  Conversation,
  DailyQuestion,
  Friend,
  FriendRequest,
  GameView,
  Home,
  IcebreakerSession,
  Interest,
  LocalMessage,
  MediaToken,
  Me,
  Message,
  ModerateAction,
  Notification,
  Page,
  Privacy,
  PublicProfile,
  Quest,
  Report,
  ReportDetail,
  ReportTarget,
  Reward,
  Room,
  RoomDetail,
  RoomInput,
  RoomMessage,
  SearchResults,
  ShopItem,
  TimerState,
  UserSummary,
} from './types';

export const qk = {
  me: ['me'] as const,
  config: ['config'] as const,
  interests: ['interests'] as const,
  home: ['home'] as const,
  profile: (id: string) => ['profile', id] as const,
  friends: (q?: string) => ['friends', q ?? ''] as const,
  friendsAll: ['friends'] as const,
  requests: ['friend-requests'] as const,
  suggestions: ['suggestions'] as const,
  blocks: ['blocks'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  rooms: (filters: object) => ['rooms', filters] as const,
  roomsAll: ['rooms'] as const,
  room: (id: string) => ['room', id] as const,
  roomChat: (id: string) => ['room-chat', id] as const,
  communities: (filters: object) => ['communities', filters] as const,
  communitiesAll: ['communities'] as const,
  community: (id: string) => ['community', id] as const,
  communityPosts: (id: string) => ['community-posts', id] as const,
  communityMembers: (id: string, status: string) => ['community-members', id, status] as const,
  game: (id: string) => ['game', id] as const,
  myGames: ['my-games'] as const,
  roomGames: (id: string) => ['room-games', id] as const,
  notifications: ['notifications'] as const,
  daily: ['daily'] as const,
  quests: ['quests'] as const,
  shop: ['shop'] as const,
  search: (q: string) => ['search', q] as const,
  icebreaker: ['icebreaker'] as const,
  myReports: ['my-reports'] as const,
  modReports: (status: string) => ['mod-reports', status] as const,
  modReport: (id: string) => ['mod-report', id] as const,
  modUsers: (q: string) => ['mod-users', q] as const,
  audit: ['audit'] as const,
};

// ---------- Session / profile ----------
export const useMe = (enabled = true) => useQuery({ queryKey: qk.me, queryFn: () => get<Me>('/me'), enabled, staleTime: 30_000 });
export const useConfig = () => useQuery({ queryKey: qk.config, queryFn: () => get<AppConfig>('/config'), staleTime: 10 * 60_000 });
export const useInterests = () => useQuery({ queryKey: qk.interests, queryFn: () => get<Interest[]>('/interests'), staleTime: 60 * 60_000 });

function setMe(qc: QueryClient) {
  return (me: Me) => qc.setQueryData(qk.me, me);
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { display_name?: string; username?: string; bio?: string; vibe?: string | null; clear_vibe?: boolean }) => patch<Me>('/me/profile', body),
    onSuccess: setMe(qc),
  });
}

export function useUpdateAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (avatar: AvatarConfig) => put<Me>('/me/avatar', avatar),
    onSuccess: (me) => {
      setMe(qc)(me);
      qc.invalidateQueries({ queryKey: qk.quests });
    },
  });
}

export function useUpdateInterests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (interest_ids: number[]) => put<Me>('/me/interests', { interest_ids }),
    onSuccess: (me) => {
      setMe(qc)(me);
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

export function useUpdatePrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Privacy>) => patch<Privacy>('/me/privacy', body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: qk.me });
      const prev = qc.getQueryData<Me>(qk.me);
      if (prev) {
        qc.setQueryData<Me>(qk.me, {
          ...prev,
          privacy: { ...prev.privacy, ...body, notification_prefs: { ...prev.privacy.notification_prefs, ...(body.notification_prefs ?? {}) } },
        });
      }
      return { prev };
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(qk.me, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

// ---------- Home / discovery ----------
export const useHome = () => useQuery({ queryKey: qk.home, queryFn: () => get<Home>('/home'), staleTime: 15_000 });

export const useSearch = (q: string) =>
  useQuery({ queryKey: qk.search(q), queryFn: () => get<SearchResults>('/search', { q }), enabled: q.trim().length >= 1, staleTime: 30_000 });

export const useProfile = (id: string) => useQuery({ queryKey: qk.profile(id), queryFn: () => get<PublicProfile>(`/users/${id}`), enabled: !!id });

// ---------- Friends ----------
export const useFriends = (q?: string) => useQuery({ queryKey: qk.friends(q), queryFn: () => get<Friend[]>('/friends', { q }) });
export const useFriendRequests = () => useQuery({ queryKey: qk.requests, queryFn: () => get<FriendRequest[]>('/friends/requests') });
export const useSuggestions = () => useQuery({ queryKey: qk.suggestions, queryFn: () => get<UserSummary[]>('/friends/suggestions'), staleTime: 60_000 });
export const useBlocked = () => useQuery({ queryKey: qk.blocks, queryFn: () => get<Blocked[]>('/blocks') });

function invalidateSocial(qc: QueryClient, userId?: string) {
  qc.invalidateQueries({ queryKey: qk.friendsAll });
  qc.invalidateQueries({ queryKey: qk.requests });
  qc.invalidateQueries({ queryKey: qk.suggestions });
  qc.invalidateQueries({ queryKey: qk.home });
  qc.invalidateQueries({ queryKey: qk.conversations });
  if (userId) qc.invalidateQueries({ queryKey: qk.profile(userId) });
}

export function useSendFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { userId: string; source?: string }) =>
      post<{ status: string; request_id: string }>('/friends/requests', { user_id: args.userId, source: args.source ?? 'profile' }),
    onSuccess: (_d, args) => invalidateSocial(qc, args.userId),
  });
}

export function useRespondRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { requestId: string; action: 'accept' | 'decline' | 'cancel'; userId?: string }) =>
      post(`/friends/requests/${args.requestId}/${args.action}`),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: qk.requests });
      const prev = qc.getQueryData<FriendRequest[]>(qk.requests);
      qc.setQueryData<FriendRequest[]>(qk.requests, (list) => list?.filter((r) => r.id !== args.requestId));
      return { prev };
    },
    onError: (_e, _a, ctx) => ctx?.prev && qc.setQueryData(qk.requests, ctx.prev),
    onSettled: (_d, _e, args) => invalidateSocial(qc, args.userId),
  });
}

export function useRemoveFriend() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (userId: string) => del(`/friends/${userId}`), onSuccess: (_d, userId) => invalidateSocial(qc, userId) });
}

export function useBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { userId: string; block: boolean }) => (args.block ? post(`/blocks/${args.userId}`) : del(`/blocks/${args.userId}`)),
    onSuccess: (_d, args) => {
      invalidateSocial(qc, args.userId);
      qc.invalidateQueries({ queryKey: qk.blocks });
      qc.invalidateQueries({ queryKey: qk.roomsAll });
      qc.invalidateQueries({ queryKey: qk.notifications });
    },
  });
}

export function useGiveKudos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { userId: string; tag: string }) => post('/kudos', { user_id: args.userId, tag: args.tag }),
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: qk.profile(args.userId) });
      qc.invalidateQueries({ queryKey: qk.quests });
    },
  });
}

// ---------- Messaging ----------
export const useConversations = () => useQuery({ queryKey: qk.conversations, queryFn: () => get<Conversation[]>('/conversations') });
export const useConversation = (id: string) => useQuery({ queryKey: qk.conversation(id), queryFn: () => get<Conversation>(`/conversations/${id}`), enabled: !!id });

export function useStartConversation() {
  return useMutation({ mutationFn: (userId: string) => post<Conversation>('/conversations', { user_id: userId }) });
}

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: qk.messages(conversationId),
    queryFn: ({ pageParam }) =>
      get<Page<LocalMessage>>(`/conversations/${conversationId}/messages`, { before: pageParam ?? undefined, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!conversationId,
  });
}

export const sendMessageRequest = (conversationId: string, content: string, clientId: string) =>
  post<Message>(`/conversations/${conversationId}/messages`, { content, client_id: clientId });

export const markConversationRead = (conversationId: string) => post(`/conversations/${conversationId}/read`);

export function useDeleteMessage() {
  return useMutation({ mutationFn: (messageId: string) => del(`/conversations/messages/${messageId}`) });
}

// ---------- Rooms ----------
export type RoomFilters = { kind?: 'hangout' | 'study'; format?: 'text' | 'voice'; interest_id?: number; status?: 'live' | 'scheduled'; community_id?: string; q?: string };

export const useRooms = (filters: RoomFilters = {}) =>
  useQuery({ queryKey: qk.rooms(filters), queryFn: () => get<Room[]>('/rooms', filters as Record<string, string>), staleTime: 10_000 });

export const useRoom = (id: string, enabled = true) =>
  useQuery({ queryKey: qk.room(id), queryFn: () => get<RoomDetail>(`/rooms/${id}`), enabled: !!id && enabled, refetchInterval: 20_000 });

export const useRoomChat = (id: string, enabled = true) =>
  useQuery({ queryKey: qk.roomChat(id), queryFn: () => get<RoomMessage[]>(`/rooms/${id}/messages`), enabled: !!id && enabled });

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RoomInput) => post<RoomDetail>('/rooms', body),
    onSuccess: (room) => {
      qc.setQueryData(qk.room(room.id), room);
      qc.invalidateQueries({ queryKey: qk.roomsAll });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

export const startCallRequest = (userId: string) => post<RoomDetail>('/rooms/calls', { user_id: userId });
export const joinRoomRequest = (id: string) => post<RoomDetail>(`/rooms/${id}/join`);
export const leaveRoomRequest = (id: string) => post(`/rooms/${id}/leave`);
export const roomMediaToken = (id: string) => post<MediaToken>(`/rooms/${id}/media-token`);

export function useRoomAction(roomId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: qk.room(roomId) });
  return {
    moderate: useMutation({ mutationFn: (args: { userId: string; action: ModerateAction }) => post(`/rooms/${roomId}/moderate`, { user_id: args.userId, action: args.action }), onSuccess: refresh }),
    hand: useMutation({ mutationFn: (raised: boolean) => post(`/rooms/${roomId}/hand`, {}, { raised }), onSuccess: refresh }),
    react: useMutation({ mutationFn: (reaction: string) => post(`/rooms/${roomId}/reactions`, { reaction }) }),
    chat: useMutation({ mutationFn: (content: string) => post<RoomMessage>(`/rooms/${roomId}/messages`, { content }) }),
    invite: useMutation({ mutationFn: (userId: string) => post(`/rooms/${roomId}/invite`, { user_id: userId }) }),
    timer: useMutation({
      mutationFn: (args: { action: 'start' | 'skip' | 'stop'; focus_minutes?: number; break_minutes?: number }) => post<TimerState | null>(`/rooms/${roomId}/timer`, args),
      onSuccess: refresh,
    }),
    update: useMutation({ mutationFn: (body: { title?: string; description?: string; open_mic?: boolean; scene?: string }) => patch<RoomDetail>(`/rooms/${roomId}`, body), onSuccess: refresh }),
    end: useMutation({
      mutationFn: () => post(`/rooms/${roomId}/end`),
      onSuccess: () => {
        refresh();
        qc.invalidateQueries({ queryKey: qk.roomsAll });
        qc.invalidateQueries({ queryKey: qk.home });
      },
    }),
  };
}

// ---------- Communities ----------
export const useCommunities = (filters: { mine?: boolean; interest_id?: number; q?: string } = {}) =>
  useQuery({ queryKey: qk.communities(filters), queryFn: () => get<Community[]>('/communities', filters as Record<string, string>) });
export const useRecommendedCommunities = () => useQuery({ queryKey: qk.communities({ recommended: true }), queryFn: () => get<Community[]>('/communities/recommended') });
export const useCommunity = (id: string) => useQuery({ queryKey: qk.community(id), queryFn: () => get<Community>(`/communities/${id}`), enabled: !!id });
export const useCommunityPosts = (id: string, enabled = true) =>
  useQuery({ queryKey: qk.communityPosts(id), queryFn: () => get<CommunityPost[]>(`/communities/${id}/posts`), enabled: !!id && enabled });
export const useCommunityMembers = (id: string, status: 'active' | 'pending' = 'active', enabled = true) =>
  useQuery({ queryKey: qk.communityMembers(id, status), queryFn: () => get<CommunityMember[]>(`/communities/${id}/members`, { status }), enabled: !!id && enabled });

export function useCommunityActions(id: string) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.community(id) });
    qc.invalidateQueries({ queryKey: qk.communitiesAll });
    qc.invalidateQueries({ queryKey: qk.home });
  };
  return {
    join: useMutation({ mutationFn: () => post<{ status: string }>(`/communities/${id}/join`), onSuccess: refresh }),
    leave: useMutation({ mutationFn: () => post(`/communities/${id}/leave`), onSuccess: refresh }),
    post: useMutation({
      mutationFn: (content: string) => post<CommunityPost>(`/communities/${id}/posts`, { content }),
      onSuccess: () => qc.invalidateQueries({ queryKey: qk.communityPosts(id) }),
    }),
    removePost: useMutation({ mutationFn: (postId: string) => del(`/communities/${id}/posts/${postId}`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.communityPosts(id) }) }),
    manage: useMutation({
      mutationFn: (args: { userId: string; action: 'approve' | 'remove' | 'ban' | 'make_moderator' | 'make_member' }) => post(`/communities/${id}/members/${args.userId}`, {}, { action: args.action }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['community-members', id] }),
    }),
  };
}

export function useCreateCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description: string; interest_id?: number | null; visibility: 'public' | 'private'; rules: string[] }) => post<Community>('/communities', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.communitiesAll }),
  });
}

// ---------- Games ----------
export const useGame = (id: string) => useQuery({ queryKey: qk.game(id), queryFn: () => get<GameView>(`/games/${id}`), enabled: !!id });
export const useMyGames = () => useQuery({ queryKey: qk.myGames, queryFn: () => get<GameView[]>('/games/mine') });
export const useRoomGames = (roomId: string, enabled = true) =>
  useQuery({ queryKey: qk.roomGames(roomId), queryFn: () => get<GameView[]>(`/games/room/${roomId}`), enabled: !!roomId && enabled });

export function useGameActions(id: string) {
  const qc = useQueryClient();
  // Never replace a newer view (e.g. one fetched after a realtime event) with an older response.
  const set = (g: GameView) => qc.setQueryData<GameView>(qk.game(id), (old) => (old && old.version > g.version ? old : g));
  return {
    join: useMutation({ mutationFn: () => post<GameView>(`/games/${id}/join`), onSuccess: set }),
    leave: useMutation({ mutationFn: () => post(`/games/${id}/leave`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.myGames }) }),
    start: useMutation({ mutationFn: () => post<GameView>(`/games/${id}/start`), onSuccess: set }),
    /** Send one game action; `version` must be the version the player saw (409 `stale_version` otherwise). */
    act: useMutation({
      mutationFn: (body: { action: { type: string; [key: string]: unknown }; version: number }) => post<GameView>(`/games/${id}/action`, body),
      onSuccess: set,
    }),
  };
}

export function useCreateGame() {
  return useMutation({
    mutationFn: (body: { game_type: GameView['game_type']; room_id?: string; options?: Record<string, unknown> }) => post<GameView>('/games', body),
  });
}

export function useJoinByCode() {
  return useMutation({ mutationFn: (code: string) => post<GameView>('/games/join-by-code', {}, { code }) });
}

// ---------- Engagement ----------
export const useDaily = () => useQuery({ queryKey: qk.daily, queryFn: () => get<DailyQuestion>('/daily') });
export function useAnswerDaily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (choice: number) => post<{ daily: DailyQuestion; reward: Reward | null }>('/daily', { choice }),
    onSuccess: (res) => {
      qc.setQueryData(qk.daily, res.daily);
      qc.invalidateQueries({ queryKey: qk.home });
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.quests });
    },
  });
}

export const useQuests = () => useQuery({ queryKey: qk.quests, queryFn: () => get<Quest[]>('/quests') });
export function useClaimQuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => post<Reward>(`/quests/${key}/claim`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.quests });
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

export const useShop = () => useQuery({ queryKey: qk.shop, queryFn: () => get<ShopItem[]>('/shop') });
export function useBuyItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => post<{ gems: number }>(`/shop/${key}/buy`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shop });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export const useIcebreaker = () =>
  useQuery({ queryKey: qk.icebreaker, queryFn: () => get<{ session: IcebreakerSession | null }>('/icebreakers/current').then((r) => r.session) });

export const icebreakerApi = {
  join: (interest_id?: number | null) => post<{ status: 'waiting' | 'matched'; session?: IcebreakerSession }>('/icebreakers/queue', { interest_id: interest_id ?? null }),
  leave: () => del('/icebreakers/queue'),
  get: (id: string) => get<IcebreakerSession>(`/icebreakers/${id}`),
  answers: (id: string, answers: string[]) => post<IcebreakerSession>(`/icebreakers/${id}/answers`, { answers }),
  decide: (id: string, decision: 'connect' | 'pass') => post<IcebreakerSession>(`/icebreakers/${id}/decision`, { decision }),
  end: (id: string) => post(`/icebreakers/${id}/end`),
};

// ---------- Notifications ----------
export const useNotifications = () => useQuery({ queryKey: qk.notifications, queryFn: () => get<Notification[]>('/notifications') });
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post('/notifications/read'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

// ---------- Safety ----------
export function useReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { target_type: ReportTarget; target_id: string; reason: string; description?: string }) => post<Report>('/reports', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.myReports }),
  });
}
export const useMyReports = () => useQuery({ queryKey: qk.myReports, queryFn: () => get<Report[]>('/reports/mine') });

// ---------- Moderation (server enforces staff role) ----------
export const useModReports = (status: string) =>
  useQuery({ queryKey: qk.modReports(status), queryFn: () => get<Page<Report>>('/moderation/reports', { status }) });
export const useModReport = (id: string) => useQuery({ queryKey: qk.modReport(id), queryFn: () => get<ReportDetail>(`/moderation/reports/${id}`), enabled: !!id });
export const useModUsers = (q: string) =>
  useQuery({ queryKey: qk.modUsers(q), queryFn: () => get<AdminUser[]>('/moderation/users', { q }), enabled: q.trim().length >= 2 });
export const useAudit = () => useQuery({ queryKey: qk.audit, queryFn: () => get<AuditEntry[]>('/moderation/audit') });

export function useModDecision(reportId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: string; note?: string; suspend_days?: number }) => post<ReportDetail>(`/moderation/reports/${reportId}/decision`, body),
    onSuccess: (detail) => {
      qc.setQueryData(qk.modReport(reportId), detail);
      qc.invalidateQueries({ queryKey: ['mod-reports'] });
      qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

export function useModUserAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { userId: string; action: string; reason: string; suspend_days?: number; role?: string }) =>
      post(`/moderation/users/${args.userId}`, { action: args.action, reason: args.reason, suspend_days: args.suspend_days, role: args.role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mod-users'] });
      qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

// ---------- Account ----------
export const accountApi = {
  exportData: () => get<Record<string, unknown>>('/me/export'),
  deleteAccount: (password: string) => post('/me/delete', { password, confirm: 'DELETE' }),
  changePassword: (current_password: string, new_password: string) => post('/auth/change-password', { current_password, new_password }),
  logoutAll: () => post('/auth/logout-all'),
  registerPushToken: (token: string, platform: 'android' | 'ios') => post('/me/push-tokens', { token, platform }),
  removePushToken: (token: string, platform: 'android' | 'ios') => del('/me/push-tokens', { token, platform }),
};
