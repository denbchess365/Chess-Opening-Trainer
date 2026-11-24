import { signal } from '@preact/signals';

export interface Route {
  name: 'home' | 'build' | 'practice' | 'stats' | 'settings' | 'review' | 'positions' | 'position' | 'playout' | 'analysis' | 'position-lines' | 'position-practice';
  params: Record<string, string>;
}

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [name, id] = path.split('/');
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(query));
  if (id) params.id = decodeURIComponent(id);
  const valid = ['build', 'practice', 'stats', 'settings', 'review', 'positions', 'position', 'playout', 'analysis', 'position-lines', 'position-practice'];
  return { name: (valid.includes(name) ? name : 'home') as Route['name'], params };
}

export const route = signal<Route>(parse());
window.addEventListener('hashchange', () => (route.value = parse()));

export function go(path: string) {
  location.hash = '#/' + path;
}
