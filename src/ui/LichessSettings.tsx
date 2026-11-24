import { useEffect, useState } from 'preact/hooks';
import { ALL_SPEEDS, validUsername } from '../core/lichess';
import type { Speed } from '../core/types';
import { testLichess } from '../net/lichessClient';
import { relTime } from '../state/gistBackup';
import { syncGames, syncing, syncProgress, syncState } from '../state/lichessSync';
import { lichessGames, lichessSettings, updateLichessSettings } from '../state/store';
import { reanalyzeAll } from '../state/review';
import { confirmDialog, toast } from './dialogs';

export function useNow(ms = 1000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, []);
  return t;
}

export async function runSync() {
  const r = await syncGames();
  if (r.error) await confirmDialog(r.error + (r.added ? `\n\n${r.added} new game(s) were saved before the problem.` : ''), { title: 'Lichess sync' });
  else toast(r.added ? `Synced ${r.added} new game${r.added === 1 ? '' : 's'}` : 'No new games', 3000);
}

export function SyncButton(props: { class?: string }) {
  const s = lichessSettings.value;
  const now = useNow();
  const cd = syncState.value.cooldownUntil ?? 0;
  const waiting = cd > now;
  return (
    <button class={`btn ${props.class ?? ''}`} disabled={!s.username || syncing.value || waiting} onClick={runSync}>
      {syncing.value
        ? `Syncing… ${syncProgress.value || ''}`
        : waiting
          ? `Wait ${Math.ceil((cd - now) / 1000)} s`
          : 'Sync games'}
    </button>
  );
}

export function LichessSettings() {
  const s = lichessSettings.value;
  const [name, setName] = useState(s.username);
  const [busy, setBusy] = useState(false);
  const st = syncState.value;
  const mine = lichessGames.value.filter((g) => !s.username || (g.user ?? '') === s.username.toLowerCase()).length;
  const toggleSpeed = (sp: Speed) =>
    updateLichessSettings({ speeds: s.speeds.includes(sp) ? s.speeds.filter((x) => x !== sp) : [...s.speeds, sp] });

  return (
    <div class="card">
      <h2>Lichess</h2>
      <p class="muted small">
        Compare your public Lichess games with your repertoire. No login or token is needed. The app contacts lichess.org only
        when you sync.
      </p>
      <form
        class="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = name.trim();
          if (v && !validUsername(v)) return toast('That isn’t a valid Lichess username.');
          await updateLichessSettings({ username: v });
          toast(v ? 'Username saved' : 'Username cleared');
        }}
      >
        <input
          class="grow"
          placeholder="Your Lichess username"
          autoCapitalize="off"
          autoComplete="off"
          spellcheck={false}
          value={name}
          maxLength={30}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button class="btn" disabled={name.trim() === s.username}>Save</button>
      </form>
      <div class="field">
        <label>Game types</label>
        <div class="chips">
          {ALL_SPEEDS.map((sp) => (
            <button class={`chip ${s.speeds.includes(sp) ? 'on' : ''}`} onClick={() => toggleSpeed(sp)}>
              {sp[0].toUpperCase() + sp.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <label>Rated games only</label>
        <div class="chips">
          {[true, false].map((v) => (
            <button class={`chip ${s.ratedOnly === v ? 'on' : ''}`} onClick={() => updateLichessSettings({ ratedOnly: v })}>
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <label>Games per sync</label>
        <div class="chips">
          {[25, 50, 100, 200].map((v) => (
            <button class={`chip ${s.maxGames === v ? 'on' : ''}`} onClick={() => updateLichessSettings({ maxGames: v })}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <label>Sync automatically when the app opens (at most once an hour)</label>
        <div class="chips">
          {[false, true].map((v) => (
            <button class={`chip ${s.autoSync === v ? 'on' : ''}`} onClick={() => updateLichessSettings({ autoSync: v })}>
              {v ? 'On' : 'Off'}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <label>Engine check of your mistakes (uses Lichess analysis when the game has it)</label>
        <div class="chips">
          {[true, false].map((v) => (
            <button class={`chip ${s.engineCheck === v ? 'on' : ''}`} onClick={() => updateLichessSettings({ engineCheck: v })}>
              {v ? 'On' : 'Off'}
            </button>
          ))}
          {s.engineCheck &&
            [12, 14, 16, 18].map((d) => (
              <button class={`chip ${s.engineDepth === d ? 'on' : ''}`} onClick={() => updateLichessSettings({ engineDepth: d })}>
                depth {d}
              </button>
            ))}
        </div>
      </div>
      <p class="small muted">
        {mine} game{mine === 1 ? '' : 's'} stored
        {st.lastSyncAt ? ` · last sync ${relTime(st.lastSyncAt)}` : ''}
        {st.lastError ? <span style="color:var(--red)"> · ⚠︎ {st.lastError.message}</span> : ''}
      </p>
      <div class="row">
        <SyncButton class="primary grow" />
        <button
          class="btn grow"
          disabled={!s.username || busy}
          onClick={async () => {
            setBusy(true);
            try {
              toast(await testLichess(s.username), 3500);
            } catch (e) {
              await confirmDialog((e as Error).message, { title: 'Lichess' });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      <button
        class="btn small ghost block"
        style="margin-top:6px"
        disabled={!mine}
        onClick={async () => toast(`Re-checked ${await reanalyzeAll()} games against your repertoire`)}
      >
        Re-check all games against my repertoire
      </button>
    </div>
  );
}
