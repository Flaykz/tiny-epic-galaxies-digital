import type { GameAdapter, GameResult } from 'digital-boardgame-framework';
import type {
  Action,
  ColonizeType,
  Die,
  DieFace,
  GameState,
  PlayerState,
  ShipLocation,
} from './types.js';
import { SCHEMA_VERSION, rollForActive, withRng } from './setup.js';
import {
  acquireFromGalaxy,
  activePlayer,
  addResource,
  advanceShip,
  baseVp,
  clone,
  computeWinners,
  player,
  PLANET,
  playerOrbiting,
  shipsOnGalaxy,
  surfaceOccupied,
  unlockShips,
} from './helpers.js';
import { empire, MAX_EMPIRE, WIN_VP } from './empire.js';
import { PLANET_EFFECTS, REROLL_PLANETS, planetOptions } from './planetEffects.js';

const FACES: DieFace[] = ['move', 'energy', 'culture', 'diplomacy', 'economy', 'colony'];

function liveDie(state: GameState, id: number): Die | undefined {
  return state.turn.dice.find((d) => d.id === id && !d.activated && !d.inConverter);
}

function inactiveDice(state: GameState): Die[] {
  return state.turn.dice.filter((d) => !d.activated && !d.inConverter);
}

// ---------- Movement target enumeration ----------

function moveDestinations(state: GameState, p: PlayerState, shipIdx: number): ShipLocation[] {
  const s = p.ships[shipIdx];
  const dests: ShipLocation[] = [];
  // You must switch planets; you may move home.
  const fromPlanet = s.kind === 'surface' || s.kind === 'orbit' ? s.planetId : null;
  if (s.kind !== 'galaxy') dests.push({ kind: 'galaxy' });
  for (const planetId of state.centerRow) {
    if (planetId === fromPlanet) continue;
    const planet = PLANET(planetId);
    if (!planet) continue;
    // Land on surface: one of YOUR ships per surface, but different players may
    // share a surface (rulebook p.5). So only block if you already have a ship there.
    const youOnSurface = p.ships.some((sh) => sh.kind === 'surface' && sh.planetId === planetId);
    if (!youOnSurface) {
      dests.push({ kind: 'surface', planetId });
    }
    // Orbit: only if you don't already orbit it (one per player), enter at the
    // start of the track (level 0); advancing then moves to space 1, 2, ...
    if (playerOrbiting(p, planetId) == null) {
      dests.push({ kind: 'orbit', planetId, level: 0 });
    }
  }
  return dests;
}

// ---------- Applying a ship arrival ----------

function arrive(
  state: GameState,
  p: PlayerState,
  shipIdx: number,
  dest: ShipLocation,
  opts: { interactive?: boolean; thenFollow?: DieFace | null } = {},
): void {
  p.ships[shipIdx] = dest;
  // Landing on a surface triggers the planet action.
  if (dest.kind === 'surface') {
    triggerPlanet(state, p, dest.planetId, 'surface', opts.thenFollow ?? null, !!opts.interactive);
  }
}

/**
 * Resolve a planet's action. If it offers ≥2 target choices and the actor is
 * choosing interactively, pause for a target prompt (pendingChoice); otherwise
 * resolve immediately (auto-applying a single option when there is exactly one).
 * Opens the deferred follow window when the action resolves without a prompt.
 */
function triggerPlanet(
  state: GameState,
  p: PlayerState,
  planetId: string,
  source: 'surface' | 'colony',
  thenFollow: DieFace | null,
  interactive: boolean,
): void {
  const eff = PLANET_EFFECTS[planetId];
  if (!eff) {
    if (thenFollow) openFollowWindow(state, thenFollow);
    return;
  }
  if (REROLL_PLANETS.has(planetId)) rerollDice(state, inactiveDice(state).map((d) => d.id));
  const opts = interactive ? planetOptions(state, p, planetId) : [];
  // Surface/colony actions are optional, so whenever there's at least one target
  // to pick, pause for the choice (the prompt always includes a "skip" option).
  if (opts.length >= 1) {
    state.turn.pendingChoice = { player: p.id, planetId, source, thenFollow };
    return; // wait for the player's target choice; follow opens on resolve
  }
  state.log.push(eff(state, p));
  if (thenFollow) openFollowWindow(state, thenFollow);
}

function rerollDice(state: GameState, dieIds: number[]): void {
  withRng(state, (rng) => {
    for (const id of dieIds) {
      const d = state.turn.dice.find((x) => x.id === id && !x.activated && !x.inConverter);
      if (d) d.face = FACES[rng.int(6)];
    }
  });
}

// ---------- Upgrade ----------

function upgradeEmpire(state: GameState, p: PlayerState, pay: 'energy' | 'culture'): boolean {
  if (p.empireLevel >= MAX_EMPIRE) return false;
  const cost = empire(p.empireLevel + 1).upgradeCost;
  if ((pay === 'energy' ? p.energy : p.culture) < cost) return false;
  addResource(p, pay, -cost);
  p.empireLevel++;
  unlockShips(p);
  state.log.push(`${p.name} upgraded to empire level ${p.empireLevel}`);
  checkEnd(state, p);
  return true;
}

// ---------- End-game checks ----------

function checkEnd(state: GameState, p: PlayerState): void {
  if (state.rogueId) {
    // Solo: instant win at 21 for either side.
    if (baseVp(state, p) >= WIN_VP) {
      state.phase = 'gameOver';
      state.winners = p.isRogue ? [] : [p.id];
      state.log.push(p.isRogue ? 'The Rogue Galaxy conquered all — you lose.' : 'You defeated the Rogue Galaxy!');
    }
    return;
  }
  if (state.phase === 'playing' && baseVp(state, p) >= WIN_VP) {
    state.phase = 'finalRound';
    state.endTriggeredBy = p.id;
    state.log.push(`${p.name} reached ${WIN_VP}+ VP — final round!`);
  }
}

// ---------- Follow window ----------

function openFollowWindow(state: GameState, face: DieFace): void {
  if (!state.followEnabled) return; // async multiplayer: follows are auto-declined
  const cost = state.turn.oncePerTurn.includes('nibiru-follow-tax') ? 2 : 1;
  const order = state.order;
  const activeIdx = order.indexOf(state.turn.active);
  const queue: string[] = [];
  for (let i = 1; i < order.length; i++) {
    const id = order[(activeIdx + i) % order.length];
    // The Rogue Galaxy never takes a follow offer (it plays by its own rules),
    // but the human may follow it. Only offer to players who can afford the cost.
    if (id === state.rogueId) continue;
    if (player(state, id).culture >= cost) queue.push(id);
  }
  if (queue.length === 0) return;
  state.turn.pendingFollow = { face, queue, sourcePlayer: state.turn.active };
  state.turn.lastActivationFollows = 0;
}

/** Concrete, targeted follow options for a follower copying `face`. */
function followOptions(state: GameState, p: PlayerState, face: DieFace): Action[] {
  const out: Action[] = [];
  switch (face) {
    case 'energy':
    case 'culture':
      out.push({ type: 'follow', accept: true, params: { resource: face } });
      break;
    case 'move':
      p.ships.forEach((s, idx) => {
        if (s.kind === 'locked') return;
        for (const dest of moveDestinations(state, p, idx)) {
          out.push({ type: 'follow', accept: true, params: { shipIdx: idx, dest } });
        }
      });
      break;
    case 'diplomacy':
    case 'economy':
      p.ships.forEach((s, idx) => {
        if (s.kind === 'orbit' && PLANET(s.planetId)?.colonizeType === face) {
          out.push({ type: 'follow', accept: true, params: { shipIdx: idx, advance: face } });
        }
      });
      break;
    case 'colony':
      if (p.empireLevel < MAX_EMPIRE) {
        const c = empire(p.empireLevel + 1).upgradeCost;
        if (p.energy >= c) out.push({ type: 'follow', accept: true, params: { pay: 'energy' } });
        if (p.culture >= c) out.push({ type: 'follow', accept: true, params: { pay: 'culture' } });
      }
      for (const planetId of p.colonized) {
        out.push({ type: 'follow', accept: true, params: { planetId } });
      }
      break;
  }
  return out;
}

// ---------- The adapter ----------

export const tegAdapter: GameAdapter<GameState, Action, string> = {
  schemaVersion: SCHEMA_VERSION,

  currentActor(state) {
    if (state.phase === 'gameOver') return null;
    const pc = state.turn.pendingChoice;
    if (pc) return pc.player;
    const pf = state.turn.pendingFollow;
    if (pf && pf.queue.length > 0) return pf.queue[0];
    return state.turn.active;
  },

  legalActions(state, actor) {
    if (state.phase === 'gameOver') return [];
    if (this.currentActor(state) !== actor) return [];

    const pc = state.turn.pendingChoice;
    if (pc && pc.player === actor) {
      // Awaiting a target choice for a planet action.
      const cp = player(state, actor);
      return [...planetOptions(state, cp, pc.planetId), { type: 'skipPlanet' }];
    }

    const pf = state.turn.pendingFollow;
    if (pf && pf.queue.length > 0 && pf.queue[0] === actor) {
      // Follow decision: always allow decline; if the follower can pay, offer the
      // concrete, targeted ways to copy the action.
      const p = player(state, actor);
      const cost = state.turn.oncePerTurn.includes('nibiru-follow-tax') ? 2 : 1;
      const acts: Action[] = [{ type: 'follow', accept: false }];
      if (p.culture >= cost) acts.push(...followOptions(state, p, pf.face));
      return acts;
    }

    const p = activePlayer(state);
    const acts: Action[] = [{ type: 'endTurn' }];
    const dice = inactiveDice(state);

    for (const d of dice) {
      switch (d.face) {
        case 'move': {
          p.ships.forEach((s, idx) => {
            if (s.kind === 'locked') return;
            for (const dest of moveDestinations(state, p, idx)) {
              acts.push({ type: 'activateMove', dieId: d.id, shipIdx: idx, dest });
            }
          });
          break;
        }
        case 'energy':
          acts.push({ type: 'activateAcquire', dieId: d.id, resource: 'energy' });
          break;
        case 'culture':
          acts.push({ type: 'activateAcquire', dieId: d.id, resource: 'culture' });
          break;
        case 'diplomacy':
        case 'economy': {
          const type: ColonizeType = d.face;
          p.ships.forEach((s, idx) => {
            if (s.kind === 'orbit' && PLANET(s.planetId)?.colonizeType === type) {
              acts.push({ type: 'activateAdvance', dieId: d.id, advance: type, shipIdx: idx });
            }
          });
          break;
        }
        case 'colony': {
          // Galaxy action = upgrade empire.
          if (p.empireLevel < MAX_EMPIRE) {
            if (p.energy >= empire(p.empireLevel + 1).upgradeCost)
              acts.push({ type: 'activateColonyGalaxy', dieId: d.id, pay: 'energy' });
            if (p.culture >= empire(p.empireLevel + 1).upgradeCost)
              acts.push({ type: 'activateColonyGalaxy', dieId: d.id, pay: 'culture' });
          }
          // Or use one of your colonized planets' actions.
          for (const planetId of p.colonized) {
            acts.push({ type: 'activateColonyPlanet', dieId: d.id, planetId });
          }
          break;
        }
      }
    }

    // Reroll: first reroll free, then needs 1 energy.
    if (dice.length > 0 && (!state.turn.freeRerollUsed || p.energy >= 1)) {
      acts.push({ type: 'reroll', dieIds: dice.map((d) => d.id), free: !state.turn.freeRerollUsed });
    }

    // Converter: 2 dice spent, 1 set to a chosen face (once per turn).
    if (!state.turn.converterUsedThisTurn && dice.length >= 3) {
      const ids = dice.map((d) => d.id);
      for (const face of FACES) {
        acts.push({ type: 'convert', spend: [ids[0], ids[1]], target: ids[2], face });
      }
    }

    return acts;
  },

  applyAction(state, action, actor) {
    const next = clone(state);
    applyMut(next, action, actor);
    return next;
  },

  viewFor(state, viewer) {
    // Redact other players' secret missions.
    const v = clone(state);
    for (const p of v.players) {
      if (p.id !== viewer && p.mission) {
        p.mission = { id: 'hidden', name: 'Secret Mission', objective: 'Hidden until end of game', bonusVp: 0 };
      }
    }
    return v;
  },

  result(state): GameResult<string> | null {
    if (state.phase !== 'gameOver') return null;
    return { winners: state.winners ?? [], reason: 'game over' };
  },
};

// ---------- The mutation core ----------

function applyMut(state: GameState, action: Action, actor: string): void {
  // Follow decisions.
  if (action.type === 'follow') {
    resolveFollow(state, action, actor);
    return;
  }

  const p = player(state, actor);

  switch (action.type) {
    case 'activateMove': {
      const d = liveDie(state, action.dieId);
      if (!d || d.face !== 'move') break;
      d.activated = true;
      state.log.push(`${p.name} moved a ship`);
      const wasSurface = action.dest.kind === 'surface';
      // Surface landings resolve (and open the follow window) inside triggerPlanet,
      // possibly after a target prompt. Non-surface moves open it directly.
      arrive(state, p, action.shipIdx, action.dest, { interactive: true, thenFollow: 'move' });
      if (!wasSurface) openFollowWindow(state, 'move');
      break;
    }
    case 'activateAcquire': {
      const d = liveDie(state, action.dieId);
      if (!d || d.face !== action.resource) break;
      d.activated = true;
      const got = acquireFromGalaxy(state, p, action.resource);
      state.log.push(`${p.name} acquired ${got} ${action.resource}`);
      openFollowWindow(state, action.resource);
      break;
    }
    case 'activateAdvance': {
      const d = liveDie(state, action.dieId);
      if (!d || d.face !== action.advance) break;
      d.activated = true;
      advanceShip(state, p, action.shipIdx, action.advance, 1);
      state.log.push(`${p.name} advanced a ship (${action.advance})`);
      openFollowWindow(state, action.advance);
      break;
    }
    case 'activateColonyGalaxy': {
      const d = liveDie(state, action.dieId);
      if (!d || d.face !== 'colony') break;
      if (upgradeEmpire(state, p, action.pay)) {
        d.activated = true;
        openFollowWindow(state, 'colony');
      }
      break;
    }
    case 'activateColonyPlanet': {
      const d = liveDie(state, action.dieId);
      if (!d || d.face !== 'colony') break;
      if (!p.colonized.includes(action.planetId)) break;
      d.activated = true;
      // May prompt for a target; the follow window opens once the action resolves.
      triggerPlanet(state, p, action.planetId, 'colony', 'colony', true);
      break;
    }
    case 'resolvePlanet': {
      const pc = state.turn.pendingChoice;
      if (!pc || pc.player !== actor) break;
      const eff = PLANET_EFFECTS[pc.planetId];
      if (eff) state.log.push(eff(state, p, action.choice));
      const thenFollow = pc.thenFollow;
      state.turn.pendingChoice = null;
      if (thenFollow) openFollowWindow(state, thenFollow);
      break;
    }
    case 'skipPlanet': {
      const pc = state.turn.pendingChoice;
      if (!pc) break;
      state.log.push(`${player(state, pc.player).name} skipped ${PLANET(pc.planetId)?.name}'s action`);
      const thenFollow = pc.thenFollow;
      state.turn.pendingChoice = null;
      if (thenFollow) openFollowWindow(state, thenFollow);
      break;
    }
    case 'reroll': {
      const free = !state.turn.freeRerollUsed;
      if (!free) {
        if (p.energy < 1) break;
        addResource(p, 'energy', -1);
      }
      state.turn.freeRerollUsed = true;
      rerollDice(state, action.dieIds);
      state.log.push(`${p.name} rerolled ${action.dieIds.length} dice${free ? ' (free)' : ' (1 energy)'}`);
      break;
    }
    case 'convert': {
      if (state.turn.converterUsedThisTurn) break;
      const [a, b] = action.spend;
      const da = liveDie(state, a), db = liveDie(state, b), dt = liveDie(state, action.target);
      if (!da || !db || !dt) break;
      da.inConverter = true;
      db.inConverter = true;
      dt.face = action.face;
      state.turn.converterUsedThisTurn = true;
      state.log.push(`${p.name} used the Converter → set a die to ${action.face}`);
      break;
    }
    case 'endTurn': {
      endTurn(state);
      break;
    }
  }

  // After most actions, re-check solo instant win on the acting player.
  if (state.rogueId && state.phase !== 'gameOver') checkEnd(state, p);
}

function resolveFollow(state: GameState, action: { type: 'follow'; accept: boolean; params?: any }, actor: string): void {
  const pf = state.turn.pendingFollow;
  if (!pf || pf.queue[0] !== actor) return;
  pf.queue.shift();
  if (action.accept) {
    const p = player(state, actor);
    const cost = state.turn.oncePerTurn.includes('nibiru-follow-tax') ? 2 : 1;
    if (p.culture >= cost) {
      addResource(p, 'culture', -cost);
      state.turn.lastActivationFollows++;
      applyFollowEffect(state, p, pf.face, action.params ?? {});
      state.log.push(`${p.name} followed (${pf.face})`);
    }
  }
  if (pf.queue.length === 0) state.turn.pendingFollow = null;
}

function applyFollowEffect(state: GameState, p: PlayerState, face: DieFace, params: any): void {
  switch (face) {
    case 'energy':
    case 'culture':
      acquireFromGalaxy(state, p, face);
      break;
    case 'move':
      if (params.shipIdx != null && params.dest) arrive(state, p, params.shipIdx, params.dest);
      break;
    case 'diplomacy':
    case 'economy':
      if (params.shipIdx != null) advanceShip(state, p, params.shipIdx, face, 1);
      break;
    case 'colony':
      if (params.planetId && p.colonized.includes(params.planetId)) {
        const eff = PLANET_EFFECTS[params.planetId];
        if (eff) state.log.push(eff(state, p, params.choice));
      } else if (params.pay) {
        upgradeEmpire(state, p, params.pay);
      }
      break;
  }
}

function endTurn(state: GameState): void {
  // Standard mode: handle final-round completion.
  const order = state.order;
  const curIdx = order.indexOf(state.turn.active);
  const nextActive = order[(curIdx + 1) % order.length];

  if (!state.rogueId && state.phase === 'finalRound' && nextActive === state.endTriggeredBy) {
    state.phase = 'gameOver';
    state.winners = computeWinners(state);
    const names = state.winners.map((id) => player(state, id).name).join(', ');
    state.log.push(`Game over. Winner: ${names}`);
    return;
  }

  state.turn.active = nextActive;
  state.turn.pendingFollow = null;
  state.turnNumber++;
  rollForActive(state);
}
