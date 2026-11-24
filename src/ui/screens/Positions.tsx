import { useState } from 'preact/hooks';
import { goalText, materialSignature } from '../../core/positions';
import { isDue } from '../../core/scheduler';
import type { Position } from '../../core/types';
import { collections, createCollection, deleteCollection, positionCard, positions, renameCollection } from '../../state/store';
import { actionSheet, confirmDialog, promptDialog } from '../dialogs';
import { openFenPaste, openPgnPick } from '../PositionImport';
import { go } from '../router';
import { KbnGuide } from '../KbnGuide';

const GOAL_LABEL = { win: 'Win', draw: 'Draw', bestMove: 'Best move' } as const;

export function positionLabel(p: Position) {
  return p.title || materialSignature(p.fen);
}

export function addPositionMenu() {
  actionSheet('Add a position', [
    { label: '♟ Set up on the board', run: () => go('position/new') },
    { label: '📋 Paste a FEN…', run: openFenPaste },
    { label: '📄 From a PGN…', run: openPgnPick },
  ]);
}

export function Positions() {
  const [coll, setColl] = useState<string>('all');
  const [tag, setTag] = useState<string>('');
  const [goal, setGoal] = useState<string>('');
  const [sig, setSig] = useState<string>('');
  const all = positions.value;
  const sigs = [...new Set(all.map((p) => materialSignature(p.fen)))].sort();
  const tags = [...new Set(all.flatMap((p) => p.tags))].sort();
  const list = all.filter(
    (p) =>
      (coll === 'all' || (coll === 'none' ? !p.collectionId : p.collectionId === coll)) &&
      (!tag || p.tags.includes(tag)) &&
      (!goal || p.goal === goal) &&
      (!sig || materialSignature(p.fen) === sig),
  );
  const due = (p: Position) => p.practiceModes.includes('playOut') && isDue(positionCard(p));
  const nDue = all.filter(due).length;

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Home" onClick={() => go('')}>‹</button>
        <h1>Positions</h1>
        <button class="btn small primary" onClick={addPositionMenu}>+ Add</button>
      </div>
      <div class="scroll">
        <div class="card">
          <div class="row">
            <div class="grow">
              <div style="font-weight:600">Practice positions</div>
              <div class="small muted">{nDue ? `${nDue} due` : all.length ? 'Nothing due' : 'Add a position to start'}</div>
            </div>
            {nDue > 0 && <span class="badge orange">{nDue}</span>}
            <button class="btn primary" disabled={!all.length} onClick={() => go(`position-practice?coll=${coll}&tag=${encodeURIComponent(tag)}&goal=${goal}&sig=${sig}`)}>
              Practice
            </button>
          </div>
        </div>

        {all.length > 0 && (
          <div class="pad">
            <div class="chips" style="margin:6px 0">
              <button class={`chip ${coll === 'all' ? 'on' : ''}`} onClick={() => setColl('all')}>All</button>
              {collections.value.map((c) => (
                <button class={`chip ${coll === c.id ? 'on' : ''}`} onClick={() => setColl(c.id)}>{c.name}</button>
              ))}
              {all.some((p) => !p.collectionId) && collections.value.length > 0 && (
                <button class={`chip ${coll === 'none' ? 'on' : ''}`} onClick={() => setColl('none')}>No collection</button>
              )}
            </div>
            <div class="row wrap" style="gap:6px">
              <select value={goal} onChange={(e) => setGoal((e.target as HTMLSelectElement).value)}>
                <option value="">Any goal</option>
                <option value="win">Win</option>
                <option value="draw">Draw</option>
                <option value="bestMove">Best move</option>
              </select>
              {sigs.length > 1 && (
                <select value={sig} onChange={(e) => setSig((e.target as HTMLSelectElement).value)}>
                  <option value="">Any material</option>
                  {sigs.map((s) => (
                    <option value={s}>{s}</option>
                  ))}
                </select>
              )}
              {tags.length > 0 && (
                <select value={tag} onChange={(e) => setTag((e.target as HTMLSelectElement).value)}>
                  <option value="">Any tag</option>
                  {tags.map((t) => (
                    <option value={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        <div class="card">
          {all.length === 0 && (
            <p class="muted small" style="margin:0">
              No positions yet. Tap <b>+ Add</b> to set one up on the board, paste a FEN, or pick a move from a PGN. You can also
              save positions from Build, the analysis board and your Lichess review.
            </p>
          )}
          {all.length > 0 && list.length === 0 && <p class="muted small" style="margin:0">No positions match these filters.</p>}
          {list.map((p) => {
            const c = collections.value.find((x) => x.id === p.collectionId);
            return (
              <div class="list-item" style="cursor:pointer" onClick={() => go(`position/${p.id}`)}>
                <div class="grow" style="min-width:0">
                  <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{positionLabel(p)}</div>
                  <div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    {GOAL_LABEL[p.goal]} · {materialSignature(p.fen)}
                    {c ? ` · ${c.name}` : ''}
                    {p.tags.length ? ` · ${p.tags.join(', ')}` : ''}
                  </div>
                  <div class="small muted">{goalText(p.goal, p.mySide, p.fen)}</div>
                </div>
                <span class="small muted">{p.practiceModes.includes('playOut') ? '▶︎' : ''}{p.practiceModes.includes('lines') ? '📖' : ''}</span>
                {due(p) && <span class="badge orange">due</span>}
              </div>
            );
          })}
        </div>

        {all.some((p) => materialSignature(p.fen) === 'KBNvK') && <KbnGuide />}

        <div class="card">
          <h2>Collections</h2>
          {collections.value.length === 0 && <p class="muted small">Group positions, e.g. “KBN mates” or “Rook endgames”.</p>}
          {collections.value.map((c) => (
            <div class="list-item">
              <div class="grow">
                {c.name} <span class="muted small">({all.filter((p) => p.collectionId === c.id).length})</span>
              </div>
              <button
                class="btn small ghost"
                onClick={() =>
                  actionSheet(c.name, [
                    { label: 'Rename', run: async () => { const n = await promptDialog('Rename collection', c.name); if (n?.trim()) renameCollection(c.id, n); } },
                    { label: 'Delete collection (positions are kept)', danger: true, run: async () => { if (await confirmDialog(`Delete the collection “${c.name}”? Its positions stay saved.`, { ok: 'Delete', danger: true })) deleteCollection(c.id); } },
                  ])
                }
              >
                ⋯
              </button>
            </div>
          ))}
          <button
            class="btn small block ghost"
            onClick={async () => {
              const n = await promptDialog('New collection', '', { placeholder: 'e.g. KBN mates' });
              if (n?.trim()) await createCollection(n);
            }}
          >
            + New collection
          </button>
        </div>
      </div>
    </div>
  );
}
