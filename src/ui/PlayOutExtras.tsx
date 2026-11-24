import type { PlayOutSetup } from './screens/PlayOut';
import { go } from './router';

/** Buttons under the play-out result. Saving ad-hoc positions and lines arrive with the next milestone. */
export function PlayOutExtras(props: { setup: PlayOutSetup; moves: string[]; params: Record<string, string> }) {
  const next = props.params.queue?.split(',').filter(Boolean) ?? [];
  return (
    <div style="margin-top:8px">
      {next.length > 0 ? (
        <button class="btn primary block" onClick={() => go(`playout?pos=${next[0]}&queue=${next.slice(1).join(',')}&t=${Date.now()}`)}>
          Next position ({next.length} left)
        </button>
      ) : (
        <button class="btn primary block" onClick={() => (props.setup.positionId ? go(`position/${props.setup.positionId}`) : history.back())}>
          Done
        </button>
      )}
    </div>
  );
}
