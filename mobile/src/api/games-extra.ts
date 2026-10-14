import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { icebreakerApi, qk } from '@/api/hooks';
import type { GameView } from '@/api/types';
import { ApiError, get } from '@/lib/api';

/** True when `err` is an ApiError with the given HTTP status and (optionally) one of the given codes. */
export function isApiError(err: unknown, status?: number, ...codes: string[]): err is ApiError {
  if (!(err instanceof ApiError)) return false;
  if (status !== undefined && err.status !== status) return false;
  return codes.length === 0 || codes.includes(err.code);
}

/** Re-renders every `intervalMs` while `enabled`, returning Date.now(). */
export function useNow(intervalMs = 250, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

/**
 * Difference between the server clock and this device (ms to add to Date.now() to get server time).
 * `receivedAt` should be when the response arrived (TanStack's dataUpdatedAt).
 */
export function clockOffset(serverTimeIso: string | null | undefined, receivedAt: number): number {
  if (!serverTimeIso || !receivedAt) return 0;
  const server = Date.parse(serverTimeIso);
  return Number.isFinite(server) ? server - receivedAt : 0;
}

/** Milliseconds left until `endsAtIso` on the server clock. */
export function msLeft(endsAtIso: string | null | undefined, offset: number, now = Date.now()): number {
  if (!endsAtIso) return 0;
  return Math.max(0, Date.parse(endsAtIso) - (now + offset));
}

/** Milliseconds until the next UTC midnight (when the daily question and quests roll over). */
export function msUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return next - now;
}

export function hoursMinutes(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/** Mirrors backend KUDOS_TAGS (also served in /config). */
export const KUDOS_TAGS: { key: string; label: string; emoji: string }[] = [
  { key: 'funny', label: 'Funny', emoji: '😂' },
  { key: 'kind', label: 'Kind', emoji: '💛' },
  { key: 'great_listener', label: 'Great listener', emoji: '👂' },
  { key: 'smart', label: 'Big brain', emoji: '🧠' },
  { key: 'creative', label: 'Creative', emoji: '🎨' },
  { key: 'great_host', label: 'Great host', emoji: '🏕️' },
];

export type GameType = GameView['game_type'];
export type GameAction = GameView['legal_actions'][number];

/** Display info for each game (the server's /games/catalog is the source of truth for player counts). */
export const GAME_META: Record<GameType, { name: string; tagline: string; minPlayers: number; maxPlayers: number; rules: string[] }> = {
  chess: {
    name: 'Chess',
    tagline: 'The classic strategy game',
    minPlayers: 2,
    maxPlayers: 2,
    rules: ['Full chess rules: castling, en passant and promotion.', 'Checkmate your opponent to win.', 'You can offer a draw or resign at any time.'],
  },
  ludo: {
    name: 'Ludo',
    tagline: 'Race your tokens home',
    minPlayers: 2,
    maxPlayers: 4,
    rules: ['Roll a 6 to bring a token out of base.', 'Land on a rival token to send it back; stars and start squares are safe.', 'A 6 earns another roll. Get all four tokens home first.'],
  },
  crazy_eights: {
    name: 'Crazy Eights',
    tagline: 'Fast card game, eights are wild',
    minPlayers: 2,
    maxPlayers: 6,
    rules: ['Match the top card by suit or by rank.', 'Eights are wild: play one and pick the next suit.', 'No match? Draw a card. First to empty their hand wins.'],
  },
  four_in_a_row: {
    name: 'Four in a Row',
    tagline: 'Line up four to win',
    minPlayers: 2,
    maxPlayers: 2,
    rules: ['Take turns dropping discs into the grid.', 'Line up four across, down or diagonally to win.', 'A full grid with no line is a draw.'],
  },
  truth_or_dare: {
    name: 'Truth or Dare',
    tagline: 'Safe, fun prompts for friends',
    minPlayers: 2,
    maxPlayers: 10,
    rules: ['On your turn pick Truth or Dare and get a prompt.', 'Finish it for a point, or use one of your skips.', 'Most completed prompts after the last round wins.'],
  },
  werewolf: {
    name: 'Werewolf',
    tagline: "Find the wolves before it's too late",
    minPlayers: 5,
    maxPlayers: 12,
    rules: ['Everyone gets a secret role. Keep it to yourself.', 'At night the wolves hunt, the seer inspects and the doctor protects.', 'By day, talk it out and vote someone out. Best played on a call.'],
  },
};

export const GAME_TYPES = Object.keys(GAME_META) as GameType[];
/** Games that work well with a whole hangout. */
export const ROOM_GAME_TYPES: GameType[] = ['truth_or_dare', 'werewolf', 'crazy_eights', 'ludo'];

export const GAME_REWARDS = { play: 10, win: 15 } as const;

export type CatalogEntry = { key: GameType; name: string; tagline: string; min_players: number; max_players: number };

export const useGameCatalog = () => useQuery({ queryKey: ['games-catalog'], queryFn: () => get<CatalogEntry[]>('/games/catalog'), staleTime: 10 * 60 * 1000 });

export function playersLabel(min: number, max: number): string {
  return min === max ? `${min} players` : `${min}–${max} players`;
}

/** Legal actions of one type for this viewer. */
export function actionsOf<T extends GameAction = GameAction>(game: GameView, type: string): T[] {
  return game.legal_actions.filter((a) => a.type === type) as T[];
}

export const canDo = (game: GameView, type: string) => game.legal_actions.some((a) => a.type === type);

// ----- Board views (mirror backend/app/games/*.py `view()`) -----

type BaseBoard = { game: GameType; players: string[]; turn: string | null; status: 'active' | 'finished'; move_no: number; last_event: Record<string, any> | null };

export type ChessBoardView = BaseBoard & {
  colors: Record<string, 'w' | 'b'>;
  you: 'w' | 'b' | null;
  fen: string;
  /** board[0] is rank 8, board[0][0] is a8; '' = empty, uppercase = white. */
  board: string[][];
  side_to_move: 'w' | 'b';
  last_move: { from: string; to: string; piece: string; captured: string | null; check: boolean; special: string | null } | null;
  check: boolean;
  captured: { w: string[]; b: string[] };
  history: string[];
  draw_offer: string | null;
  legal_targets: Record<string, string[]>;
  result: { winner: string | null; reason: string } | null;
};

export type LudoColour = 'red' | 'green' | 'yellow' | 'blue';
export type LudoToken = { token: number; progress: number; where: 'base' | 'track' | 'home_stretch' | 'finished'; track_index: number | null; home_index: number | null };
export type LudoBoardView = BaseBoard & {
  colors: Record<string, LudoColour>;
  you: LudoColour | null;
  phase: 'roll' | 'move';
  last_roll: number | null;
  movable: number[];
  tokens: Record<string, LudoToken[]>;
  finished: string[];
  left: string[];
  safe_squares: number[];
  start_index: Partial<Record<LudoColour, number>>;
  track_length: number;
  home_stretch_length: number;
};

export type Suit = 'S' | 'H' | 'D' | 'C';
export type CrazyEightsBoardView = BaseBoard & {
  rules: Record<string, boolean>;
  hand: string[] | null;
  hand_counts: Record<string, number>;
  top_card: string;
  current_suit: Suit;
  direction: 1 | -1;
  deck_count: number;
  pending_draw: number;
  has_drawn: boolean | null;
  playable: string[];
  left: string[];
  winner: string | null;
  final_hands: Record<string, string[]> | null;
};

export type FourInARowBoardView = BaseBoard & {
  discs: Record<string, 1 | 2>;
  you: 1 | 2 | null;
  /** board[row][col], row 0 at the bottom; 0 empty, 1 or 2. */
  board: number[][];
  winner: string | null;
  winning_cells: [number, number][] | null;
  reason: 'four_in_a_row' | 'board_full' | 'abandoned' | null;
  playable_columns: number[];
};

export type TruthOrDareBoardView = BaseBoard & {
  phase: 'choose' | 'perform';
  prompt: { id: string; kind: 'truth' | 'dare'; pack: string; text: string } | null;
  packs: string[];
  round: number;
  rounds: number;
  scores: Record<string, number>;
  skips_left: Record<string, number>;
  left: string[];
};

export type WerewolfRole = 'werewolf' | 'seer' | 'doctor' | 'villager';
export type WerewolfBoardView = BaseBoard & {
  host: string;
  phase: 'night' | 'day' | 'discussion' | 'vote';
  round: number;
  alive: string[];
  dead: string[];
  deaths: { round: number; player_id: string; cause: 'wolves' | 'vote' | 'left' }[];
  left: string[];
  required_actors: string[];
  last_night: { round: number; killed: string | null } | null;
  last_vote: { round: number; eliminated: string | null; votes: Record<string, string | null> } | null;
  votes: Record<string, string | null>;
  your_role: WerewolfRole | null;
  winner: 'village' | 'wolves' | null;
  role_counts: Record<WerewolfRole, number>;
  roles?: Record<string, WerewolfRole>;
  seer_results?: { round: number; target: string; is_werewolf: boolean }[];
  wolves?: string[];
  wolf_votes?: Record<string, string>;
  protected_tonight?: string | null;
};

const CHESS_REASONS: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate: a draw',
  insufficient_material: 'Draw by insufficient material',
  threefold_repetition: 'Draw by threefold repetition',
  fifty_move_rule: 'Draw by the 50-move rule',
  resignation: 'Won by resignation',
  agreement: 'Draw agreed',
  abandoned: 'Opponent left the game',
};

/** A short line explaining how the game ended (read from the server's board, never computed). */
export function endReason(game: GameView): string | null {
  const b = game.board as Record<string, any> | null;
  if (!b) return null;
  switch (game.game_type) {
    case 'chess':
      return b.result ? (CHESS_REASONS[b.result.reason] ?? null) : null;
    case 'four_in_a_row':
      return b.reason === 'four_in_a_row' ? 'Four in a row' : b.reason === 'board_full' ? 'The grid filled up: a draw' : b.reason === 'abandoned' ? 'Opponent left the game' : null;
    case 'werewolf':
      return b.winner === 'village' ? 'The village found every wolf' : b.winner === 'wolves' ? 'The wolves took over the village' : null;
    case 'crazy_eights':
      return 'Others ranked by points left in hand (lower is better)';
    case 'ludo':
      return 'Ranked by finishing order';
    case 'truth_or_dare':
      return 'Ranked by prompts completed';
    default:
      return null;
  }
}

/** How to read a result's `score` for each game. */
export function scoreLabel(game: GameView, score: number, role?: string): string {
  switch (game.game_type) {
    case 'chess':
    case 'four_in_a_row':
      return score === 2 ? 'Win' : score === 1 ? 'Draw' : 'Loss';
    case 'ludo':
      return `${score}/4 home`;
    case 'crazy_eights':
      return `${score} pts`;
    case 'truth_or_dare':
      return `${score} done`;
    case 'werewolf':
      return `${role ? `${role[0].toUpperCase()}${role.slice(1)} · ` : ''}${score ? 'Won' : 'Lost'}`;
    default:
      return String(score);
  }
}

/**
 * A specific icebreaker session by id. `/icebreakers/current` only returns active sessions, so this keeps
 * the result (connected / ended) visible after it finishes. Keyed under qk.icebreaker so realtime
 * invalidations of the icebreaker also refresh it.
 */
export const useIcebreakerSession = (id: string | null) =>
  useQuery({
    queryKey: [...qk.icebreaker, 'session', id ?? ''],
    queryFn: () => icebreakerApi.get(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'active' ? 8000 : false),
  });
