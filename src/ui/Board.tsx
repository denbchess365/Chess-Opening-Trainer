import { useEffect, useRef, useState } from 'preact/hooks';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { fullFen, inCheck, isPromotion, legalDests, turnOf } from '../core/fen';
import { settings } from '../state/store';

export interface BoardProps {
  /** Normalized or full FEN. */
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [string, string] | null;
  /** Which color the user may move; null = view only. Defaults to side to move. */
  movableColor?: 'white' | 'black' | 'both' | null;
  onMove?: (from: string, to: string, promotion?: string) => void;
  shapes?: DrawShape[];
  flash?: 'good' | 'bad' | null;
  /** Animation duration in ms. */
  animation?: number;
}

const PROMO = ['q', 'n', 'r', 'b'] as const;
const PROMO_NAME: Record<string, string> = { q: 'queen', n: 'knight', r: 'rook', b: 'bishop' };

export function Board(props: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [promo, setPromo] = useState<{ from: string; to: string; color: 'white' | 'black' } | null>(null);

  const config = () => {
    const p = propsRef.current;
    const turn = turnOf(p.fen) === 'w' ? 'white' : 'black';
    const color = p.movableColor === undefined ? turn : p.movableColor;
    return {
      fen: fullFen(p.fen).split(' ')[0],
      orientation: p.orientation,
      turnColor: turn as 'white' | 'black',
      check: inCheck(p.fen),
      lastMove: (p.lastMove ?? undefined) as Key[] | undefined,
      movable: {
        free: false,
        color: (color ?? undefined) as 'white' | 'black' | 'both' | undefined,
        dests: color ? (legalDests(p.fen) as Map<Key, Key[]>) : new Map(),
        showDests: true,
      },
      animation: { enabled: true, duration: p.animation ?? 200 },
      drawable: { enabled: false, visible: true, autoShapes: p.shapes ?? [] },
    };
  };

  useEffect(() => {
    api.current = Chessground(el.current!, {
      ...config(),
      coordinates: true,
      premovable: { enabled: false },
      predroppable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      highlight: { lastMove: true, check: true },
      addDimensionsCssVarsTo: el.current!,
      events: {
        move: (orig, dest) => {
          const p = propsRef.current;
          if (isPromotion(p.fen, orig, dest)) {
            setPromo({ from: orig, to: dest, color: turnOf(p.fen) === 'w' ? 'white' : 'black' });
          } else p.onMove?.(orig, dest);
        },
      },
    });
    const ro = new ResizeObserver(() => api.current?.redrawAll());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      api.current?.destroy();
    };
  }, []);

  useEffect(() => {
    api.current?.set(config());
  }, [props.fen, props.orientation, props.lastMove?.join(), props.movableColor]);

  useEffect(() => {
    api.current?.setAutoShapes(props.shapes ?? []);
  }, [JSON.stringify(props.shapes ?? [])]);

  const choose = (piece: string | null) => {
    const pr = promo;
    setPromo(null);
    if (pr && piece) props.onMove?.(pr.from, pr.to, piece);
    else api.current?.set(config()); // cancelled: put the pawn back
  };

  return (
    <div
      class={`board-wrap board-${settings.value.boardTheme} pieces-${settings.value.pieceSet} ${props.flash ? 'flash-' + props.flash : ''}`}
    >
      <div ref={el} class="cg-wrap" />
      {promo && (
        <div class="promo" onClick={() => choose(null)}>
          <div class="promo-box cg-wrap" onClick={(e) => e.stopPropagation()}>
            {PROMO.map((p) => (
              <button key={p} aria-label={PROMO_NAME[p]} onClick={() => choose(p)}>
                <piece class={`${PROMO_NAME[p]} ${promo.color}`} style="position:static;display:block;width:100%;height:100%" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
