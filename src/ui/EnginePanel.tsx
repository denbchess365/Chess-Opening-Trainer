import { useEffect, useState } from 'preact/hooks';
import { Chess } from 'chess.js';
import { formatLine, fullFen, turnOf } from '../core/fen';
import { engine, formatScore, whiteShare, type EngineLine } from '../engine/stockfish';
import { settings } from '../state/store';

function pvToSan(fen: string, pv: string[], max = 8): string[] {
  const c = new Chess(fullFen(fen));
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      out.push(c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

/** Stockfish eval bar + top 3 lines (MultiPV 3). Tap a line to play its first move. */
export function EnginePanel(props: { fen: string; ply: number; onPlay: (uci: string) => void }) {
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [depth, setDepth] = useState(0);
  const [status, setStatus] = useState('Starting engine…');
  const s = settings.value;

  useEffect(() => {
    setLines([]);
    setDepth(0);
    let cancelled = false;
    // Small debounce so stepping quickly through moves doesn't queue searches.
    const t = setTimeout(() => {
      setStatus('Thinking…');
      engine
        .analyze({
          fen: props.fen,
          depth: s.engineDepth,
          movetimeMs: s.engineMaxSeconds ? s.engineMaxSeconds * 1000 : undefined,
          multiPv: 3,
          onUpdate: (l, d) => {
            if (cancelled) return;
            setLines(l);
            setDepth(d);
          },
          onDone: () => !cancelled && setStatus('Done'),
        })
        .catch((e) => setStatus(`Engine error: ${e}`));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
      engine.stop();
    };
  }, [props.fen, s.engineDepth, s.engineMaxSeconds]);

  const best = lines[0];
  const share = whiteShare(best);
  const turn = turnOf(props.fen);
  const moveNo = Math.floor(props.ply / 2) + 1;

  return (
    <div>
      <div class="eval-bar" title="Evaluation (White share)">
        <div style={`width:${share * 100}%`} />
      </div>
      <div class="pad" style="padding-top:4px">
        <div class="row small muted">
          <span class="src-tag engine">engine</span>
          <span class="grow">Stockfish 19 lite · depth {depth}/{s.engineDepth}</span>
          <span>{engine.error ?? (lines.length ? (depth >= s.engineDepth || status === 'Done' ? 'done' : 'thinking…') : status)}</span>
        </div>
        {[0, 1, 2].map((i) => {
          const l = lines[i];
          if (!l) return <div class="engine-line muted small" style="min-height:40px">…</div>;
          // formatLine always starts with a move number ("5." or "5..."), then the first move.
          const tokens = formatLine(pvToSan(props.fen, l.pv), turn, moveNo).split(' ');
          return (
            <div class="engine-line" onClick={() => l.pv[0] && props.onPlay(l.pv[0])}>
              <span class="score">{formatScore(l)}</span>
              <span class="pv">
                {tokens[0]} <b>{tokens[1]}</b> {tokens.slice(2).join(' ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
