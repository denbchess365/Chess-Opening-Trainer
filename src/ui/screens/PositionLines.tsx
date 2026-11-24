import { useEffect, useState } from 'preact/hooks';
import { ensureLinesRepertoire, positionById } from '../../state/store';
import { go } from '../router';

/** Opens Build for a position's line set (creating it on first use). */
export function PositionLines(props: { id: string }) {
  const [error, setError] = useState('');
  useEffect(() => {
    const p = positionById(props.id);
    if (!p) return setError('Position not found.');
    ensureLinesRepertoire(p).then((r) => {
      history.replaceState(null, '', `#/build/${r.id}`);
      go(`build/${r.id}`);
    });
  }, []);
  return <div class="screen"><div class="card">{error || 'Opening lines…'}</div></div>;
}
