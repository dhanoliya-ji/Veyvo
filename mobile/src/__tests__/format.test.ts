import { describe, expect, it } from '@jest/globals';
import { countdown, plural, clientId, timeAgo } from '@/lib/format';
import { shade } from '@/lib/color';

describe('format helpers', () => {
  it('formats countdowns', () => {
    expect(countdown(65_000)).toBe('1:05');
    expect(countdown(-5)).toBe('0:00');
  });

  it('pluralises', () => {
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(3, 'member')).toBe('3 members');
  });

  it('creates unique client ids that match the server pattern', () => {
    const ids = new Set(Array.from({ length: 500 }, () => clientId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('describes recent times', () => {
    expect(timeAgo(new Date().toISOString())).toBe('now');
    expect(timeAgo(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe('2h');
  });
});

describe('colour shading', () => {
  it('lightens and darkens', () => {
    expect(shade('#000000', 0.5)).toBe('#808080');
    expect(shade('#ffffff', -0.5)).toBe('#808080');
    expect(shade('not-a-colour', 0.2)).toBe('not-a-colour');
  });
});
