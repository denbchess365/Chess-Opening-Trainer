/**
 * Minimal GitHub Gist client. This is the ONLY module that sends the token, and it
 * refuses to send it anywhere except https://api.github.com.
 */
export const GITHUB_API = 'https://api.github.com';
export const BACKUP_FILE = 'repertoire-backup.json';
/** The Gist API truncates file contents above ~1 MB, so large backups are split into parts. */
export const PART_SIZE = 700_000;

export type GistErrorKind = 'auth' | 'permission' | 'rate' | 'offline' | 'notfound' | 'toolarge' | 'other';

export class GistError extends Error {
  constructor(
    public kind: GistErrorKind,
    message: string,
    public resetAt?: number,
  ) {
    super(message);
    this.name = 'GistError';
  }
}

/** Builds a request URL and guarantees it points at api.github.com. */
export function apiUrl(path: string): string {
  if (!/^\/[A-Za-z0-9/_?=&.,%-]*$/.test(path) || path.startsWith('//')) throw new Error('Invalid GitHub API path');
  const url = new URL(GITHUB_API + path);
  if (url.origin !== GITHUB_API) throw new Error('Refusing to send the token outside api.github.com');
  return url.href;
}

async function gh<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!token) throw new GistError('auth', 'No GitHub token saved.');
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new GistError('offline', 'Couldn’t reach GitHub — you seem to be offline.');
  }
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 || undefined;
  const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
  if (res.status === 401) throw new GistError('auth', 'GitHub rejected the token — it may be expired or revoked. Create a new one.');
  if (res.status === 429 || (res.status === 403 && (remaining === '0' || retryAfter)))
    throw new GistError('rate', 'GitHub rate limit reached — try again later.', retryAfter ? Date.now() + retryAfter : reset);
  if (res.status === 403) throw new GistError('permission', 'The token doesn’t have the “Gists: read and write” permission.');
  if (res.status === 404) throw new GistError('notfound', 'The backup Gist wasn’t found (deleted, or the token can’t see it).');
  if (res.status === 422) throw new GistError('toolarge', 'GitHub refused the backup (too large or invalid).');
  throw new GistError('other', `GitHub error ${res.status}.`);
}

export interface GistFile {
  filename: string;
  content?: string;
  truncated?: boolean;
  size?: number;
}
interface Gist {
  id: string;
  html_url: string;
  description: string | null;
  public: boolean;
  updated_at: string;
  files: Record<string, GistFile | null>;
}
export interface GistRevision {
  version: string;
  committed_at: string;
  change_status: { additions?: number; deletions?: number; total?: number };
}

/** Splits backup text into Gist files: repertoire-backup.json, then .part2.json, .part3.json… */
export function splitIntoFiles(text: string, size = PART_SIZE): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0, n = 1; i < text.length || n === 1; i += size, n++) {
    out[n === 1 ? BACKUP_FILE : BACKUP_FILE.replace('.json', `.part${n}.json`)] = text.slice(i, i + size);
  }
  return out;
}

/** Reassembles the backup text from a Gist's files. */
export function joinFiles(files: Record<string, GistFile | null>): string {
  const parts: [number, GistFile][] = [];
  for (const [name, f] of Object.entries(files)) {
    if (!f) continue;
    const m = name.match(/^repertoire-backup(?:\.part(\d+))?\.json$/);
    if (m) parts.push([m[1] ? Number(m[1]) : 1, f]);
  }
  if (!parts.length) throw new GistError('notfound', 'This Gist has no repertoire-backup.json.');
  parts.sort((a, b) => a[0] - b[0]);
  if (parts.some(([, f]) => f.truncated || f.content === undefined))
    throw new GistError('toolarge', 'A backup file in the Gist is too large for the API to return in full.');
  return parts.map(([, f]) => f.content).join('');
}

const description = (summary: string) => `Repertoire Trainer backup — ${summary}`;

export function testConnection(token: string) {
  return gh<unknown[]>(token, '/gists?per_page=1');
}

/** Finds an existing backup Gist owned by the token's user. */
export async function findBackupGist(token: string): Promise<Gist | null> {
  const list = await gh<Gist[]>(token, '/gists?per_page=100');
  return list.find((g) => g.files && BACKUP_FILE in g.files) ?? null;
}

export async function createGist(token: string, text: string, summary: string): Promise<Gist> {
  const files: Record<string, { content: string }> = {};
  for (const [name, content] of Object.entries(splitIntoFiles(text))) files[name] = { content };
  return gh<Gist>(token, '/gists', { method: 'POST', body: { description: description(summary), public: false, files } });
}

/** Updates the backup Gist in place (GitHub keeps every revision). Stale part files are removed. */
export async function updateGist(token: string, id: string, text: string, summary: string): Promise<Gist> {
  if (!/^[0-9a-f]{8,64}$/i.test(id)) throw new GistError('notfound', 'Invalid Gist id.');
  const current = await gh<Gist>(token, `/gists/${id}`);
  const next = splitIntoFiles(text);
  const files: Record<string, { content: string } | null> = {};
  for (const [name, content] of Object.entries(next)) files[name] = { content };
  for (const name of Object.keys(current.files)) if (/^repertoire-backup\.part\d+\.json$/.test(name) && !(name in next)) files[name] = null;
  return gh<Gist>(token, `/gists/${id}`, { method: 'PATCH', body: { description: description(summary), files } });
}

export function listRevisions(token: string, id: string): Promise<GistRevision[]> {
  return gh<GistRevision[]>(token, `/gists/${id}/commits?per_page=30`);
}

export async function getRevisionText(token: string, id: string, sha: string): Promise<string> {
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new GistError('notfound', 'Invalid revision.');
  return joinFiles((await gh<Gist>(token, `/gists/${id}/${sha}`)).files);
}
