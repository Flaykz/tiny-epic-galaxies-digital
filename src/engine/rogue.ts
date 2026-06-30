// The official solo opponent: the Rogue Galaxy automa (rulebook p.10–11). Unlike a
// normal AI seat, the Rogue follows fixed, deterministic rules. Modeled on the
// BEGINNER Rogue Galaxy "ARTEMIS". The Rogue uses the same empire track (dice/ships)
// as players; its Galaxy Card produces both energy and culture (see acquireCount).
import type { Action, DieFace, GameState, PlayerState } from './types.js';
import {
  PLANET,
  addResource,
  advanceShip,
  regressShip,
  acquireFromGalaxy,
  playerOrbiting,
  unlockShips,
  player,
  withRng,
} from './helpers.js';
import { RESOURCE_MAX, MAX_EMPIRE } from './empire.js';

const FACES: DieFace[] = ['move', 'energy', 'culture', 'diplomacy', 'economy', 'colony'];

/** The Rogue player in a solo game. */
export function rogue(state: GameState): PlayerState | undefined {
  return state.rogueId ? player(state, state.rogueId) : undefined;
}

/** The (single) human in a solo game. */
function human(state: GameState): PlayerState {
  return state.players.find((p) => !p.isRogue)!;
}

// ---- ARTEMIS Rogue Colony Action, indexed by the Rogue's empire level (1..6) ----
// "rogue steals 2 resources of your choice" is auto-resolved (energy first) so the
// automa never needs to prompt the human.
const ROGUE_COLONY: Record<number, (s: GameState) => string> = {
  1: (s) => loseResource(s, 'energy', 1),
  2: (s) => loseResource(s, 'culture', 1),
  3: (s) => steal(s, 'culture', 1),
  4: (s) => regressHuman(s, 1),
  5: (s) => stealAny(s, 2),
  6: (s) => stealAny(s, 2),
};

function loseResource(s: GameState, kind: 'energy' | 'culture', n: number): string {
  const h = human(s);
  const lost = Math.min(n, kind === 'energy' ? h.energy : h.culture);
  addResource(h, kind, -lost);
  return `Rogue Colony Action: ${h.name} loses ${lost} ${kind}`;
}

function steal(s: GameState, kind: 'energy' | 'culture', n: number): string {
  const h = human(s), r = rogue(s)!;
  const got = Math.min(n, kind === 'energy' ? h.energy : h.culture);
  addResource(h, kind, -got);
  addResource(r, kind, got);
  return `Rogue Colony Action: Rogue stole ${got} ${kind} from ${h.name}`;
}

function stealAny(s: GameState, n: number): string {
  const h = human(s), r = rogue(s)!;
  let taken = 0;
  for (const kind of ['energy', 'culture'] as const) {
    if (taken >= n) break;
    const got = Math.min(n - taken, kind === 'energy' ? h.energy : h.culture);
    addResource(h, kind, -got);
    addResource(r, kind, got);
    taken += got;
  }
  return `Rogue Colony Action: Rogue stole ${taken} resource(s) from ${h.name}`;
}

function regressHuman(s: GameState, n: number): string {
  const h = human(s);
  // Hit the human's most-advanced orbiting ship.
  let best = -1, bestLevel = -1;
  h.ships.forEach((sh, i) => { if (sh.kind === 'orbit' && sh.level > bestLevel) { best = i; bestLevel = sh.level; } });
  if (best < 0) return `Rogue Colony Action: no ${h.name} ship to regress`;
  regressShip(s, h, best, n);
  return `Rogue Colony Action: regressed ${h.name}'s most-advanced ship -${n}`;
}

// ---- Per-die Rogue actions ----

/** Advance EVERY Rogue ship orbiting a `type`-colonize planet one space. */
function advanceAll(s: GameState, type: 'economy' | 'diplomacy'): string {
  const r = rogue(s)!;
  let n = 0;
  r.ships.forEach((sh, i) => {
    if (sh.kind === 'orbit' && PLANET(sh.planetId)?.colonizeType === type) { if (advanceShip(s, r, i, type, 1)) n++; }
  });
  return n > 0 ? `Rogue advanced ${n} ship(s) (${type})` : `Rogue: no ${type} ships to advance`;
}

/** Move a Rogue ship from its Galaxy to the leftmost planet with no Rogue ship
 *  orbiting, into the orbit start. A Rogue ship never lands on a surface. */
function rogueMoveShip(s: GameState): { usable: boolean; log: string } {
  const r = rogue(s)!;
  const shipIdx = r.ships.findIndex((sh) => sh.kind === 'galaxy');
  if (shipIdx < 0) return { usable: false, log: 'Rogue: no ship on its Galaxy to move' };
  const target = s.centerRow.find((pid) => playerOrbiting(r, pid) == null);
  if (!target) return { usable: false, log: 'Rogue: every planet already has a Rogue ship' };
  r.ships[shipIdx] = { kind: 'orbit', planetId: target, level: 0 };
  return { usable: true, log: `Rogue moved a ship into orbit of ${PLANET(target)?.name ?? target}` };
}

/**
 * Resolve one Rogue die. Returns whether it was usable (an unusable die is
 * discarded with no effect — and can't be followed). `bonus` marks the max-culture
 * bonus actions, where Acquire-Culture dice are unusable.
 */
export function resolveRogueDie(state: GameState, face: DieFace, bonus = false): { usable: boolean } {
  const r = rogue(state)!;
  switch (face) {
    case 'economy':
    case 'diplomacy':
      state.log.push(advanceAll(state, face));
      return { usable: true };
    case 'energy': {
      const got = acquireFromGalaxy(state, r, 'energy');
      state.log.push(`Rogue acquired ${got} energy`);
      return { usable: true };
    }
    case 'culture': {
      if (bonus) { state.log.push('Rogue: Acquire Culture unusable (culture maxed)'); return { usable: false }; }
      const got = acquireFromGalaxy(state, r, 'culture');
      state.log.push(`Rogue acquired ${got} culture`);
      return { usable: true };
    }
    case 'move': {
      const m = rogueMoveShip(state);
      state.log.push(m.log);
      return { usable: m.usable };
    }
    case 'colony': {
      const lvl = Math.min(Math.max(r.empireLevel, 1), 6);
      state.log.push(ROGUE_COLONY[lvl](state));
      return { usable: true };
    }
  }
}

/**
 * End-of-turn specials (resolved before the turn passes). If energy is maxed the
 * Rogue upgrades its empire (reaching the skull = instant Rogue win); if culture
 * is maxed it takes 3 bonus actions (no follows). Energy is resolved first.
 */
export function rogueEndOfTurn(state: GameState): void {
  const r = rogue(state)!;
  if (r.energy >= RESOURCE_MAX) {
    addResource(r, 'energy', -r.energy); // back to zero
    if (r.empireLevel >= MAX_EMPIRE) {
      // Empire token reaches the skull — the Rogue Galaxy wins instantly.
      state.phase = 'gameOver';
      state.winners = [];
      state.log.push('The Rogue Galaxy reached the skull — you lose.');
      return;
    }
    r.empireLevel++;
    unlockShips(r);
    state.log.push(`Rogue upgraded its empire to level ${r.empireLevel}`);
  }
  if (state.phase === 'gameOver') return;
  if (r.culture >= RESOURCE_MAX) {
    state.log.push('Rogue culture maxed — taking 3 bonus actions');
    withRng(state, (rng) => {
      for (let i = 0; i < 3; i++) resolveRogueDie(state, FACES[rng.int(6)], true);
    });
    addResource(r, 'culture', -r.culture); // back to zero
  }
}

/** The next action for the Rogue this turn: resolve the next die, or end the turn. */
export function rogueNextAction(state: GameState): Action {
  const die = state.turn.dice.find((d) => !d.activated && !d.inConverter);
  if (die) return { type: 'rogueResolveDie', dieId: die.id };
  return { type: 'endTurn' };
}
