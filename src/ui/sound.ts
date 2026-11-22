import { settings } from '../state/store';

// Move sounds are synthesized with Web Audio: tiny, offline, and no audio files to license.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!settings.value.sound) return null;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** iOS only allows audio after a user gesture: unlock on the first touch. */
export function unlockAudioOnGesture() {
  const unlock = () => {
    const a = audio();
    if (a) {
      const b = a.createBuffer(1, 1, 22050);
      const s = a.createBufferSource();
      s.buffer = b;
      s.connect(a.destination);
      s.start(0);
    }
    window.removeEventListener('touchend', unlock);
    window.removeEventListener('click', unlock);
  };
  window.addEventListener('touchend', unlock);
  window.addEventListener('click', unlock);
}

function knock(freq: number, dur: number, gain: number, when = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + when;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function playMoveSound(san: string) {
  if (san.includes('x')) {
    knock(260, 0.09, 0.35);
    knock(180, 0.08, 0.25, 0.04);
  } else knock(320, 0.07, 0.3);
}
export function playGood() {
  knock(660, 0.12, 0.15);
  knock(880, 0.16, 0.15, 0.08);
}
export function playBad() {
  knock(200, 0.25, 0.2);
}
