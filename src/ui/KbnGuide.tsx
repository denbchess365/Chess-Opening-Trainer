/** Short guide to mating with king, bishop and knight against a lone king. Written for this app. */
export function KbnGuide(props: { open?: boolean }) {
  return (
    <details class="guide card" open={props.open}>
      <summary>How to mate with bishop + knight</summary>
      <p class="small muted" style="margin:6px 0">
        The lone king can only be mated in a corner whose colour matches your bishop’s squares. You have 50 moves without a
        capture or pawn move; good technique needs well under that, so there is no need to hurry.
      </p>
      <ol>
        <li>
          <b>Work as a team, centre first.</b> Bring your king towards the middle and keep the bishop and knight close to
          it. Single pieces can’t force anything here; the three together build a cage.
        </li>
        <li>
          <b>Push the king to the edge.</b> Use your king to take squares face-to-face (opposition) while the bishop and
          knight cover the squares diagonally and around it. Each move, ask: which squares can the king still go to, and how
          do I take one more?
        </li>
        <li>
          <b>Head for the right corner.</b> Once it is on the edge, drive it towards a corner of your bishop’s colour. The
          defender will usually run to the <i>wrong</i> corner, which is safe for it — that’s expected.
        </li>
        <li>
          <b>The “W” manoeuvre.</b> To force the king out of the wrong corner along the edge, the knight zig-zags in
          four hops that trace a W shape next to the edge, each hop covering the square the king wants next. Your bishop
          blocks the squares of its colour, often with a quiet waiting move to pass the turn, and your king follows along
          one rank or file further in so the defender can’t slip back.
        </li>
        <li>
          <b>Finish in the right corner.</b> With the defending king in the corner region, keep your king a knight’s jump
          away from the corner, let the knight cover the last flight square, and give mate with the bishop from a distance.
        </li>
      </ol>
      <p class="small" style="margin:6px 0">
        ⚠︎ <b>Watch for stalemate</b> near the edge and in the corner: before every move, check that the defending king still
        has a legal move (or is in check).
      </p>
    </details>
  );
}
