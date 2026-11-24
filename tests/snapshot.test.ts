import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeBackup, parseBackup, summarize } from '../src/core/backupSchema';
import * as repo from '../src/db/repo';
import { setDbName } from '../src/db/schema';
import { buildMoves } from './helpers';

let n = 0;
beforeEach(() => setDbName(`test-${++n}`));

async function seed() {
  await repo.putRepertoire({ id: 'r1', name: 'White', side: 'w', createdAt: 1 });
  await repo.putMoves(buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5'], 'r1'));
  await repo.putKv('settings', { sound: true });
  await repo.putKv('secret:githubToken', 'github_pat_TOKEN');
  await repo.putKv('local:gist', { id: 'g1' });
}

async function snapshot(reason: string) {
  const data = await repo.loadAll();
  await repo.addSnapshot({ createdAt: Date.now() + n++, reason, json: makeBackup(data, { appVersion: 't', deviceLabel: 't' }), summary: summarize(data) });
}

describe('snapshots and restore', () => {
  it('restoring a snapshot brings back the exact data and keeps device-local keys', async () => {
    await seed();
    const before = await repo.loadAll();
    await snapshot('before change');
    // Change things: delete moves, add a repertoire.
    await repo.deleteMoves(before.moves.slice(2).map((m) => m.id));
    await repo.putRepertoire({ id: 'r2', name: 'Black', side: 'b', createdAt: 2 });
    expect((await repo.loadAll()).moves).toHaveLength(2);

    const [snap] = await repo.listSnapshots();
    const parsed = parseBackup(snap.json);
    await repo.replaceAll(parsed.data);
    const after = await repo.loadAll();
    expect(after.moves.map((m) => m.id).sort()).toEqual(before.moves.map((m) => m.id).sort());
    expect(after.repertoires.map((r) => r.id)).toEqual(['r1']);
    expect(after.kv.settings).toEqual({ sound: true });
    const local = await repo.loadLocalKv();
    expect(local['secret:githubToken']).toBe('github_pat_TOKEN'); // not wiped by a restore
    expect(snap.json).not.toContain('TOKEN'); // and never stored in a snapshot
  });

  it('keeps only the newest 5 snapshots', async () => {
    await seed();
    for (let i = 0; i < 7; i++) await snapshot(`s${i}`);
    const list = await repo.listSnapshots();
    expect(list).toHaveLength(repo.MAX_SNAPSHOTS);
    expect(list.map((s) => s.reason)).toEqual(['s6', 's5', 's4', 's3', 's2']);
  });

  it('a failing restore rolls back and changes nothing', async () => {
    await seed();
    const before = await repo.loadAll();
    const bad = { ...before, moves: [...before.moves, { id: undefined } as any] }; // invalid key → write fails
    await expect(repo.replaceAll(bad)).rejects.toBeTruthy();
    const after = await repo.loadAll();
    expect(after.moves.map((m) => m.id).sort()).toEqual(before.moves.map((m) => m.id).sort());
    expect(after.kv).toEqual(before.kv);
  });
});
