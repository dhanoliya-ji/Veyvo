import { describe, expect, it } from '@jest/globals';

import { buildReport, scrubText, setCrashRoute, stripPaths } from '@/lib/crash';

describe('crash report helpers', () => {
  it('cuts file paths and bundle URLs down to file names', () => {
    const stack = [
      'at RoomScreen (http://192.168.1.20:8081/index.bundle?platform=android&dev=true&minify=false:1234:56)',
      'at anonymous (address at /data/app/~~x==/app.veyvo-1/base.apk!/assets/index.android.bundle:1:9876)',
      'at render (C:\\Users\\sam\\Veyvo\\mobile\\src\\app\\room\\[id].tsx:10:2)',
    ].join('\n');
    const out = stripPaths(stack);
    expect(out).toContain('(index.bundle:1234:56)');
    expect(out).toContain('index.android.bundle:1:9876');
    expect(out).toContain('[id].tsx:10:2');
    expect(out).not.toMatch(/192\.168|platform=|data\/app|Users|sam/);
  });

  it('removes emails, tokens, ids and long numbers', () => {
    const out = scrubText('failed for sam@example.com with Bearer abc.def eyJhbG.eyJzdWI.sig user 6f1c2a9e-4b7d-4c1e-9a3f-0d2b8e7c5a11 phone 5551234567');
    expect(out).not.toMatch(/sam@example|abc\.def|eyJhbG|6f1c2a9e|5551234567/);
  });

  it('builds a small, anonymous report', () => {
    setCrashRoute('room/[id]');
    const report = buildReport(new TypeError('x'.repeat(900)), { isFatal: true, source: 'boundary' });
    expect(report.message.length).toBeLessThanOrEqual(500);
    expect(report.message.startsWith('TypeError: ')).toBe(true);
    expect((report.stack ?? '').length).toBeLessThanOrEqual(4000);
    expect(report).toMatchObject({ is_fatal: true, source: 'boundary', route: 'room/[id]', install_id: null });
    expect(Object.keys(report).sort()).toEqual(
      ['app_version', 'install_id', 'is_fatal', 'message', 'os_version', 'platform', 'route', 'source', 'stack', 'timestamp'].sort(),
    );
  });

  it('handles things that are not errors', () => {
    expect(buildReport('plain string').message).toBe('plain string');
    expect(buildReport({ code: 1 }).message).toMatch(/Non-error thrown/);
  });
});
