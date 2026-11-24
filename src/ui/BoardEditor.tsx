import { useEffect, useRef, useState } from 'preact/hooks';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key, Role } from '@lichess-org/chessground/types';
import { checkPosition, EMPTY_BOARD, parseBoard, possibleCastling, possibleEpSquares, START_FULL } from '../core/positions';
import { settings } from '../state/store';

const ROLES: Record<string, Role> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const PALETTE = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
type Tool = string | 'move' | 'erase';

interface Parts {
  placement: string;
  turn: 'w' | 'b';
  castling: string;
  ep: string;
  half: number;
  full: number;
}

function split(fen: string): Parts {
  const p = fen.trim().split(/\s+/);
  return {
    placement: p[0] || EMPTY_BOARD,
    turn: p[1] === 'b' ? 'b' : 'w',
    castling: p[2] && p[2] !== '-' ? p[2] : '',
    ep: p[3] || '-',
    half: Number(p[4]) || 0,
    full: Number(p[5]) || 1,
  };
}
const join = (s: Parts) => `${s.placement} ${s.turn} ${s.castling || '-'} ${s.ep} ${s.half} ${s.full}`;

/**
 * Position editor: tap a piece in the palette, then tap squares to place it (tapping the
 * same piece again removes it). ✋ lets you drag pieces (drag off the board to remove).
 */
export function BoardEditor(props: { fen: string; onChange: (fen: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [parts, setParts] = useState<Parts>(() => split(props.fen));
  const [tool, setTool] = useState<Tool>('K');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const update = (next: Parts) => {
    // Keep castling/en passant consistent with the board automatically.
    const board = parseBoard(next.placement);
    if (board) {
      const possible = possibleCastling(board);
      next = { ...next, castling: [...next.castling].filter((c) => possible.includes(c)).join('') };
      if (next.ep !== '-' && !possibleEpSquares(board, next.turn).includes(next.ep)) next = { ...next, ep: '-' };
    }
    setParts(next);
    props.onChange(join(next));
  };

  const readBoard = () => {
    const placement = api.current?.getFen();
    if (placement && placement !== partsRef.current.placement) update({ ...partsRef.current, placement });
  };

  const placeAt = (key: Key) => {
    const t = toolRef.current;
    if (!api.current || t === 'move') return;
    const current = api.current.state.pieces.get(key);
    const pieces = new Map();
    if (t === 'erase') pieces.set(key, undefined);
    else {
      const color = t === t.toUpperCase() ? 'white' : 'black';
      const role = ROLES[t.toLowerCase()];
      // Tapping the same piece again removes it.
      pieces.set(key, current && current.role === role && current.color === color ? undefined : { role, color });
    }
    api.current.setPieces(pieces);
    api.current.selectSquare(null);
    readBoard();
  };

  const configFor = (t: Tool) => ({
    movable: { free: true, color: t === 'move' ? ('both' as const) : undefined, showDests: false },
    draggable: { enabled: t === 'move', deleteOnDropOff: true },
    selectable: { enabled: true },
  });

  useEffect(() => {
    api.current = Chessground(el.current!, {
      fen: parts.placement,
      orientation,
      coordinates: true,
      animation: { enabled: false },
      highlight: { lastMove: false, check: false },
      premovable: { enabled: false },
      drawable: { enabled: false },
      ...configFor(tool),
      events: {
        change: () => readBoard(),
        select: (key) => placeAt(key),
      },
    });
    const ro = new ResizeObserver(() => {
      const e = el.current;
      if (e?.isConnected && e.offsetWidth > 0) api.current?.redrawAll();
    });
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      api.current?.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => api.current?.set(configFor(tool)), [tool]);
  useEffect(() => api.current?.set({ orientation }), [orientation]);

  const setBoard = (placement: string, extra: Partial<Parts> = {}) => {
    api.current?.set({ fen: placement });
    update({ ...parts, placement, ep: '-', ...extra });
  };

  const board = parseBoard(parts.placement);
  const possible = board ? possibleCastling(board) : '';
  const eps = board ? possibleEpSquares(board, parts.turn) : [];
  const check = checkPosition(join(parts));

  return (
    <div>
      <div class={`board-wrap board-${settings.value.boardTheme} pieces-${settings.value.pieceSet}`}>
        <div ref={el} class="cg-wrap" />
      </div>
      <div class={`palette cg-wrap pieces-${settings.value.pieceSet}`}>
        {[...PALETTE.slice(0, 6), 'move', ...PALETTE.slice(6), 'erase'].map((p) =>
          p === 'move' || p === 'erase' ? (
            <button class={`tool ${tool === p ? 'on' : ''}`} aria-label={p === 'move' ? 'Move pieces' : 'Erase'} onClick={() => setTool(p)}>
              {p === 'move' ? '✋' : '🗑'}
            </button>
          ) : (
            <button class={tool === p ? 'on' : ''} aria-label={`${p === p.toUpperCase() ? 'White' : 'Black'} ${ROLES[p.toLowerCase()]}`} onClick={() => setTool(p)}>
              <piece class={`${ROLES[p.toLowerCase()]} ${p === p.toUpperCase() ? 'white' : 'black'}`} />
            </button>
          ),
        )}
      </div>
      <p class="small muted pad" style="margin:4px 0">
        {tool === 'move' ? 'Drag pieces to move them; drag off the board to remove.' : tool === 'erase' ? 'Tap a piece to remove it.' : 'Tap squares to place this piece (tap it again to remove).'}
      </p>
      <div class="pad row wrap" style="gap:6px">
        <button class="btn small" onClick={() => setBoard(EMPTY_BOARD, { castling: '' })}>Clear</button>
        <button class="btn small" onClick={() => { const s = split(START_FULL); api.current?.set({ fen: s.placement }); update(s); }}>Start position</button>
        <button class="btn small" onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}>Flip</button>
      </div>
      <div class="pad" style="margin-top:10px">
        <div class="field" style="margin:6px 0">
          <label>Side to move</label>
          <div class="chips">
            {(['w', 'b'] as const).map((t) => (
              <button class={`chip ${parts.turn === t ? 'on' : ''}`} onClick={() => update({ ...parts, turn: t, ep: '-' })}>
                {t === 'w' ? 'White' : 'Black'}
              </button>
            ))}
          </div>
        </div>
        {possible && (
          <div class="field" style="margin:6px 0">
            <label>Castling rights</label>
            <div class="chips">
              {[...possible].map((c) => (
                <button
                  class={`chip ${parts.castling.includes(c) ? 'on' : ''}`}
                  onClick={() =>
                    update({
                      ...parts,
                      castling: 'KQkq'.split('').filter((x) => (x === c ? !parts.castling.includes(c) : parts.castling.includes(x))).join(''),
                    })
                  }
                >
                  {{ K: 'White O-O', Q: 'White O-O-O', k: 'Black O-O', q: 'Black O-O-O' }[c]}
                </button>
              ))}
            </div>
          </div>
        )}
        {eps.length > 0 && (
          <div class="field" style="margin:6px 0">
            <label>En-passant square</label>
            <div class="chips">
              {['-', ...eps].map((e) => (
                <button class={`chip ${parts.ep === e ? 'on' : ''}`} onClick={() => update({ ...parts, ep: e })}>
                  {e === '-' ? 'None' : e}
                </button>
              ))}
            </div>
          </div>
        )}
        {check.errors.length > 0 && (
          <ul class="small" style="color:var(--red);padding-left:18px;margin:6px 0">
            {check.errors.map((e) => (
              <li>{e}</li>
            ))}
          </ul>
        )}
        {check.ok && check.warnings.length > 0 && <p class="small" style="color:var(--orange);margin:6px 0">{check.warnings.join(' ')}</p>}
        <p class="small muted" style="word-break:break-all;margin:4px 0">
          <code>{join(parts)}</code>
        </p>
      </div>
    </div>
  );
}
