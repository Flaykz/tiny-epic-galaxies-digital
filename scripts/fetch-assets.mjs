// Downloads the official Tiny Epic Galaxies VASSAL module and extracts the card,
// dice, mat, and ship-token images into public/. We do NOT redistribute these
// copyrighted images — each user fetches them from VASSAL themselves by running
// this script (`npm run setup-assets`), or automatically via `--if-missing`
// (wired into `predev`/`prebuild` in package.json) so a fresh checkout "just
// works" without a manual setup step.
import AdmZip from 'adm-zip';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const VMOD_URL = 'https://obj.vassalengine.org/images/0/00/Tiny_Epic_Galaxies_0.2.vmod';
const COLORS = ['blue', 'green', 'red', 'yellow', 'black'];

// The full set of public/ paths this script populates — used both to extract
// them and, with --if-missing, to check whether that's already done without
// touching the network.
const ALL_PATHS = [
  ...Array.from({ length: 40 }, (_, i) => `cards/cp${i + 1}.jpg`),
  ...['move', 'energy', 'culture', 'diplomacy', 'economy', 'colony'].map((f) => `dice/${f}.jpg`),
  ...COLORS.flatMap((c) => [`mats/pads-${c}.jpg`, `ships/${c}-rocket.png`, `ships/${c}-level.png`]),
];

const ifMissing = process.argv.includes('--if-missing');

async function main() {
  if (ifMissing) {
    // DBF_NO_ASSETS builds deliberately ship without this art (see
    // vite.config.ts's publicDir toggle) — never auto-fetch for those, even
    // locally (that's what the flag is for when testing the art-free path).
    if (process.env.DBF_NO_ASSETS) {
      console.log('DBF_NO_ASSETS set — skipping asset auto-fetch.');
      return;
    }
    if (ALL_PATHS.every((rel) => existsSync(join(PUBLIC, rel)))) {
      console.log('Card/dice/mat/ship art already present in public/ — skipping fetch.');
      return;
    }
    console.log('Card art missing from public/ — fetching it automatically (run `npm run setup-assets` any time to redo this manually)...');
  }

  console.log(`Downloading VASSAL module from\n  ${VMOD_URL}`);
  const res = await fetch(VMOD_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));

  const read = (name) => {
    const entry = zip.getEntry(`images/${name}`);
    if (!entry) throw new Error(`Image not found in module: ${name}`);
    return entry.getData();
  };
  const write = (rel, data) => {
    const p = join(PUBLIC, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  };

  let n = 0;
  // 40 planet cards.
  for (let i = 1; i <= 40; i++) { write(`cards/cp${i}.jpg`, read(`cp${i}.jpg`)); n++; }
  // 6 dice faces.
  const dice = {
    'dice-rocket.jpg': 'dice/move.jpg',
    'dice-energy.jpg': 'dice/energy.jpg',
    'dice-culture.jpg': 'dice/culture.jpg',
    'dice-diplomacy.jpg': 'dice/diplomacy.jpg',
    'dice-economy.jpg': 'dice/economy.jpg',
    'dice-colony.jpg': 'dice/colony.jpg',
  };
  for (const [src, dst] of Object.entries(dice)) { write(dst, read(src)); n++; }
  // Galaxy mats + ship/level tokens, per player colour.
  for (const c of COLORS) {
    const C = c[0].toUpperCase() + c.slice(1);
    write(`mats/pads-${c}.jpg`, read(`pads-${c}.jpg`));
    write(`ships/${c}-rocket.png`, read(`ps${C}Rocket.png`));
    write(`ships/${c}-level.png`, read(`ps${C}Level.png`));
    n += 3;
  }

  console.log(`Extracted ${n} images into public/ (cards, dice, mats, ships).`);
  if (!ifMissing) console.log('Done — start the app with `npm run dev`.');
}

main().catch((err) => {
  console.error('\nAsset setup failed:', err.message);
  if (ifMissing) {
    // Don't block `npm run dev`/`build` over this — the app's own in-browser
    // "load your VASSAL module" dialog (src/client/assets.ts) still works as a
    // fallback, and text-mode play needs no art at all.
    console.error('Continuing without local art — run `npm run setup-assets` manually once you have a connection.');
    return;
  }
  console.error('Check your internet connection and that the VASSAL URL is reachable.');
  process.exit(1);
});
