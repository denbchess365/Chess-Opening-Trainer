# Repertoire Trainer

A personal, offline chess opening trainer for iPhone (and any modern browser).
Build your White and Black repertoires on a board and analyse them with Stockfish.
Then drill them with spaced repetition (FSRS), the way Chessbook does.

- **No accounts, no ads, no analytics, no server.** Everything is stored on your phone (IndexedDB).
- **Works offline** after the first visit. The app, the chess engine and the opening book are all cached on the device.
- Installs to your home screen as an app (a "PWA").

## Features

- **Build:** play moves to grow your repertoire tree. Transpositions merge automatically.
  - On your turn you pick one **main move** (★, the move you get drilled on). You can also keep alternatives.
  - On your opponent's turn you add every reply you want to prepare for.
  - Comments, delete (with confirmation), and back/forward/jump navigation.
  - The opening name is shown under the board.
  - The **Gaps** tab lists opponent replies you haven't answered yet.
  - The **Book** tab shows common named replies from an offline opening book.
  - The **⚙︎ engine** button turns on Stockfish 19: an eval bar and the top 3 lines. Tap a line to play its first move.
- **Practice:** the app plays each line from the start and stops at your moves.
  - Modes: daily practice, everything due, moves you often get wrong, cram everything, or one opening.
  - Filters for White/Black and for a single repertoire.
  - Grading: wrong = Again, correct after a 💡 hint = Hard, correct = Good. A move counts as "mastered" once its review interval reaches 21 days.
- **Stats:** % complete, % mastered and due count for each repertoire, plus your most-missed moves (tap one to drill it).
- **Settings:**
  - JSON backup and restore, PGN import (with variations) and PGN export.
  - Board colors, piece set, light/dark mode, sound, engine depth/time, and daily practice size.
  - Reset progress, or delete a repertoire.

---

## 1. Put the app online with GitHub Pages (one-time setup)

GitHub builds the app and hosts it for free. The included workflow
(`.github/workflows/deploy.yml`) does the build. You only need to switch Pages on.

1. **Get the code onto the `main` branch.** The work was committed on the branch
   `claude/repertoire-trainer-chess-pwa-vhjb97`. On GitHub, open the repository and click
   **Pull requests → New pull request**. Choose `base: main` and `compare: claude/repertoire-trainer-chess-pwa-vhjb97`,
   then click **Create pull request** and **Merge pull request**.
   (If the repository has no `main` branch yet, go to **Settings → General → Default branch**
   and pick the branch you want, or create `main` from it in the **Branches** page.)
2. Open the repository's **Settings** tab, then **Pages** in the left sidebar.
3. Under **Build and deployment → Source**, choose **GitHub Actions**. You don't need to pick
   a template, because the workflow file already exists.
4. Open the **Actions** tab. A run called **Deploy to GitHub Pages** starts on every push to `main`.
   If you don't see one, click the workflow on the left, then **Run workflow**.
5. When the run has a green check, go back to **Settings → Pages**. Your address is shown at the top,
   for example `https://<your-user-name>.github.io/Chess-Opening-Trainer/`.

Every later push to `main` rebuilds and redeploys the app automatically. The next time you open
the app on your phone, the Home screen shows **"A new version is ready — tap to update."**

> Note: the repository must be public for GitHub Pages on a free account.
> Your chess data is never in the repository; it only lives on your phone.

## 2. Install it on your iPhone

1. Open **Safari** (it must be Safari) and go to your Pages address from step 1.
2. Wait a few seconds. A message "Ready to work offline" appears once everything is cached.
3. Tap the **Share** button (the square with an arrow pointing up).
4. Scroll down and tap **Add to Home Screen**, then **Add**.
5. Open **Repertoire** from your home screen. It runs full-screen and works in airplane mode.

## 3. Back up and restore your data

Your repertoires live only on the phone. **iOS can delete the storage of a home-screen web app
that you haven't opened for a few weeks**, and deleting the app removes its data too.
The Home screen reminds you when your last backup is more than 7 days old.

- **Back up:** Settings → **Export backup**. In the share sheet choose **Save to Files**
  (iCloud Drive is a good place) or AirDrop/Mail it to yourself. The file is named
  `repertoire-backup-YYYY-MM-DD.json` and contains everything: moves, comments, progress and settings.
- **Restore:** Settings → **Restore…** → pick the `.json` file. This **replaces** everything
  currently in the app (you'll be asked to confirm).
- **PGN:** Settings → **Import PGN…** adds games or studies (variations included) to a repertoire.
  **Export "…" as PGN** writes a repertoire as one PGN with variations, which you can open
  in Lichess, ChessBase, etc. PGN only holds moves and comments, not practice progress, so
  use the JSON backup for full backups.

## How the drill works

- Each of your **main moves** is a card. New cards are due right away.
- In a session the app plays a whole line from the starting position. It plays your opponent's
  moves (and any of your moves that aren't due) automatically, and stops when it's your turn
  on a due move.
- Correct → green flash, and the card is scheduled further out.
- Wrong → red flash and a green arrow. You then play the right move, and the card counts as a lapse.
- **💡 Hint** highlights the piece to move. A correct answer after a hint counts as "Hard".
- **I don't know — show me** shows the answer. It counts as "Again".
- If you play one of your saved *alternative* moves, you're asked for your main move, with no penalty.
- **Cram** and **One opening** quiz everything. Correct answers on cards that aren't due yet
  don't push their due dates further out, but mistakes still count.

---

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (tree logic, scheduler, practice sessions, PGN)
npm run build      # production build in dist/ (also regenerates the opening book JSON)
npm run preview    # serve dist/ locally
```

Project layout:

```
src/core/      pure logic: FEN helpers, repertoire graph, FSRS wrapper, practice sessions, PGN, backup
src/db/        IndexedDB schema (versioned, forward-only migrations) and data access
src/state/     app state (Preact signals) and actions
src/engine/    Stockfish Web Worker wrapper (UCI, MultiPV)
src/ui/        board, dialogs, screens (Home, Build, Practice, Stats, Settings)
public/engine/ Stockfish 19 lite single-threaded .js + .wasm (vendored)
data/          lichess chess-openings TSVs (vendored), converted at build time
scripts/       build-openings.mjs (build step), make-icons.mjs and vendor-pieces.mjs (one-off dev tools)
tests/         vitest unit tests
```

Design notes:

- **Positions are keyed by normalized FEN** (move clocks removed; en passant kept only when an
  en-passant capture is actually legal), so different move orders reaching the same position merge.
- **Stockfish:** the single-threaded "lite" build is used because GitHub Pages can't send the
  COOP/COEP headers the multi-threaded build needs. It starts the first time you turn the engine on.
- **Data safety:** the database has a schema version, and upgrades only add data. Backups record
  the schema version, and older backups are upgraded when you import them.
- `npm audit` reports moderate advisories in `glob`/`minimatch`. They come from Workbox's
  build tooling, run only at build time, and never ship in the app.

## Third-party software and licenses

This project is free software under the **GNU GPL v3** (see `LICENSE`), because it bundles
GPL-licensed components. Full license texts are in [`LICENSES/`](LICENSES/).

| Component | Use | License |
|---|---|---|
| [Stockfish](https://stockfishchess.org/) 19 via [stockfish.js](https://github.com/nmrugg/stockfish.js) (lite single-threaded build, NNUE net by Chris Bao) | chess engine | GPL-3.0 |
| [@lichess-org/chessground](https://github.com/lichess-org/chessground) | board UI | GPL-3.0-or-later |
| cburnett pieces (Colin M.L. Burnett) | default pieces | GPL-2.0-or-later |
| merida pieces (Armando Hernandez Marroquin), via lichess | piece set | GPL-2.0-or-later |
| chessnut pieces (Alexis Luengas), via lichess | piece set | Apache-2.0 |
| [chess.js](https://github.com/jhlywa/chess.js) | move legality, SAN/FEN | BSD-2-Clause |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | spaced-repetition scheduler | MIT |
| [Preact](https://preactjs.com/) and @preact/signals | UI | MIT |
| [idb](https://github.com/jakearchibald/idb) | IndexedDB wrapper | ISC |
| [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) | opening names and book | CC0 |
| Vite, vite-plugin-pwa, Workbox (build tools) | build and service worker | MIT |

Move sounds are generated in code with the Web Audio API, so there are no audio files.
