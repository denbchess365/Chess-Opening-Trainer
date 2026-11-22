import { signal } from '@preact/signals';

/** Set when a new app version has been downloaded; calling it activates it and reloads. */
export const updateReady = signal<(() => void) | null>(null);
