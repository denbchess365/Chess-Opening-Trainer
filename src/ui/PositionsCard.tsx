import { isDue } from '../core/scheduler';
import { positionCard, positions } from '../state/store';
import { go } from './router';

/** Home: the Positions item next to the repertoires. */
export function PositionsCard() {
  const all = positions.value;
  const due = all.filter((p) => p.practiceModes.includes('playOut') && isDue(positionCard(p))).length;
  return (
    <div class="card">
      <div class="row" style="cursor:pointer" onClick={() => go('positions')}>
        <span style="font-size:22px">♞</span>
        <div class="grow">
          <div style="font-weight:700">Positions</div>
          <div class="muted small">{all.length ? `${all.length} saved · endgames, tactics, your own positions` : 'Set up endgames and positions to practise'}</div>
        </div>
        {due > 0 && <span class="badge orange">{due}</span>}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn grow" onClick={() => go('positions')}>Open</button>
        <button class="btn grow" disabled={!all.length} onClick={() => go('position-practice')}>Practice</button>
      </div>
    </div>
  );
}
