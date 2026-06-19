// Downloads the official Tiny Epic Galaxies VASSAL module and extracts the card,
// dice, mat, and ship-token images into public/. We do NOT redistribute these
// copyrighted images — each user fetches them from VASSAL themselves by running
// this script (`npm run setup-assets`).
import AdmZip from 'adm-zip';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const VMOD_URL = 'https://obj.vassalengine.org/images/0/00/Tiny_Epic_Galaxies_0.2.vmod';
const COLORS = ['blue', 'green', 'red', 'yellow', 'black'];

async function main() {
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
  console.log('Done — start the app with `npm run dev`.');
}

main().catch((err) => {
  console.error('\nAsset setup failed:', err.message);
  console.error('Check your internet connection and that the VASSAL URL is reachable.');
  process.exit(1);
});
