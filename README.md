# Repertoire Trainer

A personal, offline chess opening trainer for iPhone (and any modern browser).
Build your White and Black repertoires on a board and analyse them with Stockfish.
Then drill them with spaced repetition (FSRS), the way Chessbook does.

- **No accounts, no ads, no analytics, no server.** Everything is stored on your phone (IndexedDB).
- **Works offline** after the first visit. The app, the chess engine and the opening book are all cached on the device.
- **Optional network features**, only when you set them up or press a button. They talk to three hosts:
  `lichess.org` (reading your public games), `api.github.com` (backing up to your own secret Gist) and
  `tablebase.lichess.ovh` (perfect endgame defence during play-outs; can be switched off).
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
- **Review your online games:** sync your Lichess games and see where you left your repertoire,
  which opponent replies surprised you, and how you score with each opening (weakest first).
- **Positions & endgames:** set up any position (e.g. king + bishop + knight vs king), play it out
  against the engine, or build and drill lines from it. Spaced repetition included.
- **Backups:** automatic backups to a secret GitHub Gist, local snapshots before risky changes,
  and a manual export to Files / iCloud Drive.
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
There are three layers of protection. Use at least one of the first two.

### a) Automatic backup to a secret GitHub Gist (recommended)

A Gist is a small file hosted on your GitHub account. GitHub keeps every version of it, so you
can go back to any earlier backup.

**Create the token (one time, about 3 minutes):**

1. On github.com, tap your profile picture → **Settings**.
2. Scroll to the bottom → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**.
3. **Generate new token**. Name: `Repertoire Trainer backup`.
4. **Expiration:** 90 days is a good balance. When it expires the app shows
   "GitHub rejected the token". Make a new one and paste it in.
5. **Repository access:** leave the default. No repository access is needed.
6. **Permissions → Account permissions → Gists: Read and write.** Leave everything else at "No access".
7. **Generate token**, copy it (it starts with `github_pat_`).
8. In the app: **Settings → GitHub Gist backup**, paste it, and tap **Save token**. The app checks
   the token with GitHub before saving it.

**What happens then:**

- The first backup creates one **secret** Gist with a file called `repertoire-backup.json`. Later
  backups update the same Gist, and GitHub keeps the revision history.
- A backup runs automatically at the end of each practice session, when you leave Build, and when
  the app goes to the background, but only if something changed, and at most once every 5 minutes.
  **Back up now** forces one.
- The Home screen shows "Last backup: 2 hours ago ✓", or the reason it failed (offline, token
  expired, rate limited). Failed backups are retried automatically when you're back online.
- Raw Lichess games are left out of Gist backups by default to keep them small, because you can
  re-sync them. Your review decisions (findings) are always included.

**Security notes:**

- The token is stored only in this app's storage on this phone. It is never written to exports,
  backups or snapshots, and it is only ever sent to `api.github.com`.
- It is not encrypted on the device: a web app has no keychain. That's why the token should allow
  nothing but Gists and should expire.
- "Secret" Gists are unlisted, not private. Anyone with the link can read them, so don't share the link.
- **Remove token** in Settings deletes it from the phone. To revoke it completely, delete it on GitHub
  under Developer settings.

**Restore from the Gist** (for example on a new phone):

1. Install the app and add the token as above.
2. Go to **Settings → Restore from Gist…**. The app finds your backup Gist and lists recent
   revisions with their dates and contents (repertoires, moves, cards, games).
3. Tap one to see a preview, then **Restore**.

### b) Manual export to Files / iCloud Drive

- **Settings → Export backup** opens the share sheet. Choose **Save to Files** (iCloud Drive is a good place).
  The file `repertoire-backup-YYYY-MM-DD.json` contains your moves, comments, progress, settings,
  review findings and (unless you choose the smaller export) Lichess games.
- **Settings → Restore…** → pick the file.
- If neither kind of backup has happened in 7 days, Home shows a "Back up your repertoire" banner.
  You can dismiss it for a day.

### c) Local snapshots (automatic)

Before every restore, PGN import and bulk delete (deleting a repertoire, or 5 or more moves at
once), the app saves a snapshot of your current data on the phone. The newest 5 are kept.
**Settings → Snapshots → Restore** undoes a mistake. Snapshots live on the same phone, so they are
not a substitute for a real backup.

### How restoring works (all three kinds)

1. The file is read and **checked completely before anything is written**:
   - the structure, and that every move is legal and belongs to a repertoire
   - that cards point to real moves
   - that it isn't from a newer app version
2. Older backup formats (for example v1 files from the first version of the app) are upgraded automatically.
3. A snapshot of your current data is saved.
4. Everything is written in a single database transaction. If anything fails, nothing changes.

Your GitHub token, the linked Gist and other device settings are never overwritten by a restore.

### PGN

- **Settings → Import PGN…** adds games or studies (variations included) to a repertoire.
- PGN import is all-or-nothing. If a move is illegal, nothing is imported and you see the problems,
  with an option to import only the valid lines.
- **Export "…" as PGN** writes a repertoire as one PGN with variations, which you can open in
  Lichess, ChessBase, etc. PGN only holds moves and comments, not practice progress, so use the JSON
  backup for full backups.

## 4. Review your Lichess games

1. **Settings → Lichess:** enter your Lichess username. You don't need a token, because your games are public.
   Choose the game types (default: blitz, rapid, classical), whether to include rated games only,
   and how many games to fetch per sync (default 50, max 200).
2. Tap **Sync games** (on Home or in Settings).
   - The app asks Lichess for games newer than the last one it has, and reads them as they arrive.
   - Games it already has are skipped.
   - It sends one request at a time. If Lichess says "too many requests", the button shows a
     countdown and waits at least 60 seconds.
   - **Sync automatically when the app opens** is off by default. Even when it's on, syncs happen at most once an hour.
3. Each game is compared with your repertoire for your colour, move by move from the start, stopping at the first event:
   - **You left your repertoire:** you played something other than your main move.
     - **Drill this** counts a lapse and practises it now.
     - **My move was better** makes your game move the main move and keeps the old one as an alternative.
     - **Dismiss** hides it.
   - **Opponent surprise:** they played a move you haven't prepared for.
   - **New position to prepare:** it was your move and your repertoire had nothing for it.
   - For the last two you get the engine's top 3 moves and the book moves.
     - **Add to repertoire** opens Build at that position. The next move you play there is saved
       together with the line leading to it.
     - **Dismiss** hides it.
   - Games that stay in your lines count as successes.
4. **Engine check** (on by default):
   - If Lichess already analysed the game, its evaluations are used.
   - Otherwise Stockfish evaluates the position in the background (depth 15 by default), one at a time.
   - Each mistake is labelled by how much it lost: an inaccuracy (more than 0.5 pawns), a mistake
     (more than 1.0) or a blunder (more than 2.0).
5. **Performance by opening** shows your score by repertoire line or by ECO opening, weakest first.
   Tap a line to open it in Build.

Every item has a status (new / drilled / added / dismissed), so you won't see the same one twice.
If you change your repertoire so that an item is answered, it disappears from the list.
**Settings → Re-check all games** compares all stored games with your current repertoire again.

## 5. Positions & endgame training

Open **Positions** from the Home screen.

### Getting positions in
- **+ Add → Set up on the board:**
  - Tap a piece in the palette (white pieces on top, black below), then tap squares to place it.
    Tap the same piece again to remove it.
  - **✋** lets you drag pieces (drag one off the board to delete it), and **🗑** erases.
  - Below the board: **Clear**, **Start position**, **Flip**, side to move, castling rights (only offered
    when the king and rook are on their home squares) and the en-passant square.
  - Mistakes are listed in plain words, for example "Black is in check but it's White's move", and
    **Save** stays disabled until the position is legal.
- **Paste a FEN**, or **From a PGN**: the main line of the first game, final position by default.
  Use the slider to pick any move.
- **💾 Save position** in Build (⋯ menu), in the Lichess review and on the analysis board.
- **⧉ Duplicate & edit** copies a saved position into the editor. Change a piece or two and save it as
  a new position, for example the same KBN setup with the defending king somewhere else.
- **Collections, tags and a note:** group positions ("KBN mates", "Rook endgames", …) and filter by
  collection, tag, goal or material (e.g. `KBNvK`).
- Every position has a **goal** (win by mate, hold the draw, or find the best move), the side you play,
  and how it's practised: **⚔︎ Play it out**, **📖 Drill lines**, or both.

### ⚔︎ Play it out against the engine
- **Where:** from a saved position, from any position in Build (⚔︎ next to the move buttons), from a
  drill (from the position after your last answer; the drill waits for you), from the Lichess review,
  or from the analysis board. If the position isn't saved, you pick the goal.
- **How the engine defends:** at full strength. With 7 or fewer pieces it uses the **Lichess tablebase**
  when you're online (Settings → Positions; on by default), which gives perfect defence and the exact
  mate distance. Offline, or with the tablebase off, it uses Stockfish, searching deeper with 5 or
  fewer pieces.
- **Rules:**
  - **Win:** only checkmate counts. Stalemate, the 50-move rule, threefold repetition and losing the
    material needed to mate are fails, each with a clear message. So is a move that turns a forced
    mate into an evaluation below +2.
  - **Draw:** you succeed with stalemate, threefold repetition, insufficient material or the 50-move rule.
    Getting mated is a fail.
  - **Best move:** one move. The engine's move counts, and so does any move that keeps the mate or
    loses at most 0.3 pawns.
- **On screen:** a move counter and a 50-move counter, **💡 Hint** (an arrow), **↶ Takeback**,
  **⟲ Restart** and **⚑ Give up**. Hints and takebacks lower the grade.
- **Move feedback** (after each move, at the end, or off) tells you gently if your move made the mate
  noticeably longer or threw the win away.
- **At the end:**
  - the result, your number of moves vs. the engine's mate distance, and the hints used
  - **Review game**, to step through the moves with evaluation notes
  - **💾 Save the starting position**, if it isn't saved yet
  - **📖 Add my moves as a line**, which turns the game into a line you can drill
- **Grading:** a clean success is Good. Success with hints, or with many more moves than the engine
  needs (more than its mate distance + max(3, 25%)), is Hard. A fail is Again.

### 📖 Drill lines from a position
Lines from a position work exactly like your openings, but start at the position.
- **📖 Build lines** opens Build at the position, with the engine panel, book-free.
- **🎯 Drill lines** quizzes your moves, and the opponent's moves play automatically.

### Practice & scheduling
- Every saved position you play out has its own spaced-repetition card, and every move of yours in
  its lines is a card too.
- **Daily practice** mixes in due positions (Settings → Positions: on/off and a 90/10 … 50/50 mix). If
  either side doesn't have enough due items, the other fills in. The lines are drilled first, then the
  positions are played out.
- **Practice positions** (on the Positions screen) lets you choose a collection, play-outs and/or lines,
  and due-only or everything.
- **Stats** shows each position's success rate, and for wins a chart of how many moves you needed
  over time against the engine's mate distance.
- A short **bishop + knight mating guide** appears with KBN positions.

## 6. How the drill works

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
npm test           # unit tests (tree, scheduler, practice, PGN, backups, Gist, Lichess, review, positions, play-outs)
npm run build      # production build in dist/ (also regenerates the opening book JSON)
npm run preview    # serve dist/ locally
```

Project layout:

```
src/core/      pure logic: FEN helpers, repertoire graph, FSRS wrapper, practice sessions, PGN,
               backup format/validation/migration, ndjson reader, Lichess mapping, game review
src/db/        IndexedDB schema (versioned, forward-only migrations) and data access
src/net/       network clients: github.ts (Gist API; the only code that sees the token), lichessClient.ts
src/state/     app state (Preact signals) and actions; gistBackup, lichessSync, review
src/engine/    Stockfish Web Worker wrapper (UCI, MultiPV) and the background evaluation queue
src/ui/        board, dialogs, screens (Home, Build, Practice, Review, Stats, Settings)
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
- **Network & privacy:** see [SPEC.md](SPEC.md). In short:
  - A Content Security Policy only allows requests to `lichess.org`, `api.github.com` and
    `tablebase.lichess.ovh`, and blocks inline scripts.
  - The service worker never touches or caches those requests.
  - All text from Lichess is rendered as plain text (no HTML injection).
  - The GitHub client refuses to send the token anywhere except `api.github.com`.
  - The optional tablebase (`tablebase.lichess.ovh`) only receives the position, one request at a time.
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
