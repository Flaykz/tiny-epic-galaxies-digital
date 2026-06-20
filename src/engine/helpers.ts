import type {
  ColonizeType,
  GameState,
  PlayerState,
  ShipLocation,
} from './types.js';
import { PLANETS_BY_ID } from './planets.js';
import { empire, MAX_EMPIRE, RESOURCE_MAX, WIN_VP } from './empire.js';
import { withRng } from './setup.js';

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function player(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

export function activePlayer(state: GameState): PlayerState {
  return player(state, state.turn.active);
}

export function addResource(p: PlayerState, kind: 'energy' | 'culture', n: number): void {
  if (kind === 'energy') p.energy = Math.max(0, Math.min(RESOURCE_MAX, p.energy + n));
  else p.culture = Math.max(0, Math.min(RESOURCE_MAX, p.culture + n));
}

/** Empire VP + colonized-planet VP for a player (excludes secret mission). */
export function baseVp(state: GameState, p: PlayerState): number {
  const planetVp = p.colonized.reduce((s, id) => s + (PLANETS_BY_ID[id]?.vp ?? 0), 0);
  return empire(p.empireLevel).vp + planetVp;
}

export function loc(p: PlayerState, idx: number): ShipLocation {
  return p.ships[idx];
}

/** Is a planet surface free for player p to land on (only one ship per surface, any player). */
export function surfaceOccupied(state: GameState, planetId: string): { player: string; idx: number } | null {
  for (const pl of state.players) {
    for (let idx = 0; idx < pl.ships.length; idx++) {
      const s = pl.ships[idx];
      if (s.kind === 'surface' && s.planetId === planetId) return { player: pl.id, idx };
    }
  }
  return null;
}

/** Does this player already have a ship orbiting this planet? (one per planet per player). */
export function playerOrbiting(p: PlayerState, planetId: string): number | null {
  for (let idx = 0; idx < p.ships.length; idx++) {
    const s = p.ships[idx];
    if (s.kind === 'orbit' && s.planetId === planetId) return idx;
  }
  return null;
}

/** Number of a player's ships currently sitting on their own galaxy mat (available). */
export function shipsOnGalaxy(p: PlayerState): number[] {
  const out: number[] = [];
  p.ships.forEach((s, i) => {
    if (s.kind === 'galaxy') out.push(i);
  });
  return out;
}

/** Recompute unlocked ships after an empire upgrade. Newly unlocked ships go to the galaxy mat. */
export function unlockShips(p: PlayerState): void {
  const unlocked = empire(p.empireLevel).ships;
  let active = p.ships.filter((s) => s.kind !== 'locked').length;
  for (let i = 0; i < p.ships.length && active < unlocked; i++) {
    if (p.ships[i].kind === 'locked') {
      p.ships[i] = { kind: 'galaxy' };
      active++;
    }
  }
}

export const PLANET = (id: string) => PLANETS_BY_ID[id];

/**
 * Advance one of player p's orbiting ships by `steps` on the given track type, if it
 * matches the planet's colonize type. Handles colonization when reaching the end.
 * Returns true if something advanced.
 */
export function advanceShip(
  state: GameState,
  p: PlayerState,
  shipIdx: number,
  type: ColonizeType,
  steps = 1,
): boolean {
  const s = p.ships[shipIdx];
  if (s.kind !== 'orbit') return false;
  const planet = PLANET(s.planetId);
  if (!planet || planet.colonizeType !== type) return false;
  // Ships enter at the start (level 0) and advance through spaces 1..N. Reaching
  // PAST the last numbered space (onto the colonize symbol) colonizes the planet.
  const newLevel = s.level + steps;
  if (newLevel > planet.orbitTrackLength) {
    colonize(state, p, s.planetId);
  } else {
    p.ships[shipIdx] = { kind: 'orbit', planetId: s.planetId, level: newLevel };
  }
  return true;
}

/** Regress (push back) a ship; pushed before the start (below level 0) it returns home. */
export function regressShip(state: GameState, p: PlayerState, shipIdx: number, steps = 1): void {
  const s = p.ships[shipIdx];
  if (s.kind !== 'orbit') return;
  const newLevel = s.level - steps;
  if (newLevel < 0) {
    p.ships[shipIdx] = { kind: 'galaxy' };
  } else {
    p.ships[shipIdx] = { kind: 'orbit', planetId: s.planetId, level: newLevel };
  }
}

/** Colonize a planet for player p: return all ships there home, slide card under mat, refill row. */
export function colonize(state: GameState, p: PlayerState, planetId: string): void {
  const planet = PLANET(planetId);
  // All ships on the card (any player) return to their galaxy mats.
  for (const pl of state.players) {
    pl.ships = pl.ships.map((s) =>
      (s.kind === 'orbit' || s.kind === 'surface') && s.planetId === planetId
        ? { kind: 'galaxy' }
        : s,
    );
  }
  p.colonized.push(planetId);
  state.centerRow = state.centerRow.filter((id) => id !== planetId);
  // Replace from the deck.
  if (state.deck.length > 0) {
    const next = state.deck.shift()!;
    state.centerRow.push(next);
  }
  state.log.push(`${p.name} colonized ${planet?.name ?? planetId} (+${planet?.vp ?? 0} VP)`);
  checkEndTrigger(state, p);
}

export function checkEndTrigger(state: GameState, p: PlayerState): void {
  if (state.phase === 'playing' && baseVp(state, p) >= WIN_VP) {
    state.phase = 'finalRound';
    state.endTriggeredBy = p.id;
    state.log.push(`${p.name} reached ${WIN_VP}+ VP — final round triggered!`);
  }
}

/**
 * Acquire resources for an Acquire die (rulebook p.6): +1 of the resource for
 * each of your ships on/orbiting a planet with the matching symbol, PLUS +1
 * ENERGY for each of your ships on your Galaxy Card (the home galaxy produces
 * energy; it does not produce culture).
 */
export function acquireFromGalaxy(state: GameState, p: PlayerState, kind: 'energy' | 'culture'): number {
  let count = 0;
  for (const s of p.ships) {
    if (s.kind === 'galaxy') {
      if (kind === 'energy') count++; // each home ship yields 1 energy
    } else if (s.kind === 'surface' || s.kind === 'orbit') {
      const planet = PLANET(s.planetId);
      if (planet && planet.resourceType === kind) count++;
    }
  }
  addResource(p, kind, count);
  return count;
}

// ---- Scoring / mission evaluation ----

function economyPlanets(p: PlayerState): number {
  return p.colonized.filter((id) => PLANET(id)?.colonizeType === 'economy').length;
}
function diplomacyPlanets(p: PlayerState): number {
  return p.colonized.filter((id) => PLANET(id)?.colonizeType === 'diplomacy').length;
}

export function missionBonus(state: GameState, p: PlayerState): number {
  const m = p.mission;
  if (!m) return 0;
  const others = state.players.filter((o) => o.id !== p.id && !o.isRogue);
  const most = (val: (q: PlayerState) => number): 0 | 2 | 3 => {
    const mine = val(p);
    const max = Math.max(mine, ...others.map(val));
    if (mine < max) return 0;
    const tied = [p, ...others].filter((q) => val(q) === max).length > 1;
    return tied ? 2 : 3;
  };
  const fewest = (val: (q: PlayerState) => number): 0 | 2 | 3 => {
    const mine = val(p);
    const min = Math.min(mine, ...others.map(val));
    if (mine > min) return 0;
    const tied = [p, ...others].filter((q) => val(q) === min).length > 1;
    return tied ? 2 : 3;
  };
  switch (m.id) {
    case 'm_seeker': return most((q) => q.culture);
    case 'm_charger': return most((q) => q.energy);
    case 'm_conqueror': return most((q) => q.colonized.length);
    case 'm_hermit': return fewest((q) => q.colonized.length);
    case 'm_noble': return most(diplomacyPlanets);
    case 'm_trader': return most(economyPlanets);
    case 'm_equalizer': return economyPlanets(p) === diplomacyPlanets(p) ? 3 : 0;
    case 'm_elder': return state.endTriggeredBy === p.id ? 2 : 0;
    case 'm_hoarder': return p.energy >= 3 && p.culture >= 3 ? 2 : 0;
    case 'm_industrialist': return p.empireLevel >= MAX_EMPIRE ? 2 : 0;
    case 'm_orbiter': return p.ships.every((s) => s.kind === 'galaxy' || s.kind === 'locked') ? 2 : 0;
    case 'm_explorer': return p.ships.every((s) => s.kind !== 'galaxy') ? 2 : 0;
    default: return 0;
  }
}

export function finalScore(state: GameState, p: PlayerState): number {
  return baseVp(state, p) + missionBonus(state, p);
}

export function computeWinners(state: GameState): string[] {
  const contenders = state.players.filter((p) => !p.isRogue);
  let best = -Infinity;
  let winners: string[] = [];
  for (const p of contenders) {
    const score = finalScore(state, p);
    if (score > best) {
      best = score;
      winners = [p.id];
    } else if (score === best) {
      winners.push(p.id);
    }
  }
  // Tie-breakers: most colonized planets, then highest empire, then total resources.
  if (winners.length > 1) {
    const tb = (p: PlayerState): [number, number, number] => [
      p.colonized.length,
      p.empireLevel,
      p.energy + p.culture,
    ];
    winners.sort((a, b) => {
      const A = tb(player(state, a));
      const B = tb(player(state, b));
      for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return B[i] - A[i];
      return 0;
    });
    const topId = winners[0];
    const top = tb(player(state, topId));
    winners = winners.filter((id) => {
      const v = tb(player(state, id));
      return v[0] === top[0] && v[1] === top[1] && v[2] === top[2];
    });
  }
  return winners;
}

export { withRng };
