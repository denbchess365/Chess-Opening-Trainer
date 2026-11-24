import { afterEach, describe, expect, it, vi } from 'vitest';
import * as gh from '../src/net/github';

const TOKEN = 'github_pat_TESTTOKEN1234';
const calls: { url: string; init: RequestInit }[] = [];

function mockFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  });
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe('GitHub client security', () => {
  it('only ever sends the token to api.github.com', async () => {
    mockFetch((url) => (url.endsWith('/gists?per_page=100') ? json([]) : json({ id: 'abc123def', html_url: 'https://gist.github.com/x', files: {} }, 201)));
    await gh.testConnection(TOKEN).catch(() => {});
    await gh.createGist(TOKEN, '{"a":1}', 's');
    await gh.findBackupGist(TOKEN);
    expect(calls.length).toBe(3);
    for (const c of calls) {
      expect(new URL(c.url).origin).toBe('https://api.github.com');
      expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.init.credentials).toBe('omit');
    }
  });

  it.each(['//evil.example/x', '/gists/@evil.example', 'https://evil.example/', '/gists/../../x y'])('refuses path %s', (p) => {
    expect(() => gh.apiUrl(p)).toThrow();
  });

  it('creates the Gist as secret (public: false)', async () => {
    mockFetch(() => json({ id: 'abc', html_url: '', files: {} }, 201));
    await gh.createGist(TOKEN, '{}', 's');
    expect(JSON.parse(calls[0].init.body as string).public).toBe(false);
  });
});

describe('GitHub error mapping', () => {
  it.each([
    [401, {}, 'auth'],
    [403, {}, 'permission'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' }, 'rate'],
    [429, { 'retry-after': '60' }, 'rate'],
    [404, {}, 'notfound'],
    [500, {}, 'other'],
  ])('HTTP %s → %s', async (status, headers, kind) => {
    mockFetch(() => json({ message: 'x' }, status as number, headers as Record<string, string>));
    await expect(gh.testConnection(TOKEN)).rejects.toMatchObject({ kind });
  });

  it('network failure → offline', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(gh.testConnection(TOKEN)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('does not call the network without a token', async () => {
    mockFetch(() => json([]));
    await expect(gh.testConnection('')).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(0);
  });
});

describe('large backups', () => {
  it('splits into parts and joins back', () => {
    const text = 'x'.repeat(25) + 'é' + 'y'.repeat(20);
    const files = gh.splitIntoFiles(text, 10);
    expect(Object.keys(files)[0]).toBe('repertoire-backup.json');
    expect(Object.keys(files)).toContain('repertoire-backup.part5.json');
    const asGist = Object.fromEntries(Object.entries(files).reverse().map(([k, v]) => [k, { filename: k, content: v }]));
    expect(gh.joinFiles(asGist)).toBe(text);
  });

  it('keeps a small backup in one file', () => {
    expect(Object.keys(gh.splitIntoFiles('{}'))).toEqual(['repertoire-backup.json']);
  });

  it('refuses truncated files instead of restoring partial data', () => {
    expect(() => gh.joinFiles({ 'repertoire-backup.json': { filename: 'x', content: '{', truncated: true } })).toThrow(/too large/);
  });

  it('removes stale part files when a backup shrinks', async () => {
    mockFetch((_url, init) =>
      init.method === 'PATCH'
        ? json({ id: 'abcdef12', html_url: '', files: {} })
        : json({ id: 'abcdef12', files: { 'repertoire-backup.json': {}, 'repertoire-backup.part2.json': {}, 'notes.txt': {} } }),
    );
    await gh.updateGist(TOKEN, 'abcdef12', '{}', 's');
    const body = JSON.parse(calls[1].init.body as string);
    expect(body.files['repertoire-backup.part2.json']).toBeNull();
    expect('notes.txt' in body.files).toBe(false);
  });
});
