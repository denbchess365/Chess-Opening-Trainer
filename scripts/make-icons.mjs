// Dev-only helper: renders the app icons (PNG) with the pre-installed Chromium.
// Run once with `node scripts/make-icons.mjs`; the PNGs are committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// Uses the globally installed Playwright: NODE_PATH=$(npm root -g) node scripts/make-icons.mjs
const { chromium } = createRequire(import.meta.url)('playwright');

const css = readFileSync('node_modules/@lichess-org/chessground/assets/chessground.cburnett.css', 'utf8');
const m = css.match(/piece\.knight\.white \{\s*background-image: url\('data:image\/svg\+xml;base64,([^']+)'\)/);
const knight = 'data:image/svg+xml;base64,' + m[1];

function svg(size, pad) {
  const s = size, p = pad;
  const cell = (s - 2 * p) / 4;
  let squares = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
    squares += `<rect x="${p + c * cell}" y="${p + r * cell}" width="${cell}" height="${cell}" fill="${(r + c) % 2 ? '#739552' : '#ebecd0'}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="#161512"/>
  <g opacity="0.9">${squares}</g>
  <circle cx="${s / 2}" cy="${s / 2}" r="${(s - 2 * p) * 0.36}" fill="#161512" opacity="0.85"/>
  <image href="${knight}" x="${s * 0.22}" y="${s * 0.2}" width="${s * 0.56}" height="${s * 0.56}"/>
</svg>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(file, size, pad) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size, pad)}</body></html>`);
  writeFileSync(file, await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
}
await render('public/icons/icon-192.png', 192, 0);
await render('public/icons/icon-512.png', 512, 0);
await render('public/icons/apple-touch-icon.png', 180, 0);
await render('public/icons/icon-maskable-512.png', 512, 64);
writeFileSync('public/icons/icon.svg', svg(512, 0));
await browser.close();
