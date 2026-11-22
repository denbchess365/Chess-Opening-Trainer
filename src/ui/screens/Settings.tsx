import { useState } from 'preact/hooks';
import type { Settings as S } from '../../core/types';
import {
  backupText,
  deleteRepertoire,
  exportPgnText,
  importPgnText,
  markBackedUp,
  meta,
  renameRepertoire,
  repertoires,
  resetProgress,
  restoreBackup,
  settings,
  updateSettings,
} from '../../state/store';
import { confirmDialog, openModal, promptDialog, toast } from '../dialogs';
import { pickTextFile, shareOrDownload, slug, stamp } from '../files';
import { go } from '../router';

function Chips<T extends string | number>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="chips">
      {props.options.map(([v, label]) => (
        <button class={`chip ${props.value === v ? 'on' : ''}`} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Field(props: { label: string; children: any }) {
  return (
    <div class="field">
      <label>{props.label}</label>
      {props.children}
    </div>
  );
}

async function exportBackup() {
  const text = await backupText();
  if (await shareOrDownload(`repertoire-backup-${stamp()}.json`, text, 'application/json')) {
    await markBackedUp();
    toast('Backup exported');
  }
}

async function importBackup() {
  const text = await pickTextFile('.json,application/json');
  if (!text) return;
  const ok = await confirmDialog(
    'Restoring replaces ALL repertoires, moves and progress on this device with the contents of the backup.',
    { ok: 'Replace everything', danger: true, title: 'Restore backup?' },
  );
  if (!ok) return;
  try {
    await restoreBackup(text);
    toast('Backup restored');
    go('');
  } catch (e) {
    toast(`Restore failed: ${(e as Error).message}`, 5000);
  }
}

function PgnImport(props: { close: () => void }) {
  const [repId, setRepId] = useState(repertoires.value[0]?.id ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!text.trim() || !repId) return;
    setBusy(true);
    try {
      const r = await importPgnText(repId, text);
      props.close();
      const errs = r.errors.length ? `\n\n${r.errors.length} problem(s):\n${[...new Set(r.errors)].slice(0, 5).join('\n')}` : '';
      await confirmDialog(`Imported ${r.games} game(s): ${r.added} new move(s) added.${errs}`, { ok: 'OK', title: 'PGN import' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h3>Import PGN</h3>
      <Field label="Into repertoire">
        <select value={repId} onChange={(e) => setRepId((e.target as HTMLSelectElement).value)} style="width:100%">
          {repertoires.value.map((r) => (
            <option value={r.id}>{r.name} ({r.side === 'w' ? 'White' : 'Black'})</option>
          ))}
        </select>
      </Field>
      <p class="muted small">
        Variations become branches. Moves for your side become your drilled moves where you don’t have one yet; the rest are
        saved as alternatives. Comments are kept.
      </p>
      <button class="btn block" onClick={async () => setText((await pickTextFile('.pgn,text/plain,application/x-chess-pgn')) ?? text)}>
        Choose .pgn file…
      </button>
      <p class="muted small center">or paste:</p>
      <textarea value={text} placeholder="1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5 *" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <div class="row" style="margin-top:10px">
        <button class="btn grow" onClick={props.close}>Cancel</button>
        <button class="btn primary grow" disabled={!text.trim() || busy} onClick={run}>
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  );
}

async function exportPgn(repId: string) {
  const r = repertoires.value.find((x) => x.id === repId);
  if (!r) return;
  await shareOrDownload(`${slug(r.name)}-${stamp()}.pgn`, exportPgnText(repId), 'application/x-chess-pgn');
}

export function Settings() {
  const s = settings.value;
  const set = (patch: Partial<S>) => updateSettings(patch);
  const last = meta.value.lastBackupAt;

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Home" onClick={() => go('')}>‹</button>
        <h1>Settings</h1>
      </div>
      <div class="scroll">
        <div class="card">
          <h2>Backup &amp; restore</h2>
          <p class="muted small">
            Everything lives only on this device. iOS may delete a home-screen app’s storage if it isn’t used for a while, so
            export a backup regularly and keep it in Files or iCloud Drive.
          </p>
          <p class="small">Last backup: <b>{last ? new Date(last).toLocaleString() : 'never'}</b></p>
          <div class="row">
            <button class="btn primary grow" onClick={exportBackup}>Export backup</button>
            <button class="btn grow" onClick={importBackup}>Restore…</button>
          </div>
        </div>

        <div class="card">
          <h2>PGN</h2>
          <button class="btn block" style="margin-bottom:8px" onClick={() => openModal((close) => <PgnImport close={close} />)}>
            Import PGN…
          </button>
          {repertoires.value.map((r) => (
            <button class="btn block ghost" onClick={() => exportPgn(r.id)}>Export “{r.name}” as PGN</button>
          ))}
        </div>

        <div class="card">
          <h2>Board</h2>
          <Field label="Board colors">
            <Chips value={s.boardTheme} options={[['green', 'Green'], ['brown', 'Brown'], ['blue', 'Blue']]} onChange={(v) => set({ boardTheme: v })} />
          </Field>
          <Field label="Pieces">
            <Chips value={s.pieceSet} options={[['cburnett', 'Classic'], ['merida', 'Merida'], ['chessnut', 'Chessnut']]} onChange={(v) => set({ pieceSet: v })} />
          </Field>
          <Field label="Appearance">
            <Chips value={s.theme} options={[['dark', 'Dark'], ['light', 'Light']]} onChange={(v) => set({ theme: v })} />
          </Field>
          <Field label="Sound">
            <Chips value={s.sound ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => set({ sound: v === 'on' })} />
          </Field>
        </div>

        <div class="card">
          <h2>Practice</h2>
          <Field label="Daily practice size (moves)">
            <Chips value={s.dailySize} options={[[10, '10'], [15, '15'], [20, '20'], [30, '30'], [50, '50']]} onChange={(v) => set({ dailySize: v })} />
          </Field>
        </div>

        <div class="card">
          <h2>Engine</h2>
          <Field label="Depth">
            <Chips value={s.engineDepth} options={[[12, '12'], [15, '15'], [18, '18'], [22, '22'], [26, '26']]} onChange={(v) => set({ engineDepth: v })} />
          </Field>
          <Field label="Time limit per position">
            <Chips
              value={s.engineMaxSeconds}
              options={[[0, 'None'], [1.5, '1.5 s'], [3, '3 s'], [5, '5 s'], [10, '10 s']]}
              onChange={(v) => set({ engineMaxSeconds: v })}
            />
          </Field>
          <p class="muted small">The search stops at whichever comes first. Deeper is slower and uses more battery.</p>
        </div>

        <div class="card">
          <h2>Repertoires</h2>
          {repertoires.value.map((r) => (
            <div class="list-item" style="flex-wrap:wrap">
              <div class="grow" style="font-weight:600">{r.side === 'w' ? '♔' : '♚'} {r.name}</div>
              <div class="row">
                <button
                  class="btn small"
                  onClick={async () => {
                    const n = await promptDialog('Rename repertoire', r.name);
                    if (n?.trim()) await renameRepertoire(r.id, n.trim());
                  }}
                >
                  Rename
                </button>
                <button
                  class="btn small"
                  onClick={async () => {
                    if (await confirmDialog(`Reset all practice progress for “${r.name}”? Your moves are kept.`, { ok: 'Reset progress', danger: true }))
                      await resetProgress(r.id).then(() => toast('Progress reset'));
                  }}
                >
                  Reset
                </button>
                <button
                  class="btn small danger"
                  onClick={async () => {
                    if (
                      (await confirmDialog(`Delete “${r.name}” with all its moves and progress?`, { ok: 'Delete', danger: true })) &&
                      (await confirmDialog('This cannot be undone. Export a backup first if unsure.', { ok: 'Delete for good', danger: true }))
                    )
                      await deleteRepertoire(r.id).then(() => toast('Repertoire deleted'));
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <div class="card small muted">
          <h2 style="color:var(--text)">About</h2>
          Repertoire Trainer works fully offline; nothing leaves your device. Built with Stockfish 19 (GPLv3), chessground
          (GPLv3), chess.js (BSD-2), ts-fsrs (MIT), Preact (MIT), idb (ISC) and the lichess chess-openings data (CC0). See
          the LICENSES folder in the repository. This app is free software under the GPLv3.
        </div>
      </div>
    </div>
  );
}
