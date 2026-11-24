import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BACKUP_SCHEMA, BackupError, makeBackup, parseBackup, type BackupData } from '../src/core/backupSchema';
import { buildMoves } from './helpers';

const v1 = readFileSync(new URL('./fixtures/v1-backup.json', import.meta.url), 'utf8');

function sample(): BackupData {
  const moves = buildMoves('w', ['e4 e5 Nf3 Nc6 Bb5', 'e4 c5 Nf3'], 'r1');
  return {
    repertoires: [{ id: 'r1', name: 'White', side: 'w', createdAt: 1 }],
    moves,
    cards: [],
    reviewLogs: [],
    kv: { settings: { sound: false }, 'secret:githubToken': 'github_pat_SECRET', 'local:gist': { id: 'abc' } },
    lichessGames: [
      {
        id: 'AbCdEfGh',
        playedAt: 1,
        myColor: 'w',
        opponent: '<img src=x onerror=alert(1)>',
        myRating: 1500,
        oppRating: 1490,
        result: 'win',
        speed: 'blitz',
        rated: true,
        eco: 'C60',
        openingName: 'Ruy Lopez',
        moves: 'e4 e5 Nf3 Nc6 Bb5',
        analyzedAt: null,
      },
    ],
    findings: [],
    positions: [],
    collections: [],
    practiceRuns: [],
  };
}

describe('backup format', () => {
  it('imports a real v1 backup file (migrates to the current schema)', () => {
    const r = parseBackup(v1);
    expect(r.meta.schemaVersion).toBe(1);
    expect(r.data.moves).toHaveLength(17);
    expect(r.data.repertoires).toHaveLength(2);
    expect(r.data.lichessGames).toEqual([]);
    expect(r.data.findings).toEqual([]);
    expect(r.data.positions).toEqual([]);
    expect(r.data.practiceRuns).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('round-trips v2 and never exports the token or device-local keys', () => {
    const text = makeBackup(sample(), { appVersion: '2.0.0', deviceLabel: 'iPhone' });
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('githubToken');
    expect(text).not.toContain('local:gist');
    const f = JSON.parse(text);
    expect(f).toMatchObject({ schemaVersion: BACKUP_SCHEMA, appVersion: '2.0.0', deviceLabel: 'iPhone', gamesIncluded: true });
    expect(typeof f.exportedAt).toBe('string');
    const r = parseBackup(text);
    expect(r.data.moves).toHaveLength(sample().moves.length);
    expect(r.data.lichessGames[0].opponent).toBe('<img src=x onerror=alert(1)>'); // stored verbatim, escaped at render
  });

  it('can leave the raw games out', () => {
    const r = parseBackup(makeBackup(sample(), { appVersion: 'x', deviceLabel: 'y', includeGames: false }));
    expect(r.meta.gamesIncluded).toBe(false);
    expect(r.data.lichessGames).toEqual([]);
  });

  it('strips local keys even if a hand-edited file contains them', () => {
    const f = JSON.parse(makeBackup(sample(), { appVersion: 'x', deviceLabel: 'y' }));
    f.data.kv['secret:githubToken'] = 'injected';
    expect(parseBackup(JSON.stringify(f)).data.kv['secret:githubToken']).toBeUndefined();
  });

  const corrupt = (mut: (f: any) => void) => {
    const f = JSON.parse(makeBackup(sample(), { appVersion: 'x', deviceLabel: 'y' }));
    mut(f);
    return JSON.stringify(f);
  };

  it.each([
    ['not JSON', () => '{nope', /not valid JSON/],
    ['another app', () => JSON.stringify({ app: 'x', data: {} }), /not a Repertoire Trainer backup/],
    ['newer schema', () => corrupt((f) => (f.schemaVersion = 99)), /newer version/],
    ['missing list', () => corrupt((f) => delete f.data.moves), /"moves" is missing/],
    ['move for unknown repertoire', () => corrupt((f) => (f.data.moves[0].repertoireId = 'nope')), /repertoire that isn't/],
    ['illegal move', () => corrupt((f) => (f.data.moves[0].uci = 'e2e5')), /not a legal move/],
    ['bad FEN', () => corrupt((f) => (f.data.moves[0].fromFen = 'garbage')), /invalid position/],
    ['duplicate id', () => corrupt((f) => f.data.moves.push(f.data.moves[0])), /appears twice/],
    ['bad card', () => corrupt((f) => f.data.cards.push({ moveId: 'x', repertoireId: 'r1', due: 'soon' })), /invalid "due"/],
    ['bad game', () => corrupt((f) => (f.data.lichessGames[0].result = 'maybe')), /invalid result/],
  ])('rejects %s', (_name, make, msg) => {
    expect(() => parseBackup(make())).toThrow(BackupError);
    expect(() => parseBackup(make())).toThrow(msg);
  });

  it('repairs two main moves at one position and drops orphan cards (with warnings)', () => {
    const text = corrupt((f) => {
      const e4 = f.data.moves[0];
      const d4 = { ...e4, id: 'd4', san: 'd4', uci: 'd2d4', toFen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -' };
      f.data.moves.push(d4);
      f.data.cards.push({ moveId: 'gone', repertoireId: 'r1', due: 1, stability: 0, difficulty: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0 });
    });
    const r = parseBackup(text);
    expect(r.data.moves.find((m) => m.id === 'd4')!.isPrimary).toBe(false);
    expect(r.data.cards).toHaveLength(0);
    expect(r.warnings.length).toBe(2);
  });
});

describe('backup v3: positions, collections, runs', () => {
  const KBN = '8/8/8/4k3/8/8/8/3BNK2 w - - 0 1';
  const withPositions = (): BackupData => ({
    ...sample(),
    repertoires: [
      ...sample().repertoires,
      { id: 'pr1', name: 'KBN line', side: 'w', createdAt: 2, kind: 'position', positionId: 'p1', startFen: '8/8/8/4k3/8/8/8/3BNK2 w - -' },
    ],
    collections: [{ id: 'c1', name: 'KBN mates', createdAt: 1 }],
    positions: [
      { id: 'p1', fen: KBN, title: 'KBN', note: 'corner', tags: ['endgame'], collectionId: 'c1', goal: 'win', mySide: 'w', practiceModes: ['playOut', 'lines'], source: 'editor', repertoireId: 'pr1', createdAt: 1 },
    ],
    cards: [{ moveId: 'pos:p1', repertoireId: 'positions', due: 1, stability: 1, difficulty: 5, scheduledDays: 0, learningSteps: 0, reps: 1, lapses: 0, state: 1, lastReview: 1, wrong: 0, right: 1 }],
    practiceRuns: [{ id: 'run1', positionId: 'p1', startFen: KBN, moves: ['f1e2', 'e5d4'], result: 'fail', reason: '50-move rule — draw', success: false, hintsUsed: 1, movesTaken: 1, engineDtm: 28, finishedAt: 5 }],
  });

  it('round-trips the new tables, including play-out cards', () => {
    const r = parseBackup(makeBackup(withPositions(), { appVersion: '3', deviceLabel: 'x' }));
    expect(r.data.positions).toHaveLength(1);
    expect(r.data.positions[0]).toMatchObject({ collectionId: 'c1', repertoireId: 'pr1', practiceModes: ['playOut', 'lines'] });
    expect(r.data.collections).toHaveLength(1);
    expect(r.data.practiceRuns[0]).toMatchObject({ positionId: 'p1', engineDtm: 28 });
    expect(r.data.cards.map((c) => c.moveId)).toEqual(['pos:p1']);
    expect(r.data.repertoires.find((x) => x.id === 'pr1')!.startFen).toBe('8/8/8/4k3/8/8/8/3BNK2 w - -');
    expect(r.warnings).toEqual([]);
  });

  it('migrates a v2 file (no position tables)', () => {
    const f = JSON.parse(makeBackup(sample(), { appVersion: '2', deviceLabel: 'x' }));
    f.schemaVersion = 2;
    delete f.data.positions;
    delete f.data.collections;
    delete f.data.practiceRuns;
    const r = parseBackup(JSON.stringify(f));
    expect(r.meta.schemaVersion).toBe(2);
    expect(r.data.positions).toEqual([]);
    expect(r.data.moves.length).toBe(sample().moves.length);
  });

  it('rejects an illegal saved position and drops orphan play-out cards', () => {
    const bad = withPositions();
    bad.positions[0] = { ...bad.positions[0], fen: '8/8/8/8/8/8/8/3BNK2 w - - 0 1' };
    expect(() => parseBackup(makeBackup(bad, { appVersion: 'x', deviceLabel: 'x' }))).toThrow(/illegal position: Black has no king/);
    const orphan = withPositions();
    orphan.positions = [];
    orphan.repertoires = orphan.repertoires.filter((x) => x.id !== 'pr1');
    const r = parseBackup(makeBackup(orphan, { appVersion: 'x', deviceLabel: 'x' }));
    expect(r.data.cards).toEqual([]);
    expect(r.data.practiceRuns[0].positionId).toBeUndefined();
  });
});
