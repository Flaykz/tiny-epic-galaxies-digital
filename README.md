# Tiny Epic Galaxies — Digital Port

A digital implementation of Scott Almes' **Tiny Epic Galaxies** (Gamelyn Games),
built on the [`digital-boardgame-framework`](https://www.npmjs.com/package/digital-boardgame-framework).

- **Rules**: [official rulebook v9](https://www.gamelyngames.com/wp-content/uploads/2020/09/TEG_rulebook_v9.pdf)
- **Art**: the card, dice, mat, and ship-token images are the real components
  from the official [VASSAL module](https://obj.vassalengine.org/images/0/00/Tiny_Epic_Galaxies_0.2.vmod).
  **This project does not redistribute that copyrighted art.** Bring your own:
  - **In the app** (incl. the live deploy): an in-app dialog prompts you to
    download the VASSAL module and *choose* the `.vmod` — it's extracted in your
    browser and cached locally (IndexedDB), never uploaded. (Framework drop-in:
    `useVmodAssets` + `VmodSetupDialog`.)
  - **For local dev**, you can instead run `npm run setup-assets` to populate
    `public/`. Those asset folders are git-ignored.

## Play modes

| Mode | How |
| --- | --- |
| **Local hotseat** | 2–5 humans on one screen |
| **vs AI** | mix humans + greedy-heuristic AI players |
| **Solo (Rogue Galaxy)** | one human vs the automated Rogue opponent |
| **Async multiplayer** | server-backed games with per-seat invite links |

## Running

```bash
npm install

# One-time: download the card/dice/mat/ship art from the VASSAL module.
npm run setup-assets

# Local / AI / solo play (everything runs in the browser):
npm run dev            # http://localhost:5173

# Async multiplayer also needs the game server:
npm run server         # http://localhost:8787  (Vite proxies /api to it)

npm test               # engine unit + full self-play tests
npm run build          # production bundle
```

For multiplayer: open the app → **Multiplayer** → create a game → share each
seat's invite link. The server persists games to `.data/` via the framework's
`FsStore`, redacts opponents' secret missions per-seat, and validates turns.

## Deploying (GitHub Pages)

Local hotseat and solo-vs-Rogue-Galaxy run entirely in the browser, so a plain
static host is enough for those. `.github/workflows/deploy-pages.yml` builds
with `DBF_NO_ASSETS=1` (never redistribute the copyrighted VASSAL art — visitors
get the same in-app "bring your own module" dialog as local dev) and deploys
`dist/` via GitHub's official Pages actions on every push to `main`.

One-time repo setup: **Settings → Pages → Source → GitHub Actions**. The site
then serves from `https://<owner>.github.io/tiny-epic-galaxies-digital/` —
`vite.config.ts`'s `base` is set to that subpath for production builds.

Async multiplayer and the server-backed "report a problem" submission need the
`/api` backend (`npm run server`, or the Cloudflare Pages Functions in
`functions/api/`) — GitHub Pages can't serve those, so they won't work on this
deploy. The UI degrades gracefully: Multiplayer shows a "could not reach the
server" message, and reports fall back to a local file download.

### Offline / installable (PWA)

The site is installable and works fully offline for local hotseat and solo
play — useful when you don't always have internet. `vite-plugin-pwa`
(`vite.config.ts`) precaches the whole app shell on first visit; after that,
local/solo games start and run with zero network. An "📲 Install app" button
appears in the lobby once the browser considers the page installable (it
self-hides otherwise — notably on iOS Safari, which never offers the install
prompt API at all; there it's the manual Share → Add to Home Screen).

The service worker updates its cache silently in the background
(`registerType: 'autoUpdate'`) — the app's own "new version — Reload" banner
(bottom of the screen) is still what tells *you* a new build is live and lets
you choose when to reload; the two don't double-prompt.

App icons live in `app-icons/` (an original SVG-derived design, not VASSAL
art) and are always shipped regardless of `DBF_NO_ASSETS`/`publicDir` — see
the `copyAppIcons` plugin in `vite.config.ts` for why they need their own copy
step instead of just living in `public/`.

## Architecture

```
src/engine/        Pure game logic (framework-agnostic)
  types.ts           State + Action model
  planets.ts         40 planet cards (transcribed from the real art)
  missions.ts        12 secret missions
  empire.ts          Empire/upgrade track (dice, ships, VP, costs)
  setup.ts           Initial state + seeded dice rolls (Rng in state)
  helpers.ts         Movement, colonization, scoring, mission evaluation
  planetEffects.ts   Per-planet surface/colony action effects
  adapter.ts         GameAdapter: legalActions / applyAction / viewFor / result
  ai.ts              Greedy AI used for AI seats and the Rogue Galaxy
src/client/        Local engine driver, React hook, HTTP client, labels
src/ui/            React UI (lobby, board, multiplayer) + real card art
server/            Node GameServer over FsStore (async multiplayer)
tests/             Vitest engine + self-play tests
```

The engine is a pure, deterministic `GameAdapter<GameState, Action, string>`:
every action is fully specified and enumerable, randomness lives in a serialized
seeded RNG inside the state, so the same framework powers both local play and the
server with no game-specific server code.

## Faithfulness notes

Implemented to the rulebook: dice rolling by empire level, the six die actions
(move / acquire energy / acquire culture / advance diplomacy / advance economy /
utilize colony), orbiting & colonization, empire upgrades (4d/2s → 7d/4s),
the free-then-paid reroll, the Converter, **following** (pay 1 culture to copy an
action), 21-VP end trigger with a final round, secret-mission scoring, tie-breakers,
and the solo Rogue instant-win condition.

Pragmatic approximations (clearly marked in code/log):

- **Empire-track VP values** are read from the Galaxy Mat art; the per-level VP
  array in `empire.ts` is a single editable constant if you want to fine-tune it.
- **Some exotic planet surface actions** with ambiguous targeting use an
  auto-chosen target in this build (e.g. follow targets, multi-ship effects).
- The **Rogue Galaxy** uses the shared greedy AI rather than the precise
  "roll one die at a time" Rogue procedure from the solo rules.
- Following supplies an auto-chosen target for the copied action in the UI.

These are isolated in `planetEffects.ts` / `ai.ts` and don't affect the core loop.


## Feedback & contributions

The most useful thing you can send is an **in-game problem report** — the report
button inside the game. Filed while you're playing, it captures the game state and
context that make an issue reproducible, which helps far more than a code change.

**Pull requests generally won't be merged.** This is a solo-maintained project, and
reviewing and integrating outside code costs more than it saves. If you open a PR,
it'll be read as a well-specified bug report or feature request and implemented here
rather than merged — so it's a fine way to *describe* a change you'd like, just
please don't expect it to land as-is.

**The whole codebase is MIT-licensed** — fork it and do whatever you want: change
the rules, reskin it, build and ship your own version. No permission needed; that's
the point of the license.
