import { createContext, useContext, useEffect, useState } from 'react';
import { useVmodAssets, type VmodManifest, type VmodAssetsApi } from 'digital-boardgame-framework/client';

// Maps the asset URLs the app references → entry names inside the TEG VASSAL
// module (.vmod zip). Used by the framework's in-browser loader so users supply
// their own art instead of us redistributing it.
const COLORS = ['blue', 'green', 'red', 'yellow', 'black'] as const;
const files: Record<string, string> = {};
for (let i = 1; i <= 40; i++) files[`/cards/cp${i}.jpg`] = `images/cp${i}.jpg`;
const DICE: Record<string, string> = {
  move: 'dice-rocket', energy: 'dice-energy', culture: 'dice-culture',
  diplomacy: 'dice-diplomacy', economy: 'dice-economy', colony: 'dice-colony',
};
for (const [face, src] of Object.entries(DICE)) files[`/dice/${face}.jpg`] = `images/${src}.jpg`;
for (const c of COLORS) {
  const C = c[0].toUpperCase() + c.slice(1);
  files[`/mats/pads-${c}.jpg`] = `images/pads-${c}.jpg`;
  files[`/ships/${c}-rocket.png`] = `images/ps${C}Rocket.png`;
  files[`/ships/${c}-level.png`] = `images/ps${C}Level.png`;
}

export const TEG_MANIFEST: VmodManifest = { files };
export const VMOD_URL = 'https://obj.vassalengine.org/images/0/00/Tiny_Epic_Galaxies_0.2.vmod';

/** Asset access for the UI: a path resolver plus an `artless` flag that turns on
 *  the text/lo-fi rendering when no art is available. */
export interface AssetCtx {
  resolve: (path: string) => string;
  artless: boolean;
}
export const AssetContext = createContext<AssetCtx>({ resolve: (p) => p, artless: false });
export const useAsset = () => useContext(AssetContext).resolve;
/** True when the game art isn't loaded — render the simplified text UI. */
export const useArtless = () => useContext(AssetContext).artless;

export interface GameAssets {
  ready: boolean;
  /** Render the simplified text UI (no art available, or forced via ?artless=1). */
  artless: boolean;
  /** Show the "load your VASSAL module" dialog (deployed build with no art). */
  needsSetup: boolean;
  /** Dismiss the setup dialog and play in text mode. */
  dismiss: () => void;
  /** Re-open the setup dialog (e.g. from a "Load art" button). */
  promptSetup: () => void;
  resolve: (path: string) => string;
  vmod: VmodAssetsApi;
}

/**
 * Combines a served-files probe with the framework's vmod loader. If the build
 * ships the art (local dev), assets resolve to the served paths and no dialog is
 * needed. Otherwise (art-free deploy) the user loads their own .vmod.
 */
export function useGameAssets(): GameAssets {
  const vmod = useVmodAssets(TEG_MANIFEST, { dbName: 'teg-vmod' });
  const [served, setServed] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setServed(true);
    img.onerror = () => setServed(false);
    img.src = '/cards/cp1.jpg';
  }, []);
  // ?artless=1 forces the text UI (for testing/preview) without the setup dialog.
  const force = typeof location !== 'undefined' && new URLSearchParams(location.search).get('artless') === '1';
  const noArt = served === false && !vmod.ready;
  const ready = !force && (served === true || vmod.ready);
  const resolve = served === true ? (p: string) => p : vmod.resolve;
  // Show the dialog only until the user loads a module or chooses to skip.
  const needsSetup = !force && noArt && !dismissed;
  const artless = force || noArt;
  return {
    ready,
    artless,
    needsSetup,
    dismiss: () => setDismissed(true),
    promptSetup: () => setDismissed(false),
    resolve,
    vmod,
  };
}
