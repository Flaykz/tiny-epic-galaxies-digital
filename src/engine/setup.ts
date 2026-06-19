import { Rng } from 'digital-boardgame-framework';
import type { Color, GameState, PlayerState, ShipLocation } from './types.js';
import { PLANETS } from './planets.js';
import { MISSIONS } from './missions.js';
import { empire, SHIP_COUNT } from './empire.js';

export const SCHEMA_VERSION = 1;

const COLORS: Color[] = ['blue', 'green', 'red', 'yellow', 'black'];

export interface SeatSpec {
  name: string;
  isRogue?: boolean;
}

export interface SetupOptions {
  seats: SeatSpec[]; // human/AI seats in seating order
  seed: number;
  /** Solo mode against the Rogue Galaxy. When true, exactly one seat should be isRogue. */
}

function initialShips(level: number): ShipLocation[] {
  const ships: ShipLocation[] = [];
  const unlocked = empire(level).ships;
  for (let i = 0; i < SHIP_COUNT; i++) {
    ships.push(i < unlocked ? { kind: 'galaxy' } : { kind: 'locked' });
  }
  return ships;
}

export function createInitialState(opts: SetupOptions): GameState {
  const rng = new Rng(opts.seed);
  const players: PlayerState[] = opts.seats.map((seat, i) => ({
    id: `p${i + 1}`,
    name: seat.name,
    color: COLORS[i % COLORS.length],
    isRogue: !!seat.isRogue,
    empireLevel: 1,
    energy: seat.isRogue ? 0 : 2,
    culture: seat.isRogue ? 0 : 1,
    ships: initialShips(1),
    colonized: [],
  }));

  // Deal secret missions to non-rogue players (solo play deals none).
  const soloMode = players.some((p) => p.isRogue);
  if (!soloMode) {
    const missionDeck = rng.shuffle(MISSIONS);
    players.forEach((p, i) => {
      // Each player looks at two and keeps one; we just assign one deterministically.
      p.mission = missionDeck[i % missionDeck.length];
    });
  }

  // Planet deck + center row.
  const deck = rng.shuffle(PLANETS.map((p) => p.id));
  const humanCount = players.filter((p) => !p.isRogue).length;
  const rowSize = soloMode ? 4 : humanCount + 2;
  const centerRow = deck.splice(0, rowSize);

  const order = players.map((p) => p.id);
  const active = order[0];

  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    rngState: rng.serialize(),
    players,
    order,
    centerRow,
    deck,
    turn: {
      active,
      dice: [],
      freeRerollUsed: false,
      converterUsedThisTurn: false,
      oncePerTurn: [],
      lastActivationFollows: 0,
      pendingFollow: null,
      pendingChoice: null,
    },
    phase: 'playing',
    endTriggeredBy: null,
    turnNumber: 1,
    log: [],
    winners: null,
    rogueId: players.find((p) => p.isRogue)?.id ?? null,
  };

  // Roll the first player's dice.
  rollForActive(state);
  return state;
}

/** Reconstruct the rng, run `fn`, persist the new rng state. */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = Rng.fromState(state.rngState);
  const out = fn(rng);
  state.rngState = rng.serialize();
  return out;
}

const FACES = ['move', 'energy', 'culture', 'diplomacy', 'economy', 'colony'] as const;

export function rollForActive(state: GameState): void {
  const player = state.players.find((p) => p.id === state.turn.active)!;
  const count = empire(player.empireLevel).dice;
  withRng(state, (rng) => {
    state.turn.dice = Array.from({ length: count }, (_, id) => ({
      id,
      face: FACES[rng.int(6)],
      activated: false,
      inConverter: false,
    }));
  });
  state.turn.freeRerollUsed = false;
  state.turn.converterUsedThisTurn = false;
  state.turn.oncePerTurn = [];
  state.turn.lastActivationFollows = 0;
  state.turn.pendingFollow = null;
  state.turn.pendingChoice = null;
}
