import { fullFen, turnOf } from '../core/fen';

export interface EngineLine {
  multipv: number;
  depth: number;
  /** Centipawns from White's point of view. */
  cp?: number;
  /** Mate in N from White's point of view (negative = Black mates). */
  mate?: number;
  pv: string[];
}

export interface AnalysisJob {
  fen: string;
  depth: number;
  movetimeMs?: number;
  multiPv: number;
  onUpdate: (lines: EngineLine[], depth: number) => void;
  onDone?: () => void;
}

/** Parses one UCI `info` line. Scores are converted to White's point of view. */
export function parseInfo(line: string, whiteToMove: boolean): EngineLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ') || line.includes(' currmove ')) return null;
  const tok = line.split(' ');
  const get = (k: string) => {
    const i = tok.indexOf(k);
    return i >= 0 ? tok[i + 1] : undefined;
  };
  const depth = Number(get('depth') ?? 0);
  const multipv = Number(get('multipv') ?? 1);
  const si = tok.indexOf('score');
  if (si < 0) return null;
  const kind = tok[si + 1];
  const val = Number(tok[si + 2]);
  const sign = whiteToMove ? 1 : -1;
  const pv = tok.slice(tok.indexOf('pv') + 1);
  const out: EngineLine = { multipv, depth, pv };
  if (kind === 'cp') out.cp = val * sign;
  else if (kind === 'mate') out.mate = val * sign;
  return out;
}

/**
 * Lazily started, single-threaded Stockfish (WASM) in a Web Worker. The worker is
 * created on first use and reused; switching positions stops the running search first.
 */
class Engine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private searching = false;
  private current: AnalysisJob | null = null;
  private pending: AnalysisJob | null = null;
  private lines = new Map<number, EngineLine>();
  private listeners: ((l: string) => void)[] = [];
  error: string | null = null;

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private waitFor(prefix: string): Promise<void> {
    return new Promise((resolve) => {
      const fn = (l: string) => {
        if (l.startsWith(prefix)) {
          this.listeners = this.listeners.filter((x) => x !== fn);
          resolve();
        }
      };
      this.listeners.push(fn);
    });
  }

  start(): Promise<void> {
    if (this.ready) return this.ready;
    const url = new URL('engine/stockfish-19-lite-single.js', document.baseURI).href;
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => this.onLine(String(e.data));
    this.worker.onerror = (e) => {
      this.error = e.message || 'Engine failed to load';
    };
    this.ready = (async () => {
      const ok = this.waitFor('uciok');
      this.send('uci');
      await ok;
      const rd = this.waitFor('readyok');
      this.send('isready');
      await rd;
    })();
    return this.ready;
  }

  private onLine(line: string) {
    for (const l of [...this.listeners]) l(line);
    const job = this.current;
    if (line.startsWith('bestmove')) {
      this.searching = false;
      if (job && job === this.current) job.onDone?.();
      this.current = null;
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        this.go(next);
      }
      return;
    }
    if (!job) return;
    const info = parseInfo(line, turnOf(job.fen) === 'w');
    if (!info) return;
    // A new depth for line 1 resets the shown set so lines stay consistent.
    if (info.multipv === 1) {
      for (const [k, v] of this.lines) if (v.depth < info.depth && k !== 1) this.lines.delete(k);
    }
    this.lines.set(info.multipv, info);
    const sorted = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
    job.onUpdate(sorted, info.depth);
  }

  private go(job: AnalysisJob) {
    this.current = job;
    this.lines.clear();
    this.searching = true;
    this.send('ucinewgame');
    this.send(`setoption name MultiPV value ${job.multiPv}`);
    this.send(`position fen ${fullFen(job.fen)}`);
    this.send(`go depth ${job.depth}${job.movetimeMs ? ` movetime ${job.movetimeMs}` : ''}`);
  }

  async analyze(job: AnalysisJob) {
    await this.start();
    if (this.searching) {
      this.pending = job;
      this.send('stop');
    } else this.go(job);
  }

  stop() {
    this.pending = null;
    if (this.searching) this.send('stop');
    this.current = null;
  }

  /** Waits for a best move (used by the offline smoke test). */
  async bestMove(fen: string, depth = 10): Promise<string> {
    await this.start();
    return new Promise((resolve) => {
      const fn = (l: string) => {
        if (l.startsWith('bestmove')) {
          this.listeners = this.listeners.filter((x) => x !== fn);
          resolve(l.split(' ')[1]);
        }
      };
      this.listeners.push(fn);
      this.analyze({ fen, depth, multiPv: 1, onUpdate: () => {} });
    });
  }
}

export const engine = new Engine();
(globalThis as any).__engine = engine;

/** Win-probability style mapping of an evaluation to 0..1 for the eval bar. */
export function whiteShare(l: EngineLine | undefined): number {
  if (!l) return 0.5;
  if (l.mate !== undefined) return l.mate > 0 ? 1 : 0;
  const cp = l.cp ?? 0;
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

export function formatScore(l: EngineLine): string {
  if (l.mate !== undefined) return `${l.mate > 0 ? '' : '-'}M${Math.abs(l.mate)}`;
  const v = (l.cp ?? 0) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
