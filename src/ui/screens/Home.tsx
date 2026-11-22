import { createRepertoire, currentStreak, meta, moves, repertoires, stats, totalDue } from '../../state/store';
import { actionSheet, promptDialog } from '../dialogs';
import { go } from '../router';
import { updateReady } from '../pwa';

const BACKUP_REMINDER_DAYS = 7;

export function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

async function newRepertoire() {
  const name = await promptDialog('New repertoire', '', { placeholder: 'e.g. Black vs 1.e4' });
  if (!name?.trim()) return;
  actionSheet('Which side do you play?', [
    { label: '♔ White', run: () => createRepertoire(name.trim(), 'w').then((r) => go(`build/${r.id}`)) },
    { label: '♚ Black', run: () => createRepertoire(name.trim(), 'b').then((r) => go(`build/${r.id}`)) },
  ]);
}

export function Home() {
  const due = totalDue.value;
  const streak = currentStreak.value;
  const last = meta.value.lastBackupAt;
  const needsBackup =
    moves.value.length > 0 && (!last || Date.now() - last > BACKUP_REMINDER_DAYS * 86400_000);

  return (
    <div class="screen">
      <div class="topbar">
        <h1>Repertoire Trainer</h1>
        <span class="badge grey" style="font-size:15px" title="Day streak">
          🔥 {streak}
        </span>
      </div>
      <div class="scroll">
        {updateReady.value && (
          <div class="banner" style="cursor:pointer" onClick={() => updateReady.value?.()}>
            ✨ A new version is ready — tap to update.
          </div>
        )}
        {needsBackup && (
          <div class="banner" onClick={() => go('settings')} style="cursor:pointer">
            💾 {last ? `Last backup ${Math.floor((Date.now() - last) / 86400_000)} days ago.` : 'You have never backed up.'} iOS can
            clear data of web apps you don't open for a while — tap to export a backup.
          </div>
        )}

        <div class="card">
          <h2>Daily tasks</h2>
          <div class="row">
            <div class="grow">
              <div style="font-weight:600">Practice moves</div>
              <div class="muted small">{due ? `${due} move${due === 1 ? '' : 's'} due` : 'Nothing due — nice!'}</div>
            </div>
            {due > 0 && <span class="badge orange">{due}</span>}
            <button class="btn primary" onClick={() => go('practice?mode=daily&auto=1')} disabled={!due}>
              Start
            </button>
          </div>
        </div>

        {repertoires.value.map((r) => {
          const s = stats.value.get(r.id);
          return (
            <div class="card" key={r.id}>
              <div class="row" onClick={() => go(`build/${r.id}`)} style="cursor:pointer">
                <span style="font-size:22px">{r.side === 'w' ? '♔' : '♚'}</span>
                <div class="grow" style="min-width:0">
                  <div style="font-weight:700">{r.name}</div>
                  <div class="muted small">
                    {s?.total ?? 0} moves · {pct(s?.completeRatio ?? 0)} complete · {pct(s?.masteredRatio ?? 0)} mastered
                  </div>
                </div>
                {!!s?.due && <span class="badge orange">{s.due}</span>}
              </div>
              <div class="progress" style="margin:10px 0 4px">
                <div style={`width:${pct(s?.completeRatio ?? 0)}`} />
              </div>
              <div class="progress" style="margin-bottom:10px">
                <div style={`width:${pct(s?.masteredRatio ?? 0)};background:var(--blue)`} />
              </div>
              <div class="row">
                <button class="btn grow" onClick={() => go(`build/${r.id}`)}>Build</button>
                <button class="btn grow" onClick={() => go(`practice?rep=${r.id}`)}>Practice</button>
              </div>
            </div>
          );
        })}

        <div class="pad">
          <button class="btn block ghost" onClick={newRepertoire}>+ New repertoire</button>
        </div>

        <div class="pad row" style="margin-top:8px">
          <button class="btn grow" onClick={() => go(`build/${repertoires.value[0]?.id ?? ''}`)}>Build</button>
          <button class="btn grow" onClick={() => go('practice')}>Practice</button>
          <button class="btn grow" onClick={() => go('stats')}>Stats</button>
          <button class="btn grow" onClick={() => go('settings')}>Settings</button>
        </div>
        <p class="center muted small" style="margin-top:16px">
          Legend: <span style="color:var(--accent)">■</span> complete · <span style="color:var(--blue)">■</span> mastered
        </p>
      </div>
    </div>
  );
}
