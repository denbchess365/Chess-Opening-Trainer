export interface LineEntry {
  san: string;
  saved: boolean;
}

/** Breadcrumb of the current line: `1. d4 Nf6 2. Bf4 …`; tap a move to jump to it. */
export function MoveList(props: { entries: LineEntry[]; cursor: number; onJump: (ply: number) => void; startTurn?: 'w' | 'b' }) {
  const { entries, cursor } = props;
  // When the line starts with Black to move, the first number is "1...".
  const off = props.startTurn === 'b' ? 1 : 0;
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
          {(i + off) % 2 === 0 && <span class="num">{(i + off) / 2 + 1}.</span>}
          {i === 0 && off === 1 && <span class="num">1…</span>}
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
