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
| `https://tablebase.lichess.ovh` | `GET /standard?fen=…` | During play-outs with ≤ 7 pieces, if "Use the Lichess tablebase" is on (default) | none |
| `https://api.github.com` | Gist create/update/list revisions/get revision | Auto-backup after sessions / on hide, "Back up now", "Restore from Gist", "Test connection" | fine-grained token, `Authorization: Bearer`, only to this origin |

- **Lichess:**
  - One request at a time.
  - After HTTP 429, wait at least 60 s (`cooldownUntil`, shown in the UI).
  - No custom request headers: browsers forbid `User-Agent`, and any other custom header would add a CORS preflight.
  - **CORS** was verified from the real origin `https://denbchess365.github.io`: a browser request got HTTP 200 with response type `cors`.
- **Tablebase:**
  - One request at a time; after HTTP 429, wait 60 s.
  - Offline, after an error, or while waiting, Stockfish is used instead.
  - Responses aren't cached by the service worker (the browser's own HTTP cache may keep them, per the server's headers).
  - CORS was verified (`access-control-allow-origin: *`).
- **Content Security Policy** (meta tag in `index.html`):
  - `default-src 'self'` and `script-src 'self' 'wasm-unsafe-eval'` (Stockfish WebAssembly, no inline scripts).
  - `connect-src 'self' https://lichess.org https://api.github.com https://tablebase.lichess.ovh`.
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

## Data model (IndexedDB `repertoire-trainer`, schema v3)

| Store | Key | Contents |
|---|---|---|
| `repertoires` | `id` | `{ id, name, side: 'w'\|'b', createdAt, startFen?, kind?: 'opening'\|'position', positionId? }`. A `position` repertoire is the hidden line set of one saved position (Mode B); its tree starts at `startFen`. |
| `moves` | `id` | `{ id, repertoireId, fromFen, toFen, san, uci, isMine, isPrimary, comment, createdAt }`. Positions are normalized FENs (no clocks; en passant only if capturable). |
| `cards` | `moveId` | FSRS state plus `wrong`/`right` counters, for my main moves |
| `reviewLogs` | auto | `{ moveId, repertoireId, ts, grade }` |
| `kv` | `key` | settings, meta, `lichess` prefs. **Device-local keys** start with `secret:` (GitHub token) or `local:` (Gist id, sync state, device name). They are never exported, snapshotted or overwritten by a restore. |
| `lichessGames` (v2) | `id` | `{ id, user, playedAt, myColor, opponent, myRating, oppRating, result, speed, rated, eco, openingName, moves (SAN), evals?, analyzedAt }` |
| `findings` (v2) | `id` (= gameId) | `{ gameId, repertoireId, fen, ply, type: deviation\|gap\|outOfBook\|followed, playedSan, playedUci, expectedSan?, evalPlayed?, evalBest?, bestSan?, severity?, evalSource?, status: new\|drilled\|added\|dismissed }` |
| `positions` (v3) | `id` | `{ fen (full, clocks kept), title, note, tags[], collectionId, goal: win\|draw\|bestMove, mySide, practiceModes: (playOut\|lines)[], source, repertoireId?, createdAt }` |
| `collections` (v3) | `id` | `{ name, createdAt }` |
| `practiceRuns` (v3) | `id` | `{ positionId?, startFen, moves[] (UCI, both sides), result, reason, success, hintsUsed, movesTaken, engineDtm?, evals?, grade?, finishedAt }` |
| `snapshots` (v2) | auto | `{ createdAt, reason, json (backup format), summary }`, newest 5 kept |

Migrations live in `src/db/schema.ts` (`MIGRATIONS[n]` upgrades version n to n+1). They only add data.

## Backup format (v3)

```json
{ "app": "repertoire-trainer", "schemaVersion": 3, "appVersion": "3.0.0", "exportedAt": "…",
  "deviceLabel": "iPhone", "gamesIncluded": true,
  "data": { "repertoires": [], "moves": [], "cards": [], "reviewLogs": [], "kv": {}, "lichessGames": [], "findings": [],
            "positions": [], "collections": [], "practiceRuns": [] } }
```

- **Shared format:** the same file is used for manual export, the Gist and local snapshots.
- **Never contains secrets:** device-local `kv` keys are stripped both when writing and when reading.
- **Older files:** `parseBackup` migrates older versions step by step (`MIGRATE[1]` adds empty
  games/findings, `MIGRATE[2]` adds empty positions/collections/runs), then validates everything before any write:
  - structure and types, and unique ids
  - every move belongs to a repertoire, its FEN is valid, it is legal, and it leads to `toFen`
  - the right side is to move
  - cards point to existing moves, or to existing positions for `pos:<id>` play-out cards (orphans are dropped with a warning)
  - every saved position is legal (same checks as the editor)
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

## Positions & play-outs

- **Validation** (`core/positions.ts`):
  - exactly one king per side
  - the side not to move is not in check
  - no pawns on the 1st/8th rank
  - at most 8 pawns and 16 pieces per side
  - impossible castling rights and en-passant squares are removed with a warning
- **Mode A cards:** the play-out card of a position is `cards['pos:<positionId>']` (repertoireId
  `positions`), scheduled by the same FSRS code as move cards.
- **Grading:**
  - fail = Again
  - success with hints or takebacks, or with more than `dtm + max(3, ⌈dtm/4⌉)` moves = Hard
  - clean success = Good
  - Best-move goal: correct = Good (Hard with a hint), wrong = Again.
- **End rules** (`core/playout.ts`):
  - **Win:** success only by checkmate. Stalemate, insufficient material, threefold repetition, the
    50-move rule (halfmove clock ≥ 100), being mated, or a move that turns a forced mate into an
    evaluation below +2 are fails.
  - **Draw:** success by stalemate, threefold repetition, insufficient material or the 50-move rule.
    Being mated is a fail.
- **Defender:**
  - The tablebase's first move (sorted best-first, so the longest defence when losing) when enabled,
    online and ≤ 7 pieces.
  - Otherwise Stockfish at `defenderDepth` (≥ 24 with ≤ 5 pieces, time-capped), with a ~0.65 s
    minimum delay before the move is shown.
  - Move feedback reuses the defender's evaluation of the position after my move.
- **Mode B:** a position's lines live in a hidden repertoire with `startFen`. `RepGraph.root` replaces
  the hard-coded start position in the tree walk, gap detection, line building, delete reachability,
  Build and the drill.
- **Daily mix** (`planDaily`):
  - `round(dailySize × ratio)` slots go to due position items (play-out cards and position line moves,
    most urgent first); the rest go to opening moves.
  - Whichever side runs short is filled by the other.
  - Lines are drilled first, then the play-outs run as a queue.
- **Future (not built):** a random KBN position generator would just produce FENs for the same
  play-out flow; nothing else needs to change.
