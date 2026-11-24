# Repertoire Trainer: technical spec

A single-user, offline-first chess opening trainer (PWA on GitHub Pages). This file records the
rules the code follows. The README is the user guide.

## Principles

- No backend, accounts, analytics or ads. All data lives in IndexedDB on the device.
- Everything works offline, except the two optional network features below. When the network
  fails, they show a friendly message and never lose or corrupt data.
- Every dependency is bundled or vendored. Nothing is loaded from a CDN.

## Network rules

| Host | Used for | When | Credentials |
|---|---|---|---|
| `https://lichess.org` | `GET /api/games/user/{name}` (ndjson) | "Sync games", "Test connection", or auto-sync on open if enabled (at most once an hour) | none (`credentials: 'omit'`) |
| `https://api.github.com` | Gist create/update/list revisions/get revision | Auto-backup after sessions / on hide, "Back up now", "Restore from Gist", "Test connection" | fine-grained token, `Authorization: Bearer`, only to this origin |

- **Lichess:**
  - One request at a time.
  - After HTTP 429, wait at least 60 s (`cooldownUntil`, shown in the UI).
  - No custom request headers: browsers forbid `User-Agent`, and any other custom header would add a CORS preflight.
  - **CORS** was verified from the real origin `https://denbchess365.github.io`: a browser request got HTTP 200 with response type `cors`.
- **Content Security Policy** (meta tag in `index.html`):
  - `default-src 'self'` and `script-src 'self' 'wasm-unsafe-eval'` (Stockfish WebAssembly, no inline scripts).
  - `connect-src 'self' https://lichess.org https://api.github.com`.
  - `style-src 'self' 'unsafe-inline'`, because the board positions pieces with inline styles.
  - `img-src 'self' data:`, `object-src 'none'`, `base-uri 'self'` and `form-action 'none'`.
  - `frame-ancestors` can't be set from a meta tag, and GitHub Pages doesn't allow custom headers.
- **Service worker:**
  - Workbox precaches the same-origin app shell (cache-first).
  - There are no runtime caching routes, so API requests bypass the service worker and are never cached.
- **Rendering:** all text from Lichess (names, opening names) is rendered as text by Preact. There is
  no `dangerouslySetInnerHTML` anywhere.
- **Links:** links to `lichess.org/{gameId}` open in the browser with `rel="noopener noreferrer"`,
  and `<meta name="referrer" content="no-referrer">` is set.

## Data model (IndexedDB `repertoire-trainer`, schema v2)

| Store | Key | Contents |
|---|---|---|
| `repertoires` | `id` | `{ id, name, side: 'w'\|'b', createdAt }` |
| `moves` | `id` | `{ id, repertoireId, fromFen, toFen, san, uci, isMine, isPrimary, comment, createdAt }`. Positions are normalized FENs (no clocks; en passant only if capturable). |
| `cards` | `moveId` | FSRS state plus `wrong`/`right` counters, for my main moves |
| `reviewLogs` | auto | `{ moveId, repertoireId, ts, grade }` |
| `kv` | `key` | settings, meta, `lichess` prefs. **Device-local keys** start with `secret:` (GitHub token) or `local:` (Gist id, sync state, device name). They are never exported, snapshotted or overwritten by a restore. |
| `lichessGames` (v2) | `id` | `{ id, user, playedAt, myColor, opponent, myRating, oppRating, result, speed, rated, eco, openingName, moves (SAN), evals?, analyzedAt }` |
| `findings` (v2) | `id` (= gameId) | `{ gameId, repertoireId, fen, ply, type: deviation\|gap\|outOfBook\|followed, playedSan, playedUci, expectedSan?, evalPlayed?, evalBest?, bestSan?, severity?, evalSource?, status: new\|drilled\|added\|dismissed }` |
| `snapshots` (v2) | auto | `{ createdAt, reason, json (backup format), summary }`, newest 5 kept |

Migrations live in `src/db/schema.ts` (`MIGRATIONS[n]` upgrades version n to n+1). They only add data.

## Backup format (v2)

```json
{ "app": "repertoire-trainer", "schemaVersion": 2, "appVersion": "2.0.0", "exportedAt": "…",
  "deviceLabel": "iPhone", "gamesIncluded": true,
  "data": { "repertoires": [], "moves": [], "cards": [], "reviewLogs": [], "kv": {}, "lichessGames": [], "findings": [] } }
```

- **Shared format:** the same file is used for manual export, the Gist and local snapshots.
- **Never contains secrets:** device-local `kv` keys are stripped both when writing and when reading.
- **Older files:** `parseBackup` migrates older versions step by step (`MIGRATE[1]` adds empty
  games/findings), then validates everything before any write:
  - structure and types, and unique ids
  - every move belongs to a repertoire, its FEN is valid, it is legal, and it leads to `toFen`
  - the right side is to move
  - cards point to existing moves (orphans are dropped with a warning)
  - games and findings are well formed
- **Rejected files:** a file from a newer app version is rejected.
- **Writing:**
  - `replaceAll` writes everything in one transaction, and any failure aborts it.
  - A snapshot is taken before every restore.
  - If a backup was made without games, the games already on the device are kept.
- **Gist:**
  - One secret Gist, holding `repertoire-backup.json`.
  - A backup larger than 700 KB is split into `repertoire-backup.partN.json` files. The Gist API
    truncates files above about 1 MB, and reading raw URLs would need another host. A truncated file is refused.
- **Auto-backup:**
  - A change counter goes up on every user-data write, and a persisted `dirty` flag survives restarts.
  - Backups run after practice/build sessions, on `visibilitychange: hidden`, and when back online.
  - They are debounced by 3 s and limited to one every 5 minutes; "Back up now" ignores the limit.

## Game review

`compareGame` walks the game's SAN moves from the start, by normalized FEN, and stops at the first event:

1. **My turn, move not saved, repertoire has a main move here:** `deviation` (expected = main move).
2. **Opponent's turn, move not saved:** `gap` if I had prepared other replies there, otherwise
   `followed` (my line simply ended).
3. **My turn, move not saved, no main move here:** `outOfBook`.
4. **End of game while still in book:** `followed`.

Some extra rules:
- Playing a saved alternative counts as staying in book.
- For each game, the repertoire of the game's colour that follows it longest is used.
- Re-analysis keeps earlier decisions when the same event is found again.
- Findings that a later repertoire change has already answered are hidden.

**Engine check** (deviation and outOfBook only):
- If the game has Lichess analysis, it is used. `evals[i]` is the position after ply i (White's view).
- Otherwise the Stockfish worker searches the position before and after the move at the configured
  depth, one at a time, and pauses while an engine panel is on screen.
- Loss in centipawns (capped at ±1500): more than 50 is an inaccuracy, more than 100 a mistake, more than 200 a blunder.
