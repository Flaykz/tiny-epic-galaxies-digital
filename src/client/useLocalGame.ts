import { useEffect, useRef, useSyncExternalStore } from 'react';
import { LocalEngine, type LocalSeat } from './localEngine.js';
import type { GameState } from '../engine/index.js';

export interface LocalGameConfig {
  seats: LocalSeat[];
  seed: number;
  rogueDifficulty?: 'beginner' | 'advanced';
  rogueCard?: import('../engine/index.js').RogueCardId;
  /** A saved game picked up on load (see gameSave.ts) — resumes play from
   *  here instead of starting a fresh game from `seed`. */
  resumedState?: GameState;
}

/** React binding around LocalEngine. Re-renders whenever the game state changes. */
export function useLocalGame(config: LocalGameConfig) {
  const engineRef = useRef<LocalEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new LocalEngine(config.seats, config.seed, undefined, config.rogueDifficulty, config.rogueCard, config.resumedState);
  }
  const engine = engineRef.current;

  useEffect(() => () => engine.dispose(), [engine]);

  useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.state,
  );

  return engine;
}
