import { myGames, toReview } from '../state/review';
import { lichessSettings } from '../state/store';
import { SyncButton } from './LichessSettings';
import { go } from './router';

/** Home: "Review your online games". */
export function OnlineGamesCard() {
  const s = lichessSettings.value;
  if (!s.username)
    return (
      <div class="card">
        <h2>Review your online games</h2>
        <p class="muted small">Add your Lichess username in Settings to check your games against your repertoire.</p>
        <button class="btn block" onClick={() => go('settings')}>Set up Lichess</button>
      </div>
    );
  const n = toReview.value.length;
  const games = myGames.value.length;
  return (
    <div class="card">
      <h2>Review your online games</h2>
      <div class="row" style="cursor:pointer" onClick={() => go('review')}>
        <div class="grow">
          <div style="font-weight:600">Correct your opening mistakes</div>
          <div class="small muted">
            {games ? (n ? `${n} to review` : 'No mistakes ✓') : 'Sync your games to start'} · {games} game{games === 1 ? '' : 's'} from {s.username}
          </div>
        </div>
        {n > 0 && <span class="badge orange">{n}</span>}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn grow" disabled={!games} onClick={() => go('review?tab=perf')}>Performance by opening</button>
        <SyncButton class="grow" />
      </div>
      {n > 0 && (
        <button class="btn primary block" style="margin-top:8px" onClick={() => go('review')}>
          Review {n} mistake{n === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
