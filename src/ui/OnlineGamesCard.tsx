import { lichessGames, lichessSettings } from '../state/store';
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
  const games = lichessGames.value.filter((g) => (g.user ?? '') === s.username.toLowerCase());
  return (
    <div class="card">
      <h2>Review your online games</h2>
      <p class="muted small">
        {games.length} game{games.length === 1 ? '' : 's'} from <b>{s.username}</b> on this device.
      </p>
      <SyncButton class="block" />
    </div>
  );
}
