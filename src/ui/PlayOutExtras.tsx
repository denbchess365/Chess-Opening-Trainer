import { useState } from 'preact/hooks';
import { playoutToLine } from '../core/playout';
import { materialSignature } from '../core/positions';
import type { Position } from '../core/types';
import { addLine, ensureLinesRepertoire, findPositionByFen, newPosition, positionById, savePosition } from '../state/store';
import type { PlayOutSetup } from './screens/PlayOut';
import { toast } from './dialogs';
import { go } from './router';

/** Buttons under a play-out result: next/done, save the start position, add my moves as a line. */
export function PlayOutExtras(props: { setup: PlayOutSetup; moves: string[]; params: Record<string, string>; onExit?: () => void }) {
  const { setup } = props;
  const [saved, setSaved] = useState<Position | undefined>(() =>
    setup.positionId ? positionById(setup.positionId) : findPositionByFen(setup.startFen),
  );
  const [lineAdded, setLineAdded] = useState<string | null>(null);
  const next = props.params.queue?.split(',').filter(Boolean) ?? [];

  const ensureSaved = async (): Promise<Position> => {
    if (saved) return saved;
    const p = await savePosition(
      newPosition(setup.startFen, {
        title: setup.title || materialSignature(setup.startFen),
        goal: setup.goal,
        mySide: setup.mySide,
        source: props.params.source === 'lichess' ? 'lichess' : props.params.source === 'line' ? 'line' : 'playout',
      }),
    );
    setSaved(p);
    return p;
  };

  const addAsLine = async () => {
    const p = await ensureSaved();
    const rep = await ensureLinesRepertoire(positionById(p.id) ?? p);
    const line = playoutToLine(setup.startFen, props.moves);
    const before = line.length;
    await addLine(rep.id, line);
    setLineAdded(rep.id);
    toast(`Added ${before} moves as a line — your moves are drilled, the engine’s are the replies.`, 4000);
  };

  return (
    <div style="margin-top:8px">
      {!saved && (
        <button class="btn block" style="margin-bottom:8px" onClick={async () => (await ensureSaved(), toast('Starting position saved'))}>
          💾 Save the starting position
        </button>
      )}
      {props.moves.length > 0 && setup.goal !== 'bestMove' && (
        lineAdded ? (
          <button class="btn block" style="margin-bottom:8px" onClick={() => go(`build/${lineAdded}`)}>📖 Open the lines</button>
        ) : (
          <button class="btn block" style="margin-bottom:8px" onClick={addAsLine}>📖 Add my moves as a line</button>
        )
      )}
      {next.length > 0 ? (
        <button
          class="btn primary block"
          onClick={() => go(`playout?pos=${next[0]}&queue=${next.slice(1).join(',')}${props.params.done !== undefined ? `&done=${encodeURIComponent(props.params.done)}` : ''}&t=${Date.now()}`)}
        >
          Next position ({next.length} left)
        </button>
      ) : (
        <button
          class="btn primary block"
          onClick={() =>
            props.onExit
              ? props.onExit()
              : props.params.done !== undefined
                ? go(props.params.done)
                : saved && !props.params.fen
                  ? go(`position/${saved.id}`)
                  : history.back()
          }
        >
          {props.onExit ? 'Back to the drill' : 'Done'}
        </button>
      )}
    </div>
  );
}
