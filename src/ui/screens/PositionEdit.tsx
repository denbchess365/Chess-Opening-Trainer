import { useState } from 'preact/hooks';
import { checkPosition, goalText, materialSignature, positionKey, START_FULL } from '../../core/positions';
import type { Position, PositionGoal, PositionSource, PracticeKind } from '../../core/types';
import {
  allTags,
  collections,
  createCollection,
  graphOf,
  newPosition,
  positionById,
  positions,
  removePosition,
  savePosition,
} from '../../state/store';
import { BoardEditor } from '../BoardEditor';
import { confirmDialog, promptDialog, toast } from '../dialogs';
import { go } from '../router';

const GOALS: [PositionGoal, string][] = [
  ['win', 'Win (mate)'],
  ['draw', 'Hold the draw'],
  ['bestMove', 'Best move'],
];

export function PositionEdit(props: { id: string; params: Record<string, string> }) {
  const existing = props.id !== 'new' ? positionById(props.id) : undefined;
  const dup = props.params.dup ? positionById(props.params.dup) : undefined;
  const [draft, setDraft] = useState<Position>(() => {
    if (existing) return { ...existing };
    if (dup) {
      const { id: _id, repertoireId: _r, createdAt: _c, ...rest } = dup;
      return newPosition(dup.fen, { ...rest, title: dup.title ? `${dup.title} (copy)` : '' });
    }
    const fen = props.params.fen || START_FULL;
    return newPosition(fen, {
      source: (props.params.source as PositionSource) || 'editor',
      title: props.params.title ?? '',
      ...(props.params.side === 'w' || props.params.side === 'b' ? { mySide: props.params.side } : {}),
    });
  });
  const [tagInput, setTagInput] = useState('');
  const set = (patch: Partial<Position>) => setDraft({ ...draft, ...patch });

  // A position whose lines are saved keeps its board (lines would no longer fit). Duplicate to vary it.
  const hasLines = !!existing?.repertoireId && graphOf(existing.repertoireId).size > 0;
  const check = checkPosition(draft.fen);
  const dupOf = check.ok ? positions.value.find((p) => p.id !== existing?.id && positionKey(p.fen) === positionKey(check.fen)) : undefined;

  if (props.id !== 'new' && !existing)
    return (
      <div class="screen">
        <div class="topbar">
          <button class="btn icon ghost" onClick={() => go('positions')}>‹</button>
          <h1>Position not found</h1>
        </div>
      </div>
    );

  const save = async () => {
    if (!check.ok) return;
    if (!draft.practiceModes.length) return toast('Choose at least one practice mode.');
    const saved = await savePosition({ ...draft, fen: check.fen, title: draft.title.trim() });
    toast(existing ? 'Position saved' : 'Position added');
    if (!existing) go(`position/${saved.id}`);
  };

  const addTag = (t: string) => {
    const v = t.trim().replace(/,$/, '');
    if (v && !draft.tags.includes(v)) set({ tags: [...draft.tags, v] });
    setTagInput('');
  };

  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" aria-label="Back" onClick={() => go('positions')}>‹</button>
        <h1>{existing ? draft.title || materialSignature(draft.fen) : dup ? 'Duplicate position' : 'New position'}</h1>
        <button class="btn primary small" disabled={!check.ok} onClick={save}>Save</button>
      </div>
      <div class="scroll">
        {hasLines ? (
          <div class="card small">
            This position has drill lines, so its board is locked. Use <b>Duplicate &amp; edit</b> to make a variation.
          </div>
        ) : (
          <BoardEditor fen={draft.fen} onChange={(fen) => set({ fen })} />
        )}
        {dupOf && (
          <p class="pad small" style="color:var(--orange)">
            You already saved this position as “{dupOf.title || materialSignature(dupOf.fen)}”.{' '}
            <a href={`#/position/${dupOf.id}`} style="color:var(--blue)">Open it</a>
          </p>
        )}
        <div class="card">
          {check.ok && <p class="small" style="margin-top:0;font-weight:600">{goalText(draft.goal, draft.mySide, check.fen)}</p>}
          <div class="field">
            <label>Title</label>
            <input style="width:100%" maxLength={80} placeholder={`e.g. ${materialSignature(draft.fen)} — king on e5`} value={draft.title} onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} />
          </div>
          <div class="field">
            <label>Goal</label>
            <div class="chips">
              {GOALS.map(([g, l]) => (
                <button class={`chip ${draft.goal === g ? 'on' : ''}`} onClick={() => set({ goal: g })}>{l}</button>
              ))}
            </div>
          </div>
          <div class="field">
            <label>I play</label>
            <div class="chips">
              {(['w', 'b'] as const).map((s) => (
                <button class={`chip ${draft.mySide === s ? 'on' : ''}`} onClick={() => set({ mySide: s })}>{s === 'w' ? 'White' : 'Black'}</button>
              ))}
            </div>
          </div>
          <div class="field">
            <label>Practice</label>
            <div class="chips">
              {([['playOut', '▶︎ Play it out'], ['lines', '📖 Drill lines']] as [PracticeKind, string][]).map(([m, l]) => (
                <button
                  class={`chip ${draft.practiceModes.includes(m) ? 'on' : ''}`}
                  onClick={() => set({ practiceModes: draft.practiceModes.includes(m) ? draft.practiceModes.filter((x) => x !== m) : [...draft.practiceModes, m] })}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <label>Collection</label>
            <div class="row">
              <select class="grow" value={draft.collectionId ?? ''} onChange={(e) => set({ collectionId: (e.target as HTMLSelectElement).value || null })}>
                <option value="">— none —</option>
                {collections.value.map((c) => (
                  <option value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                class="btn small"
                onClick={async () => {
                  const n = await promptDialog('New collection', '', { placeholder: 'e.g. KBN mates' });
                  if (n?.trim()) set({ collectionId: (await createCollection(n)).id });
                }}
              >
                + New
              </button>
            </div>
          </div>
          <div class="field">
            <label>Tags</label>
            <div class="chips" style="margin-bottom:6px">
              {draft.tags.map((t) => (
                <button class="chip on" onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })}>{t} ✕</button>
              ))}
            </div>
            <form class="row" onSubmit={(e) => (e.preventDefault(), addTag(tagInput))}>
              <input class="grow" list="tag-list" placeholder="Add a tag" value={tagInput} onInput={(e) => { const v = (e.target as HTMLInputElement).value; v.endsWith(',') ? addTag(v) : setTagInput(v); }} />
              <datalist id="tag-list">{allTags.value.map((t) => <option value={t} />)}</datalist>
              <button class="btn small" disabled={!tagInput.trim()}>Add</button>
            </form>
          </div>
          <div class="field">
            <label>Note</label>
            <textarea style="min-height:70px" placeholder="Plan, key idea, where it came from…" value={draft.note} onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })} />
          </div>
          <button class="btn primary block" disabled={!check.ok} onClick={save}>{existing ? 'Save changes' : 'Save position'}</button>
        </div>

        {existing && (
          <div class="card">
            <div class="row wrap" style="gap:8px">
              <button class="btn grow" onClick={() => go(`playout?pos=${existing.id}`)}>▶︎ Play it out</button>
              <button class="btn grow" onClick={() => go(`position-lines/${existing.id}`)}>📖 Lines</button>
            </div>
            <div class="row wrap" style="gap:8px;margin-top:8px">
              <button class="btn grow" onClick={() => go(`analysis?fen=${encodeURIComponent(existing.fen)}&orient=${existing.mySide}`)}>🔍 Analyse</button>
              <button class="btn grow" onClick={() => go(`position/new?dup=${existing.id}`)}>⧉ Duplicate &amp; edit</button>
            </div>
            <button
              class="btn danger block"
              style="margin-top:8px"
              onClick={async () => {
                if (await confirmDialog(`Delete this position${existing.repertoireId ? ' and its drill lines' : ''}? A snapshot is saved first.`, { ok: 'Delete', danger: true })) {
                  await removePosition(existing);
                  go('positions');
                }
              }}
            >
              Delete position
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
