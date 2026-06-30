import { useEffect, useRef, useSyncExternalStore } from 'react';
import { LocalEngine, type LocalSeat } from './localEngine.js';

export interface LocalGameConfig {
  seats: LocalSeat[];
  seed: number;
  rogueDifficulty?: 'beginner' | 'advanced';
}

/** React binding around LocalEngine. Re-renders whenever the game state changes. */
export function useLocalGame(config: LocalGameConfig) {
  const engineRef = useRef<LocalEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new LocalEngine(config.seats, config.seed, undefined, config.rogueDifficulty);
  }
  const engine = engineRef.current;

  useEffect(() => () => engine.dispose(), [engine]);

  useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.state,
  );

  return engine;
}
