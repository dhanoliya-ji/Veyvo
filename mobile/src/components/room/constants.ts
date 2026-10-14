import type { ComponentType } from 'react';
import {
  BookOpen,
  Brain,
  Clapperboard,
  Cpu,
  Dumbbell,
  Flame,
  Gamepad2,
  Goal,
  Hand,
  Heart,
  Languages,
  Laugh,
  MessagesSquare,
  Moon,
  Music,
  Palette,
  PartyPopper,
  Sparkles,
  type LucideProps,
} from 'lucide-react-native';

import type { Interest } from '@/api/types';

export type RoomCategory = { slug: string; label: string; icon: ComponentType<LucideProps> };

/** The hangout categories, mapped to interests by slug. */
export const ROOM_CATEGORIES: RoomCategory[] = [
  { slug: 'just-chatting', label: 'Just chatting', icon: MessagesSquare },
  { slug: 'gaming', label: 'Gaming', icon: Gamepad2 },
  { slug: 'study', label: 'Study', icon: Brain },
  { slug: 'music', label: 'Music', icon: Music },
  { slug: 'movies', label: 'Movies', icon: Clapperboard },
  { slug: 'books', label: 'Books', icon: BookOpen },
  { slug: 'football', label: 'Football', icon: Goal },
  { slug: 'language-exchange', label: 'Language exchange', icon: Languages },
  { slug: 'technology', label: 'Technology', icon: Cpu },
  { slug: 'art', label: 'Art', icon: Palette },
  { slug: 'fitness', label: 'Fitness', icon: Dumbbell },
  { slug: 'deep-talks', label: 'Deep talks', icon: Moon },
];

/** Categories that exist on this server, with their interest ids. */
export function resolveCategories(interests: Interest[] | undefined): (RoomCategory & { interestId: number })[] {
  if (!interests) return [];
  const bySlug = new Map(interests.map((i) => [i.slug, i.id]));
  return ROOM_CATEGORIES.flatMap((c) => {
    const id = bySlug.get(c.slug);
    return id === undefined ? [] : [{ ...c, interestId: id }];
  });
}

export type ReactionKey = 'wave' | 'laugh' | 'clap' | 'heart' | 'fire' | 'party';

/** Mirrors backend REACTIONS. Icons plus labels, never emoji, so they look the same everywhere. */
export const REACTIONS: { key: ReactionKey; label: string; icon: ComponentType<LucideProps> }[] = [
  { key: 'wave', label: 'Wave', icon: Hand },
  { key: 'laugh', label: 'Haha', icon: Laugh },
  { key: 'clap', label: 'Clap', icon: Sparkles },
  { key: 'heart', label: 'Love', icon: Heart },
  { key: 'fire', label: 'Fire', icon: Flame },
  { key: 'party', label: 'Party', icon: PartyPopper },
];

export const reactionLabel = (key: string) => REACTIONS.find((r) => r.key === key)?.label ?? key;

export const ROLE_LABEL: Record<string, string> = { host: 'Host', moderator: 'Mod', speaker: 'Speaker', listener: 'Listener' };
