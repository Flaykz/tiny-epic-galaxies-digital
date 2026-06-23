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
  // NAGATO (cp21): set up two interactive ship moves (handled via pendingMoves).
  if (interactive && planetId === 'cp21') { setupNagato(state, p, thenFollow); return; }
  const opts = interactive ? planetChoiceOptions(state, p, planetId) : [];
  // Surface/colony actions are optional, so whenever there's at least one target
  // to pick, pause for the choice (the prompt always includes a "skip" option).
  if (opts.length >= 1) {
    state.turn.pendingChoice = { player: p.id, planetId, source, thenFollow };
    return; // wait for the player's target choice; follow opens on resolve
  }
  state.log.push(eff(state, p));
  if (thenFollow) openFollowWindow(state, thenFollow);
}

/**
 * NAGATO (cp21): "Spend 1 culture to move 2 of your ships (only once per turn)."
 * Pays the cost, marks the once-per-turn limit, and queues up to two interactive
 * moves (each resolved via a `nagatoMove` action). Falls back to a logged no-op
 * when it can't be used (already used, no culture, or no legal move available).
 */
function setupNagato(state: GameState, p: PlayerState, thenFollow: DieFace | null): void {
  const done = () => { if (thenFollow) openFollowWindow(state, thenFollow); };
  if (state.turn.oncePerTurn.includes('once-cp21')) { state.log.push(`${p.name}: NAGATO already used this turn`); done(); return; }
  if (p.culture < 1) { state.log.push(`${p.name}: NAGATO needs 1 culture`); done(); return; }
  const canMove = p.ships.some((s, i) => s.kind !== 'locked' && moveDestinations(state, p, i).length > 0);
  if (!canMove) { state.log.push(`${p.name}: NAGATO — no ship can move`); done(); return; }
  addResource(p, 'culture', -1);
  state.turn.oncePerTurn.push('once-cp21');
  state.turn.pendingMoves = { player: p.id, left: 2, thenFollow };
  state.log.push(`${p.name} spent 1 culture (NAGATO) — move up to 2 ships`);
}

/** Short label for a move destination, used in PIEDES "repeat move" options. */
function destLabel(d: ShipLocation): string {
  if (d.kind === 'surface') return `${PLANET(d.planetId)?.name ?? d.planetId} (surface)`;
  if (d.kind === 'orbit') return `${PLANET(d.planetId)?.name ?? d.planetId} (orbit)`;
  return 'home galaxy';
}

/**
 * The full target-choice list for a planet action. This is `planetOptions` plus
 * any options that need the adapter's own helpers — currently PIEDES (cp23)
 * repeating a MOVE die, whose destinations come from `moveDestinations`. Used by
 * both `triggerPlanet` (to decide whether to prompt) and `legalActions`.
 */
function planetChoiceOptions(state: GameState, p: PlayerState, planetId: string): Action[] {
  const opts = [...planetOptions(state, p, planetId)];
  if (planetId === 'cp25') {
    // ZALAX: reroll any number of your inactive dice — pick them one at a time
    // (already-rerolled dice this activation are excluded), then "skip" to stop.
    const done = new Set(state.turn.pendingChoice?.rerolled ?? []);
    for (const d of state.turn.dice.filter((x) => !x.activated && !x.inConverter && !done.has(x.id))) {
      opts.push({ type: 'resolvePlanet', choice: { dieIds: [d.id] }, label: `Reroll the ${d.face} die` });
    }
  }
  if (planetId === 'cp23') {
    for (const d of state.turn.dice.filter((x) => x.activated && !x.inConverter && x.face === 'move')) {
      p.ships.forEach((s, idx) => {
        if (s.kind === 'locked') return;
        for (const dest of moveDestinations(state, p, idx)) {
          opts.push({ type: 'resolvePlanet', choice: { dieIds: [d.id], shipIdx: idx, dest }, label: `Repeat move: ship #${idx + 1} → ${destLabel(dest)}` });
        }
      });
    }
  }
  return opts;
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
        // The 1-culture follow tax is paid first, so a culture-funded upgrade must
        // cover BOTH the tax and the upgrade cost from the same pool.
        const followTax = state.turn.oncePerTurn.includes('nibiru-follow-tax') ? 2 : 1;
        if (p.energy >= c) out.push({ type: 'follow', accept: true, params: { pay: 'energy' } });
        if (p.culture >= c + followTax) out.push({ type: 'follow', accept: true, params: { pay: 'culture' } });
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
    // NAGATO moves owed — but a surface-landing pendingChoice (above) resolves first.
    const pm = state.turn.pendingMoves;
    if (pm && pm.left > 0) return pm.player;
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
      return [...planetChoiceOptions(state, cp, pc.planetId), { type: 'skipPlanet' }];
    }

    const pm = state.turn.pendingMoves;
    if (pm && pm.left > 0 && pm.player === actor) {
      // NAGATO: choose the next ship move (or stop early).
      const mp = player(state, actor);
      const acts: Action[] = [];
      mp.ships.forEach((s, idx) => {
        if (s.kind === 'locked') return;
        for (const dest of moveDestinations(state, mp, idx)) {
          acts.push({ type: 'nagatoMove', shipIdx: idx, dest, label: `Move ship #${idx + 1} → ${destLabel(dest)}` });
        }
      });
      acts.push({ type: 'endMoves' });
      return acts;
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
  // Self-heal: a ship may only sit on/orbit a planet still in the center row.
  // (Repairs older saves where a discarded planet left a ship dangling — see the
  // HELIOS un-occupied fix. No-op for healthy games.)
  for (const pl of state.players) {
    pl.ships = pl.ships.map((s) =>
      (s.kind === 'orbit' || s.kind === 'surface') && !state.centerRow.includes(s.planetId)
        ? { kind: 'galaxy' as const }
        : s,
    );
  }

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
      const thenFollow = pc.thenFollow;
      // PIEDES (cp23) repeating a MOVE die: perform the move itself (the effects
      // layer can't, since destinations come from the adapter). The repeated move
      // may land on a surface and prompt for THAT planet's action, carrying the
      // deferred follow along — exactly like a normal move.
      // ZALAX (cp25): reroll the chosen inactive die, then re-prompt so the player
      // can reroll more or stop (skip). Already-rerolled dice are excluded above.
      if (pc.planetId === 'cp25' && action.choice?.dieIds?.length) {
        const id = action.choice.dieIds[0];
        rerollDice(state, [id]);
        const rerolled = [...(pc.rerolled ?? []), id];
        const more = state.turn.dice.some((d) => !d.activated && !d.inConverter && !rerolled.includes(d.id));
        if (more) {
          state.turn.pendingChoice = { ...pc, rerolled };
        } else {
          state.turn.pendingChoice = null;
          if (thenFollow) openFollowWindow(state, thenFollow);
        }
        state.log.push(`${p.name} rerolled a die`);
        break;
      }
      if (pc.planetId === 'cp23' && action.choice?.dest && action.choice.shipIdx != null) {
        const dest = action.choice.dest;
        const wasSurface = dest.kind === 'surface';
        state.turn.pendingChoice = null;
        state.log.push(`${p.name} repeated a move`);
        arrive(state, p, action.choice.shipIdx, dest, { interactive: true, thenFollow });
        if (!wasSurface && thenFollow) openFollowWindow(state, thenFollow);
        break;
      }
      const eff = PLANET_EFFECTS[pc.planetId];
      if (eff) state.log.push(eff(state, p, action.choice));
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
    case 'nagatoMove': {
      const pm = state.turn.pendingMoves;
      if (!pm || pm.player !== actor || pm.left <= 0) break;
      pm.left -= 1;
      const last = pm.left === 0;
      const tf = last ? pm.thenFollow : null; // NAGATO's follow opens only after all moves
      if (last) state.turn.pendingMoves = null;
      state.log.push(`${p.name} moved a ship`);
      const wasSurface = action.dest.kind === 'surface';
      // Interactive: a landing on a surface opens a pendingChoice that resolves
      // before the next NAGATO move (currentActor prioritises pendingChoice).
      arrive(state, p, action.shipIdx, action.dest, { interactive: true, thenFollow: tf });
      if (!wasSurface && tf) openFollowWindow(state, tf);
      break;
    }
    case 'endMoves': {
      const pm = state.turn.pendingMoves;
      if (!pm || pm.player !== actor) break;
      const tf = pm.thenFollow;
      state.turn.pendingMoves = null;
      if (tf) openFollowWindow(state, tf);
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
      const ok = applyFollowEffect(state, p, pf.face, action.params ?? {});
      if (ok) {
        state.turn.lastActivationFollows++;
        state.log.push(`${p.name} followed (${pf.face})`);
        // A followed action can colonize and win (e.g. completing an orbit track);
        // the early return above skips the end-of-applyMut check, so do it here.
        checkEnd(state, p);
      } else {
        // The copied action couldn't actually be performed — refund the follow tax.
        addResource(p, 'culture', cost);
      }
    }
  }
  if (pf.queue.length === 0) state.turn.pendingFollow = null;
}

/** Perform a copied action; returns false if it could not actually be carried out. */
function applyFollowEffect(state: GameState, p: PlayerState, face: DieFace, params: any): boolean {
  switch (face) {
    case 'energy':
    case 'culture':
      acquireFromGalaxy(state, p, face);
      return true;
    case 'move':
      // Interactive so a surface landing still prompts for its action choice (the
      // follower becomes the current actor via pendingChoice; the follow queue then
      // resumes). thenFollow stays null — we're already inside a follow window.
      if (params.shipIdx != null && params.dest) { arrive(state, p, params.shipIdx, params.dest, { interactive: true }); return true; }
      return false;
    case 'diplomacy':
    case 'economy':
      if (params.shipIdx != null) return advanceShip(state, p, params.shipIdx, face, 1);
      return false;
    case 'colony':
      if (params.planetId && p.colonized.includes(params.planetId)) {
        const eff = PLANET_EFFECTS[params.planetId];
        if (eff) { state.log.push(eff(state, p, params.choice)); return true; }
        return false;
      }
      if (params.pay) return upgradeEmpire(state, p, params.pay);
      return false;
  }
  return false;
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
