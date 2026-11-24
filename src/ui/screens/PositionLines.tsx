import { useEffect, useState } from 'preact/hooks';
import { ensureLinesRepertoire, positionById } from '../../state/store';

/** Opens Build for a position's line set (creating it on first use). */
export function PositionLines(props: { id: string }) {
  const [error, setError] = useState('');
  useEffect(() => {
    const p = positionById(props.id);
    if (!p) return setError('Position not found.');
    // Replace this history entry so Back returns to the position, not to this redirect.
    ensureLinesRepertoire(p).then((r) => location.replace(`#/build/${r.id}`));
  }, []);
  return <div class="screen"><div class="card">{error || 'Opening lines…'}</div></div>;
}
