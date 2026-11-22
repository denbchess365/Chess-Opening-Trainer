export interface LineEntry {
  san: string;
  saved: boolean;
}

/** Breadcrumb of the current line: `1. d4 Nf6 2. Bf4 …`; tap a move to jump to it. */
export function MoveList(props: { entries: LineEntry[]; cursor: number; onJump: (ply: number) => void }) {
  const { entries, cursor } = props;
  if (!entries.length)
    return (
      <div class="moves-line muted">
        <span class={`mv ${cursor === 0 ? 'cur' : ''}`}>Start</span> Play a move on the board.
      </div>
    );
  return (
    <div class="moves-line">
      <span class={`mv ${cursor === 0 ? 'cur' : ''}`} onClick={() => props.onJump(0)}>
        ⌂
      </span>
      {entries.map((e, i) => (
        <>
          {i % 2 === 0 && <span class="num">{i / 2 + 1}.</span>}
          <span
            class={`mv ${cursor === i + 1 ? 'cur' : ''} ${e.saved ? '' : 'unsaved'}`}
            onClick={() => props.onJump(i + 1)}
          >
            {e.san}
          </span>{' '}
        </>
      ))}
    </div>
  );
}
