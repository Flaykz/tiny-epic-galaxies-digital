// The official solo opponent: the Rogue Galaxy automa (rulebook p.10–11). Unlike a
// normal AI seat, the Rogue follows fixed, deterministic rules. Modeled on the
// BEGINNER Rogue Galaxy "ARTEMIS". The Rogue uses the same empire track (dice/ships)
// as players; its Galaxy Card produces both energy and culture (see acquireCount).
import type { Action, DieFace, GameState, PlayerState, RogueCardId } from './types.js';
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
import { logEvent } from './setup.js';

const FACES: DieFace[] = ['move', 'energy', 'culture', 'diplomacy', 'economy', 'colony'];

/** The Rogue player in a solo game. */
export function rogue(state: GameState): PlayerState | undefined {
  return state.rogueId ? player(state, state.rogueId) : undefined;
}

/** The (single) human in a solo game. */
function human(state: GameState): PlayerState {
  return state.players.find((p) => !p.isRogue)!;
}

// ---- The five official Rogue Galaxy cards (mat backs), each a Rogue Colony Action
// ladder indexed by the Rogue's empire level (1..5). "steal N of your choice" is
// auto-resolved (energy first) so the automa never prompts the human. The Rogue's
// empire track/dice are modeled on the player track (see note at top). ----
// `colony` runs the effect (mutating state, returns a log line); `desc` is the
// read-only ladder shown to the player so they can see which Rogue they face and
// what each empire level does. KEEP THE TWO IN SYNC — if you change a colony
// effect, update the matching desc string.
export interface RogueCard { id: RogueCardId; name: string; tier: string; colony: Record<number, (s: GameState) => string>; desc: Record<number, string>; }

export const ROGUE_CARDS: Record<RogueCardId, RogueCard> = {
  rothkel: { id: 'rothkel', name: 'ROTHKEL', tier: 'Easy', colony: {
    1: (s) => loseResource(s, 'energy', 1),
    2: (s) => loseResource(s, 'culture', 1),
    3: (s) => rogueAcquireRes(s, 'energy', 2),
    4: (s) => regressHuman(s, 1),
    5: (s) => advanceAllAnyType(s, 1),
  }, desc: {
    1: 'You lose 1 energy',
    2: 'You lose 1 culture',
    3: 'Rogue gains 2 energy',
    4: 'Your most-advanced orbiting ship regresses 1',
    5: 'Every Rogue ship in orbit advances 1',
  } },
  artemis: { id: 'artemis', name: 'ARTEMIS', tier: 'Beginner', colony: {
    1: (s) => loseResource(s, 'energy', 1),
    2: (s) => loseResource(s, 'culture', 1),
    3: (s) => steal(s, 'culture', 1),
    4: (s) => regressHuman(s, 1),
    5: (s) => stealAny(s, 2),
  }, desc: {
    1: 'You lose 1 energy',
    2: 'You lose 1 culture',
    3: 'Rogue steals 1 culture from you',
    4: 'Your most-advanced orbiting ship regresses 1',
    5: 'Rogue steals 2 resources from you (energy first)',
  } },
  zendica: { id: 'zendica', name: 'ZENDICA', tier: 'Medium', colony: {
    1: (s) => loseResource(s, 'energy', 1),
    2: (s) => rogueAcquireRes(s, 'culture', 2),
    3: (s) => regressHuman(s, 1),
    4: (s) => humanLoseDie(s),
    5: (s) => regressAllHuman(s, 1),
  }, desc: {
    1: 'You lose 1 energy',
    2: 'Rogue gains 2 culture',
    3: 'Your most-advanced orbiting ship regresses 1',
    4: 'You lose a die next turn',
    5: 'All your orbiting ships regress 1',
  } },
  hades: { id: 'hades', name: 'HADES', tier: 'Hard', colony: {
    1: (s) => rogueAcquireBoth(s),
    2: (s) => steal(s, 'energy', 2),
    3: (s) => steal(s, 'culture', 2),
    4: (s) => advanceAllAnyType(s, 2),
    5: (s) => stealAny(s, 3),
  }, desc: {
    1: 'Rogue gains 1 energy + 1 culture',
    2: 'Rogue steals 2 energy from you',
    3: 'Rogue steals 2 culture from you',
    4: 'Every Rogue ship in orbit advances 2',
    5: 'Rogue steals 3 resources from you (energy first)',
  } },
  gamelyn: { id: 'gamelyn', name: 'GAMELYN', tier: 'Epic', colony: {
    1: (s) => `${loseResource(s, 'energy', 1)}; ${loseResource(s, 'culture', 1)}`,
    2: (s) => `${steal(s, 'energy', 1)}; ${steal(s, 'culture', 1)}`,
    3: (s) => advanceAllAnyType(s, 1),
    4: (s) => `${advanceAllAnyType(s, 1)}; ${steal(s, 'energy', 1)}`,
    5: (s) => advanceAllAnyType(s, 2),
  }, desc: {
    1: 'You lose 1 energy and 1 culture',
    2: 'Rogue steals 1 energy and 1 culture from you',
    3: 'Every Rogue ship in orbit advances 1',
    4: 'Every Rogue ship in orbit advances 1; Rogue steals 1 energy from you',
    5: 'Every Rogue ship in orbit advances 2',
  } },
};

export function rogueCardOf(state: GameState): RogueCard {
  return ROGUE_CARDS[state.rogueCard ?? 'artemis'];
}

function rogueAcquireRes(s: GameState, kind: 'energy' | 'culture', n: number): string {
  const r = rogue(s)!;
  addResource(r, kind, n);
  return `Rogue Colony Action: Rogue acquired ${n} ${kind}`;
}

function rogueAcquireBoth(s: GameState): string {
  const r = rogue(s)!;
  addResource(r, 'energy', 1); addResource(r, 'culture', 1);
  return 'Rogue Colony Action: Rogue acquired 1 energy + 1 culture';
}

function regressAllHuman(s: GameState, n: number): string {
  const h = human(s);
  let c = 0;
  h.ships.forEach((sh, i) => { if (sh.kind === 'orbit') { regressShip(s, h, i, n); c++; } });
  return `Rogue Colony Action: regressed all ${c} of ${h.name}'s orbiting ships -${n}`;
}

function advanceAllAnyType(s: GameState, n: number): string {
  const r = rogue(s)!;
  let c = 0;
  r.ships.forEach((sh, i) => {
    if (sh.kind === 'orbit') { const t = PLANET(sh.planetId)?.colonizeType; if (t && advanceShip(s, r, i, t, n)) c++; }
  });
  return c > 0 ? `Rogue Colony Action: Rogue advanced all ${c} of its ships +${n}` : 'Rogue Colony Action: no Rogue ships to advance';
}

function humanLoseDie(s: GameState): string {
  const h = human(s);
  h.diceMalus = (h.diceMalus ?? 0) + 1;
  return `Rogue Colony Action: ${h.name} loses a die next turn`;
}

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
      logEvent(state, 'rogue.advance', advanceAll(state, face), { type: face }, state.rogueId);
      return { usable: true };
    case 'energy': {
      const got = acquireFromGalaxy(state, r, 'energy');
      logEvent(state, 'rogue.acquire', `Rogue acquired ${got} energy`, { resource: 'energy', amount: got }, state.rogueId);
      return { usable: true };
    }
    case 'culture': {
      if (bonus) { logEvent(state, 'rogue.acquire', 'Rogue: Acquire Culture unusable (culture maxed)', { resource: 'culture', unusable: true }, state.rogueId); return { usable: false }; }
      const got = acquireFromGalaxy(state, r, 'culture');
      logEvent(state, 'rogue.acquire', `Rogue acquired ${got} culture`, { resource: 'culture', amount: got }, state.rogueId);
      return { usable: true };
    }
    case 'move': {
      const m = rogueMoveShip(state);
      logEvent(state, 'rogue.move', m.log, { usable: m.usable }, state.rogueId);
      return { usable: m.usable };
    }
    case 'colony': {
      const lvl = Math.min(Math.max(r.empireLevel, 1), 5); // ladders run levels 1..5
      logEvent(state, 'rogue.colonyAction', rogueCardOf(state).colony[lvl](state), { card: rogueCardOf(state).id, level: lvl }, state.rogueId);
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
      logEvent(state, 'game.over', 'The Rogue Galaxy reached the skull — you lose.', { winners: [], solo: true });
      return;
    }
    r.empireLevel++;
    unlockShips(r);
    logEvent(state, 'rogue.upgrade', `Rogue upgraded its empire to level ${r.empireLevel}`, { level: r.empireLevel }, state.rogueId);
  }
  if (state.phase === 'gameOver') return;
  if (r.culture >= RESOURCE_MAX) {
    logEvent(state, 'rogue.bonus', 'Rogue culture maxed — taking 3 bonus actions', { actions: 3 }, state.rogueId);
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
