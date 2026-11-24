import { computed } from '@preact/signals';
import * as repo from '../db/repo';
import { playMove } from '../core/fen';
import { analyzeGame, mergeFinding } from '../core/review';
import type { FindingStatus, GameFinding, LichessGame, Move } from '../core/types';
import { onGamesSynced } from './lichessSync';
import { runQueue, setupEvalQueue } from '../engine/evalQueue';
import {
  addMove,
  cardFor,
  cards,
  findings,
  graphOf,
  lichessGames,
  lichessSettings,
  recordReview,
  openingRepertoires,
  setPrimary,
} from './store';

function repsForAnalysis() {
  return openingRepertoires.value.map((r) => ({ id: r.id, side: r.side, graph: graphOf(r.id) }));
}

/** Compares games with the current repertoires and stores one finding per game. */
export async function analyzeGames(games: LichessGame[]) {
  const reps = repsForAnalysis();
  const byId = new Map(findings.value.map((f) => [f.id, f]));
  const changed: GameFinding[] = [];
  for (const g of games) {
    const f = analyzeGame(g, reps);
    if (!f) continue;
    const merged = mergeFinding(byId.get(f.id), f);
    byId.set(f.id, merged);
    changed.push(merged);
  }
  if (!changed.length) return 0;
  await repo.putFindings(changed);
  const now = Date.now();
  await repo.putGames(games.map((g) => ({ ...g, analyzedAt: now })));
  const analyzed = new Set(games.map((g) => g.id));
  lichessGames.value = lichessGames.value.map((g) => (analyzed.has(g.id) ? { ...g, analyzedAt: now } : g));
  findings.value = [...byId.values()];
  return changed.length;
}

onGamesSynced((games) => analyzeGames(games).then(() => runQueue()));

setupEvalQueue({
  candidates: () => toReview.value,
  gameOf: (f) => gameOf(f),
  update: (f, patch) => updateFinding(f, patch),
  settings: () => lichessSettings.value,
});

/** Re-checks every stored game against the repertoire as it is now (decisions are kept). */
export function reanalyzeAll() {
  return analyzeGames(lichessGames.value);
}

const gameById = computed(() => new Map(lichessGames.value.map((g) => [g.id, g])));
export function gameOf(f: GameFinding): LichessGame | undefined {
  return gameById.value.get(f.gameId);
}

/** Games of the configured Lichess account. */
export const myGames = computed(() => {
  const u = lichessSettings.value.username.toLowerCase();
  return lichessGames.value.filter((g) => !u || (g.user ?? u) === u);
});

/**
 * A finding is still relevant if the repertoire hasn't changed in a way that answers it
 * (e.g. the missing reply has been added since).
 */
export function stillRelevant(f: GameFinding): boolean {
  const g = graphOf(f.repertoireId);
  if (!g.size && f.type !== 'outOfBook') return false;
  const p = f.playedUci ? playMove(f.fen, { from: f.playedUci.slice(0, 2), to: f.playedUci.slice(2, 4), promotion: f.playedUci[4] }) : null;
  switch (f.type) {
    case 'deviation': {
      const main = g.primary(f.fen);
      return !!main && main.uci !== f.playedUci && !(p && g.findByUci(f.fen, p.uci));
    }
    case 'gap':
      return !!p && !g.findByUci(f.fen, p.uci);
    case 'outOfBook':
      return !g.primary(f.fen) && !(p && g.findByUci(f.fen, p.uci));
    default:
      return false;
  }
}

/** Findings waiting for review, newest game first. */
export const toReview = computed(() => {
  const ids = new Set(myGames.value.map((g) => g.id));
  return findings.value
    .filter((f) => f.status === 'new' && f.type !== 'followed' && ids.has(f.gameId) && stillRelevant(f))
    .sort((a, b) => (gameById.value.get(b.gameId)?.playedAt ?? 0) - (gameById.value.get(a.gameId)?.playedAt ?? 0));
});

export async function setFindingStatus(f: GameFinding, status: FindingStatus) {
  const next = { ...f, status };
  await repo.putFindings([next]);
  findings.value = findings.value.map((x) => (x.id === f.id ? next : x));
}

export async function updateFinding(f: GameFinding, patch: Partial<GameFinding>) {
  const cur = findings.value.find((x) => x.id === f.id) ?? f;
  const next = { ...cur, ...patch };
  await repo.putFindings([next]);
  findings.value = findings.value.map((x) => (x.id === f.id ? next : x));
  return next;
}

/** The repertoire's main move at the finding's position. */
export function expectedMove(f: GameFinding): Move | undefined {
  return graphOf(f.repertoireId).primary(f.fen);
}

/** "Drill this": counts a lapse and makes the card due right away. */
export async function drillFinding(f: GameFinding): Promise<Move | undefined> {
  const m = expectedMove(f);
  if (!m) return undefined;
  await recordReview(m, 'again');
  const c = cardFor(m);
  const due = { ...c, due: Date.now() };
  cards.value = new Map(cards.value).set(m.id, due);
  await repo.putCard(due);
  await setFindingStatus(f, 'drilled');
  return m;
}

/** "My move was better": saves my game move and makes it the main move (the old one stays as an alternative). */
export async function adoptPlayedMove(f: GameFinding) {
  if (!f.playedUci) return;
  const p = playMove(f.fen, { from: f.playedUci.slice(0, 2), to: f.playedUci.slice(2, 4), promotion: f.playedUci[4] });
  if (!p) return;
  const m = await addMove(f.repertoireId, p);
  await setPrimary(m.id);
  await setFindingStatus(f, 'added');
}

/** UCI moves of the game from the start up to (not including) `ply`. */
export function gameLineUci(game: LichessGame, ply: number): string[] {
  const out: string[] = [];
  let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  for (const san of game.moves.split(/\s+/).slice(0, ply)) {
    const p = playMove(fen, san);
    if (!p) break;
    out.push(p.uci);
    fen = p.toFen;
  }
  return out;
}

/** Analyses stored games that haven't been compared yet (e.g. synced before an update). */
export async function analyzePending() {
  const pending = lichessGames.value.filter((g) => !g.analyzedAt);
  const n = pending.length ? await analyzeGames(pending) : 0;
  runQueue();
  return n;
}
