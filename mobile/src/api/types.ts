// Types mirror backend/app/schemas. Keep them in sync when the API changes.

export type UUID = string;

export type AvatarConfig = {
  skin: string;
  hair: string;
  hairColor: string;
  eyes: string;
  brows: string;
  mouth: string;
  outfit: string;
  outfitColor: string;
  accessory: string;
  bg: string;
};

export type Vibe = 'down_to_chat' | 'studying' | 'listening' | 'gaming' | 'busy';

export type UserSummary = {
  id: UUID;
  username: string | null;
  display_name: string;
  avatar: Partial<AvatarConfig>;
  level: number;
  vibe: Vibe | null;
};

export type Page<T> = { items: T[]; next_cursor: string | null };

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  user_id: string;
  email_verified: boolean;
  onboarded: boolean;
  dev_code?: string | null;
};

export type Interest = { id: number; slug: string; name: string; category: string; icon: string };

export type Privacy = {
  profile_visibility: 'everyone' | 'friends';
  who_can_message: 'friends' | 'nobody';
  who_can_friend_request: 'everyone' | 'friends_of_friends' | 'nobody';
  who_can_invite: 'everyone' | 'friends' | 'nobody';
  show_online_status: 'friends' | 'nobody';
  discoverable: boolean;
  show_interests: boolean;
  allow_icebreakers: boolean;
  notification_previews: boolean;
  notification_prefs: Partial<Record<NotificationPref, boolean>>;
};

export type NotificationPref = 'friend_requests' | 'messages' | 'room_invites' | 'events' | 'games' | 'kudos';

export type Me = {
  id: UUID;
  email: string;
  email_verified: boolean;
  role: 'user' | 'moderator' | 'admin';
  status: string;
  username: string | null;
  display_name: string;
  bio: string;
  avatar: AvatarConfig;
  vibe: Vibe | null;
  interests: Interest[];
  privacy: Privacy;
  onboarded: boolean;
  plus_active?: boolean;
  xp: number;
  level: number;
  level_progress: number;
  gems: number;
  streak: { current: number; best: number; freezes: number; last_date: string | null; active_today: boolean };
  created_at: string;
};

export type Relationship = 'self' | 'friends' | 'request_sent' | 'request_received' | 'none' | 'blocked';

export type PublicProfile = UserSummary & {
  bio: string;
  interests: Interest[];
  shared_interest_ids: number[];
  relationship: Relationship;
  friend_request_id: UUID | null;
  friendship_level: number | null;
  friendship_progress: number | null;
  mutual_friends: number;
  kudos: Record<string, number>;
  online: boolean | null;
  can_message: boolean;
  can_friend_request: boolean;
  can_invite: boolean;
  limited: boolean;
};

export type Friend = UserSummary & { friendship_level: number; friendship_progress: number; online: boolean | null; since: string };

export type FriendRequest = { id: UUID; user: UserSummary; direction: 'incoming' | 'outgoing'; status: string; created_at: string };

export type Blocked = UserSummary & { blocked_at: string };

export type Message = { id: UUID; conversation_id: UUID; sender_id: UUID; client_id: string; content: string; created_at: string };

/** Client-side message with delivery state for optimistic sending. */
export type LocalMessage = Message & { pending?: boolean; failed?: boolean };

export type Conversation = {
  id: UUID;
  other_user: UserSummary;
  last_message: Message | null;
  last_message_at: string | null;
  unread_count: number;
  online: boolean | null;
  can_message: boolean;
  other_last_read_at: string | null;
};

export type TimerState = {
  phase: 'idle' | 'focus' | 'break';
  focus_minutes: number;
  break_minutes: number;
  phase_started_at: string | null;
  phase_ends_at: string | null;
  cycle: number;
};

export type Scene = 'cafe' | 'campfire' | 'library' | 'rooftop' | 'beach' | 'space';

export type Room = {
  id: UUID;
  title: string;
  description: string;
  kind: 'hangout' | 'study';
  format: 'text' | 'voice';
  visibility: 'public' | 'private';
  scene: Scene;
  interest_id: number | null;
  community_id: UUID | null;
  capacity: number;
  status: 'scheduled' | 'live' | 'ended';
  open_mic: boolean;
  host: UserSummary | null;
  participant_count: number;
  participants_preview: UserSummary[];
  friends_inside: number;
  scheduled_for: string | null;
  started_at: string | null;
  created_at: string;
  my_role: string | null;
  timer: TimerState | null;
};

export type Participant = UserSummary & { role: 'host' | 'moderator' | 'speaker' | 'listener'; hand_raised: boolean; muted_by_host: boolean; is_friend: boolean };

export type RoomDetail = Room & { participants: Participant[]; rules: string[]; can_speak: boolean; can_moderate: boolean; media_available: boolean };

export type RoomMessage = { id: UUID; room_id: UUID; sender: UserSummary; content: string; created_at: string };

export type RoomInput = {
  title: string;
  description?: string;
  kind: 'hangout' | 'study';
  format: 'text' | 'voice';
  visibility: 'public' | 'private';
  scene: Scene;
  interest_id?: number | null;
  community_id?: UUID | null;
  capacity: number;
  open_mic: boolean;
  scheduled_for?: string | null;
  focus_minutes?: number;
  break_minutes?: number;
};

export type ModerateAction = 'make_speaker' | 'make_listener' | 'make_moderator' | 'mute' | 'unmute' | 'remove' | 'ban' | 'lower_hand';

export type MediaToken = { url: string; token: string; can_publish: boolean; expires_in: number };

export type Community = {
  id: UUID;
  slug: string;
  name: string;
  description: string;
  interest_id: number | null;
  visibility: 'public' | 'private';
  rules: string[];
  member_count: number;
  membership: 'owner' | 'moderator' | 'member' | 'pending' | 'none';
  live_rooms: number;
  created_at: string;
};

export type CommunityPost = { id: UUID; community_id: UUID; author: UserSummary; content: string; created_at: string; author_rank?: string };
export type CommunityMember = UserSummary & { role: string; status: string; rank?: string; points?: number };

export type GamePlayer = UserSummary & { score: number; active: boolean; answered: boolean };

export type RoundView = {
  index: number;
  total: number;
  phase: 'countdown' | 'question' | 'reveal' | 'drawing' | 'round_end';
  phase_ends_at: string | null;
  question: string | null;
  options: string[] | null;
  category: string | null;
  my_answer: number | null;
  correct_index: number | null;
  answer_counts: number[] | null;
  drawer_id: UUID | null;
  word: string | null;
  word_hint: string | null;
  guessed_user_ids: UUID[];
  i_guessed: boolean;
  answered_count: number;
};

export type GameView = {
  id: UUID;
  code: string;
  game_type: 'trivia' | 'doodle';
  status: 'lobby' | 'active' | 'finished' | 'cancelled';
  host_id: UUID | null;
  room_id: UUID | null;
  players: GamePlayer[];
  round: RoundView | null;
  settings: Record<string, number>;
  version: number;
  server_time: string;
  created_at: string;
};

export type GuessResult = { correct: boolean; close: boolean; points: number };

export type Notification = {
  id: UUID;
  type: string;
  actor: UserSummary | null;
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, any>;
  count: number;
  read_at: string | null;
  created_at: string;
};

export type Quest = { key: string; title: string; target: number; progress: number; gems: number; xp: number; completed: boolean; claimed: boolean };
export type Reward = { gems: number; xp: number; new_balance: number; level: number; leveled_up: boolean };
export type ShopItem = { key: string; slot: 'hair' | 'outfit' | 'accessory' | 'scene'; value: string; name: string; price: number; owned: boolean; event_only?: boolean };

export type DailyQuestion = {
  day: string;
  key: string;
  question: string;
  options: string[];
  my_choice: number | null;
  results: number[] | null;
  total: number | null;
};

export type Home = {
  live_rooms: Room[];
  friends_rooms: Room[];
  upcoming: Room[];
  recommended_communities: Community[];
  my_communities: Community[];
  daily: DailyQuestion;
  quests: Quest[];
  friend_count: number;
  pending_requests: number;
  unread_notifications: number;
  unread_messages: number;
};

export type SearchResults = { users: UserSummary[]; rooms: Room[]; communities: Community[] };

export type AppConfig = {
  minimum_age: number;
  media_available: boolean;
  max_room_capacity: number;
  max_message_length: number;
  scenes: Scene[];
  vibes: Vibe[];
  reactions: string[];
  kudos_tags: Record<string, string>;
  report_reasons: Record<string, string>;
  purchases_available: boolean;
  ads_enabled: boolean;
};

export type IcebreakerSession = {
  id: UUID;
  status: 'active' | 'connected' | 'ended';
  partner: UserSummary;
  interest: { id: number; name: string } | null;
  questions: string[];
  my_answers: string[] | null;
  partner_answers: string[] | null;
  partner_answered: boolean;
  my_decision: 'connect' | 'pass' | null;
  partner_decided: boolean;
  expires_at: string;
};

export type ReportTarget = 'user' | 'room' | 'community' | 'message' | 'room_message' | 'community_post';
export type Report = { id: UUID; target_type: ReportTarget; target_id: string; reason: string; status: string; created_at: string };

export type AuditEntry = { id: UUID; actor: UserSummary | null; action: string; target_type: string; target_id: string; reason: string; created_at: string };

export type ReportDetail = Report & {
  description: string;
  evidence: Record<string, any>;
  reporter: UserSummary | null;
  target_user: UserSummary | null;
  target_user_status: string | null;
  reviewer_note: string;
  resolution: string | null;
  resolved_at: string | null;
  prior_reports_against_target: number;
  history: AuditEntry[];
};

export type AdminUser = UserSummary & { role: string; status: string; suspended_until: string | null; created_at: string; reports_against: number };
