import { go } from '../router';

export function Practice(_props: { params?: Record<string, string> }) {
  return (
    <div class="screen">
      <div class="topbar">
        <button class="btn icon ghost" onClick={() => go('')}>‹</button>
        <h1>Practice</h1>
      </div>
      <div class="card muted">Coming in a later milestone.</div>
    </div>
  );
}
