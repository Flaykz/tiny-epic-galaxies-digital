import { tegAdapter, type GameState, type RogueCardId } from '../engine/index.js';
import type { LocalSeat } from './localEngine.js';

const STORAGE_KEY = 'teg-local-save-v1';

/** Everything needed to resume a local/solo game after a reload: the seat
 *  config (control: human/ai — not itself part of GameState) plus the live
 *  GameState. `seed` and rogueDifficulty/rogueCard are kept only so the saved
 *  shape matches Mode 1:1; resuming replays `state` as-is, it never re-derives
 *  from them. */
export interface SavedGame {
  seats: LocalSeat[];
  seed: number;
  rogueDifficulty?: 'beginner' | 'advanced';
  rogueCard?: RogueCardId;
  state: GameState;
  /** tegAdapter.schemaVersion at save time, so a later reload with a newer
   *  build can migrate an older save via tegAdapter.migrate(). */
  schemaVersion: number;
}

/** Persist the current local/solo game so a reload can resume it instead of
 *  dropping back to the lobby (see App.tsx). Called on every state change;
 *  best-effort — a full or unavailable store (private browsing) just means
 *  no resume, not a crash. */
export function saveLocalGame(saved: Omit<SavedGame, 'schemaVersion'>): void {
  try {
    const full: SavedGame = { ...saved, schemaVersion: tegAdapter.schemaVersion ?? 1 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch {
    // ignore
  }
}

/** Forget the in-progress game — call when the player deliberately leaves it
 *  (the "← Lobby" button), so a later reload starts at the lobby again. */
export function clearLocalGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Load a previously saved game, if any, migrating its GameState in case the
 *  schema moved on since it was saved (same adapter used for the old async
 *  multiplayer KV store). Returns null on anything unexpected rather than
 *  throwing — a corrupt/foreign save should never block the app at startup. */
export function loadLocalGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    if (!parsed?.state || !Array.isArray(parsed.seats)) return null;
    if (tegAdapter.migrate) parsed.state = tegAdapter.migrate(parsed.state, parsed.schemaVersion ?? 1);
    return parsed;
  } catch {
    return null;
  }
}
