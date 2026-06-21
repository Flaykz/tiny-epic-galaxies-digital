import type { Action, ColonizeType, GameState, PlayerState, PlanetActionChoice } from './types.js';
import {
  acquireFromGalaxy,
  addResource,
  advanceShip,
  player,
  playerOrbiting,
  regressShip,
  surfaceOccupied,
  PLANET,
} from './helpers.js';
import { empire, MAX_EMPIRE } from './empire.js';
import { unlockShips } from './helpers.js';

// "Meta" planet actions that invoke other planets' actions — never auto-recurse
// into these (avoids infinite loops when a colony's action uses another colony).
const META = new Set(['cp3', 'cp6', 'cp23', 'cp28', 'cp35']);
// Safe, no-target beneficial actions an auto-picker may invoke on the player's behalf.
const SAFE_AUTO = ['cp12', 'cp29', 'cp18', 'cp16', 'cp13', 'cp30', 'cp15'];

// Effect of a planet's surface/utilize action. Returns a short log string.
// `choice` carries player-supplied targeting; when absent we auto-pick sensibly.
export type PlanetEffect = (state: GameState, p: PlayerState, choice?: PlanetActionChoice) => string;

function enemies(state: GameState, p: PlayerState): PlayerState[] {
  return state.players.filter((o) => o.id !== p.id);
}

function anyOrbitingShip(p: PlayerState): number | null {
  for (let i = 0; i < p.ships.length; i++) if (p.ships[i].kind === 'orbit') return i;
  return null;
}

function anyEnemyOrbiting(state: GameState, p: PlayerState): { player: string; shipIdx: number } | null {
  for (const e of enemies(state, p)) {
    for (let i = 0; i < e.ships.length; i++) if (e.ships[i].kind === 'orbit') return { player: e.id, shipIdx: i };
  }
  return null;
}

function doUpgrade(state: GameState, p: PlayerState, pay: 'energy' | 'culture' | 'either', discount = 0): string {
  if (p.empireLevel >= MAX_EMPIRE) return `${p.name} is already at max empire level`;
  const cost = Math.max(0, empire(p.empireLevel + 1).upgradeCost - discount);
  const useEnergy = pay === 'energy' || (pay === 'either' && p.energy >= cost);
  const have = useEnergy ? p.energy : p.culture;
  if (have < cost) return `${p.name} cannot afford the upgrade (${cost})`;
  addResource(p, useEnergy ? 'energy' : 'culture', -cost);
  p.empireLevel++;
  unlockShips(p);
  return `${p.name} upgraded empire to level ${p.empireLevel}`;
}

function advanceAuto(state: GameState, p: PlayerState, type: ColonizeType, steps: number, choice?: PlanetActionChoice): boolean {
  const idx = choice?.shipIdx;
  if (idx != null && advanceShip(state, p, idx, type, steps)) return true;
  // Auto-pick any orbiting ship matching the type.
  for (let i = 0; i < p.ships.length; i++) {
    const s = p.ships[i];
    if (s.kind === 'orbit' && PLANET(s.planetId)?.colonizeType === type) {
      return advanceShip(state, p, i, type, steps);
    }
  }
  return false;
}

function regressEnemyAuto(state: GameState, p: PlayerState, steps: number, choice?: PlanetActionChoice): boolean {
  const t = choice?.targetShip ?? anyEnemyOrbiting(state, p);
  if (!t) return false;
  regressShip(state, player(state, t.player), t.shipIdx, steps);
  return true;
}

function steal(state: GameState, p: PlayerState, kind: 'energy' | 'culture', choice?: PlanetActionChoice): string {
  const target = choice?.targetPlayer
    ? player(state, choice.targetPlayer)
    : enemies(state, p).find((e) => (kind === 'energy' ? e.energy : e.culture) > 0);
  if (!target) return `${p.name}: no resource to steal`;
  const have = kind === 'energy' ? target.energy : target.culture;
  if (have <= 0) return `${p.name}: target has no ${kind}`;
  addResource(target, kind, -1);
  addResource(p, kind, 1);
  return `${p.name} stole 1 ${kind} from ${target.name}`;
}

// Per-planet effects. Effects use helpers; complex multi-step cards are implemented
// faithfully where feasible and approximated (logged) where targeting is ambiguous.
export const PLANET_EFFECTS: Record<string, PlanetEffect> = {
  cp1: (s, p, c) => (advanceAuto(s, p, 'economy', 1, c) ? `${p.name} advanced +1 economy` : `${p.name}: no economy ship to advance`),
  cp4: (s, p, c) => (advanceAuto(s, p, 'diplomacy', 1, c) ? `${p.name} advanced +1 diplomacy` : `${p.name}: no diplomacy ship to advance`),
  cp14: (s, p, c) => advanceFlexible(s, p, 1, c),
  cp2: (s, p, c) => convertAll(s, p, 'energy', 'culture', c),
  cp36: (s, p, c) => convertAll(s, p, 'culture', 'energy', c),
  cp12: (s, p) => { addResource(p, 'energy', 2); return `${p.name} acquired 2 energy`; },
  cp29: (s, p) => { addResource(p, 'energy', 1); return `${p.name} acquired 1 energy`; },
  cp18: (s, p) => { addResource(p, 'culture', 1); return `${p.name} acquired 1 culture`; },
  cp19: (s, p) => { if (p.energy < 1) return `${p.name}: needs 1 energy`; addResource(p, 'energy', -1); addResource(p, 'culture', 2); return `${p.name} spent 1 energy, acquired 2 culture`; },
  cp16: (s, p) => { addResource(p, 'energy', 2); enemies(s, p).forEach((e) => addResource(e, 'energy', 1)); return `${p.name} acquired 2 energy; others +1 energy`; },
  cp13: (s, p) => { addResource(p, 'culture', 2); enemies(s, p).forEach((e) => addResource(e, 'culture', 1)); return `${p.name} acquired 2 culture; others +1 culture`; },
  cp15: (s, p) => doUpgrade(s, p, 'either'),
  cp11: (s, p) => { const lowest = Math.min(...s.players.map((q) => q.empireLevel)); return doUpgrade(s, p, 'either', p.empireLevel === lowest ? 1 : 0); },
  cp20: (s, p, c) => steal(s, p, 'energy', c),
  cp31: (s, p, c) => steal(s, p, 'culture', c),
  cp32: (s, p, c) => (regressEnemyAuto(s, p, 1, c) ? `${p.name} regressed an enemy ship -1` : `${p.name}: no enemy ship to regress`),
  cp10: (s, p, c) => { if (p.culture < 2) return `${p.name}: needs 2 culture`; addResource(p, 'culture', -2); return regressEnemyAuto(s, p, 2, c) ? `${p.name} regressed an enemy ship -2` : `${p.name}: no target`; },
  cp33: (s, p, c) => { if (p.energy < 1) return `${p.name}: needs 1 energy`; addResource(p, 'energy', -1); return regressEnemyAuto(s, p, 1, c) ? `${p.name} regressed an enemy ship -1` : `${p.name}: no target`; },
  cp34: (s, p, c) => (regressEnemyAuto(s, p, 1, c) ? `${p.name} regressed an enemy ship -1` : `${p.name}: no target`),
  cp40: (s, p, c) => { if (p.energy < 2) return `${p.name}: needs 2 energy`; addResource(p, 'energy', -2); let n = 0; for (const e of enemies(s, p)) { for (let i = 0; i < e.ships.length && n < 2; i++) if (e.ships[i].kind === 'orbit') { regressShip(s, e, i, 1); n++; } } return `${p.name} regressed ${n} enemy ship(s) -1`; },
  cp27: (s, p, c) => { if (p.energy < 2) return `${p.name}: needs 2 energy`; addResource(p, 'energy', -2); return advanceAuto(s, p, 'economy', 2, c) ? `${p.name} advanced +2 economy` : `${p.name}: no economy ship`; },
  cp37: (s, p, c) => { if (p.culture < 2) return `${p.name}: needs 2 culture`; addResource(p, 'culture', -2); return advanceAuto(s, p, 'diplomacy', 2, c) ? `${p.name} advanced +2 diplomacy` : `${p.name}: no diplomacy ship`; },
  cp5: (s, p, c) => { const ids = (c?.dieIds ?? []).slice(0, 2); ids.forEach((id) => { const d = s.turn.dice.find((x) => x.id === id); if (d) d.inConverter = true; }); addResource(p, 'energy', 2); addResource(p, 'culture', 2); return `${p.name} discarded ${ids.length} dice, acquired 2 energy + 2 culture`; },
  cp9: (s, p, c) => { const id = c?.dieIds?.[0]; const face = c?.face; const d = s.turn.dice.find((x) => x.id === id && !x.activated && !x.inConverter); if (d && face) { d.face = face; return `${p.name} set a die to ${face}`; } return `${p.name}: no die set`; },
  cp25: (s, p, c) => rerollInactive(s, p, c),
  cp30: (s, p) => { const home = p.ships.filter((x) => x.kind === 'galaxy').length; addResource(p, 'culture', home); return `${p.name} acquired ${home} culture (1 per ship in your galaxy)`; },
  cp17: (s, p) => { const n = s.turn.lastActivationFollows; addResource(p, 'culture', n); return `${p.name} acquired ${n} culture from follows`; },
  cp26: (s, p) => { const n = s.turn.lastActivationFollows; addResource(p, 'energy', n); return `${p.name} acquired ${n} energy from follows`; },
  cp7: (s, p, c) => { const a = c?.shipIdx, b = c?.shipIdx2; if (a != null) regressShip(s, p, a, 1); let adv = false; if (b != null) { const sb = p.ships[b]; if (sb.kind === 'orbit') adv = advanceShip(s, p, b, PLANET(sb.planetId)!.colonizeType, 1); } return `${p.name} regressed one ship, advanced another${adv ? '' : ' (if possible)'}`; },
  cp24: (s, p, c) => { enemies(s, p).forEach((e) => { for (let i = 0; i < e.ships.length; i++) { const sh = e.ships[i]; if (sh.kind === 'orbit') { advanceShip(s, e, i, PLANET(sh.planetId)!.colonizeType, 1); break; } } }); advanceFlexible(s, p, 2, c); return `${p.name}: others advanced +1, you advanced +2`; },
  cp22: (s, p, c) => { const idx = c?.shipIdx ?? anyOrbitingShip(p); const dest = c?.dest; if (idx != null && dest && dest.kind === 'orbit') { p.ships[idx] = dest; return `${p.name} moved a ship to another colony track`; } return `${p.name}: no valid move`; },
  cp39: (s, p, c) => { const idx = c?.shipIdx ?? anyOrbitingShip(p); if (idx != null && p.ships[idx].kind === 'orbit') { const lvl = (p.ships[idx] as { level: number }).level; p.ships[idx] = { kind: 'galaxy' }; const kind = c?.resource ?? 'energy'; addResource(p, kind, lvl); return `${p.name} displaced a ship, acquired ${lvl} ${kind}`; } return `${p.name}: no orbiting ship`; },
  cp21: (s, p) => {
    if (p.culture < 1) return `${p.name}: needs 1 culture`;
    addResource(p, 'culture', -1);
    let moved = 0;
    for (let i = 0; i < p.ships.length && moved < 2; i++) {
      const sh = p.ships[i];
      if (sh.kind === 'orbit') { advanceShip(s, p, i, PLANET(sh.planetId)!.colonizeType, 1); moved++; }
    }
    return `${p.name} spent 1 culture to advance ${moved} ship(s)`;
  },
  cp3: (s, p, c) => {
    const f = c?.face;
    if (f === 'energy' || f === 'culture') { const g = acquireFromGalaxy(s, p, f); return `${p.name} took a free Acquire — +${g} ${f}`; }
    if (f === 'diplomacy' || f === 'economy') {
      if (c?.shipIdx != null && advanceShip(s, p, c.shipIdx, f, 1)) return `${p.name} took a free Advance (${f})`;
      return `${p.name}: free advance had no valid ship`;
    }
    if (f === 'colony') return `${p.name} took a free Upgrade — ` + doUpgrade(s, p, c?.resource ?? 'either');
    return `${p.name} took a free action — ` + advanceFlexible(s, p, 1, c);
  },
  cp6: (s, p, c) => useOthersColony(s, p, 'culture', c),
  cp35: (s, p, c) => useOthersColony(s, p, 'energy', c),
  cp8: (s, p, c) => { const target = c?.planetId; if (target && s.centerRow.includes(target)) { s.centerRow = s.centerRow.filter((id) => id !== target); if (s.deck.length) s.centerRow.push(s.deck.shift()!); return `${p.name} replaced a planet in the row`; } return `${p.name}: pick a planet to replace`; },
  cp23: (s, p, c) => {
    const used = s.turn.dice.filter((d) => d.activated && !d.inConverter);
    // If a specific die was chosen, repeat that one; else best-by-priority.
    const chosen = c?.dieIds?.[0] != null ? used.find((d) => d.id === c!.dieIds![0]) : null;
    const order: ReadonlyArray<'economy' | 'diplomacy' | 'energy' | 'culture' | 'colony'> =
      chosen ? [chosen.face as any] : ['economy', 'diplomacy', 'energy', 'culture', 'colony'];
    for (const face of order) {
      if (!used.some((d) => d.face === face)) continue;
      if (face === 'energy' || face === 'culture') { const g = acquireFromGalaxy(s, p, face); return `${p.name} repeated a die — acquired ${g} ${face}`; }
      if (face === 'economy' || face === 'diplomacy') { if (advanceAuto(s, p, face, 1, c)) return `${p.name} repeated a die — advanced (${face})`; }
      if (face === 'colony') { return `${p.name} repeated a colony die — ` + doUpgrade(s, p, 'either'); }
    }
    return `${p.name}: no activated die to repeat`;
  },
  cp28: (s, p, c) => {
    const id = c?.planetId ?? s.centerRow.find((pid) => SAFE_AUTO.includes(pid) && !META.has(pid));
    if (id && PLANET_EFFECTS[id] && !META.has(id)) return `${p.name} used uncolonized ${PLANET(id)?.name} — ` + PLANET_EFFECTS[id](s, p);
    return `${p.name}: no suitable un-colonized planet to use`;
  },
  cp38: (s, p) => { s.turn.oncePerTurn.push('nibiru-follow-tax'); return `${p.name}: enemies pay 2 culture per follow this turn`; },
};

function useOthersColony(state: GameState, p: PlayerState, pay: 'energy' | 'culture', c?: PlanetActionChoice): string {
  if ((pay === 'energy' ? p.energy : p.culture) < 1) return `${p.name}: needs 1 ${pay}`;
  // Honor a chosen owner+colony if supplied, else first available.
  let owner: PlayerState | undefined;
  let pid: string | undefined;
  if (c?.targetPlayer && c?.planetId) {
    owner = player(state, c.targetPlayer);
    pid = c.planetId;
  } else {
    for (const o of enemies(state, p)) {
      const found = o.colonized.find((id) => !META.has(id) && PLANET_EFFECTS[id]);
      if (found) { owner = o; pid = found; break; }
    }
  }
  if (owner && pid && !META.has(pid)) {
    addResource(p, pay, -1);
    addResource(owner, pay, 1);
    return `${p.name} paid 1 ${pay} to ${owner.name} to use ${PLANET(pid)?.name} — ` + PLANET_EFFECTS[pid](state, p);
  }
  return `${p.name}: no other player's colony available to utilize`;
}

function advanceFlexible(state: GameState, p: PlayerState, steps: number, c?: PlanetActionChoice): string {
  // Advance a ship of either type — try the supplied ship, else any orbiting ship.
  if (c?.shipIdx != null) {
    const s = p.ships[c.shipIdx];
    if (s.kind === 'orbit' && advanceShip(state, p, c.shipIdx, PLANET(s.planetId)!.colonizeType, steps))
      return `${p.name} advanced a ship +${steps}`;
  }
  for (let i = 0; i < p.ships.length; i++) {
    const s = p.ships[i];
    if (s.kind === 'orbit') { advanceShip(state, p, i, PLANET(s.planetId)!.colonizeType, steps); return `${p.name} advanced a ship +${steps}`; }
  }
  return `${p.name}: no orbiting ship to advance`;
}

function convertAll(state: GameState, p: PlayerState, from: 'energy' | 'culture', to: 'energy' | 'culture', c?: PlanetActionChoice): string {
  const n = c?.amount ?? (from === 'energy' ? p.energy : p.culture);
  const have = from === 'energy' ? p.energy : p.culture;
  const amt = Math.min(n, have);
  addResource(p, from, -amt);
  addResource(p, to, amt);
  return `${p.name} converted ${amt} ${from} into ${to}`;
}

function rerollInactive(state: GameState, p: PlayerState, c?: PlanetActionChoice): string {
  const ids = c?.dieIds ?? state.turn.dice.filter((d) => !d.activated && !d.inConverter).map((d) => d.id);
  // Reroll handled by adapter via rng; here we just mark intent. The adapter's
  // colony-planet handler performs the reroll using rng before calling effects.
  return `${p.name} rerolled ${ids.length} inactive dice`;
}

/** Planets whose effect needs the rng (reroll/set die) — adapter rerolls before invoking. */
export const REROLL_PLANETS = new Set(['cp25']);

// ---- Interactive target options ----

const FACE_LABEL: Record<string, string> = {
  move: 'Move', energy: 'Energy', culture: 'Culture',
  diplomacy: 'Diplomacy', economy: 'Economy', colony: 'Colony',
};

function opt(choice: PlanetActionChoice, label: string): Action {
  return { type: 'resolvePlanet', choice, label };
}

/** Short description of where ship #idx currently is (for choice button labels). */
function shipDesc(p: PlayerState, idx: number): string {
  const s = p.ships[idx];
  if (!s) return '';
  if (s.kind === 'galaxy') return 'home';
  if (s.kind === 'locked') return 'locked';
  if (s.kind === 'surface') return `on ${PLANET(s.planetId)?.name}`;
  return `orbiting ${PLANET(s.planetId)?.name} ${s.level === 0 ? 'start' : `sp.${s.level}`}`;
}

function myOrbiting(p: PlayerState, type?: ColonizeType): number[] {
  const out: number[] = [];
  p.ships.forEach((s, i) => {
    if (s.kind === 'orbit' && (!type || PLANET(s.planetId)?.colonizeType === type)) out.push(i);
  });
  return out;
}

function enemyOrbiting(state: GameState, p: PlayerState) {
  const out: { player: string; shipIdx: number; name: string; planet?: string; level: number }[] = [];
  for (const e of enemies(state, p)) {
    e.ships.forEach((s, i) => {
      if (s.kind === 'orbit') out.push({ player: e.id, shipIdx: i, name: e.name, planet: PLANET(s.planetId)?.name, level: s.level });
    });
  }
  return out;
}

/**
 * The concrete, player-choosable target options for a planet action. Returns []
 * when the action needs no choice (resolves automatically). Each entry is a
 * `resolvePlanet` action carrying the chosen parameters and a UI label.
 */
export function planetOptions(state: GameState, p: PlayerState, planetId: string): Action[] {
  const advOpts = (type?: ColonizeType) =>
    myOrbiting(p, type).map((i) => {
      const s = p.ships[i] as { planetId: string; level: number };
      const pl = PLANET(s.planetId);
      return opt({ shipIdx: i }, `Advance ship #${i + 1} on ${pl?.name} (${s.level}/${pl?.orbitTrackLength})`);
    });
  const regressOpts = () =>
    enemyOrbiting(state, p).map((t) =>
      opt({ targetShip: { player: t.player, shipIdx: t.shipIdx } }, `Regress ${t.name}'s ship on ${t.planet} (space ${t.level})`));
  const stealOpts = (res: 'energy' | 'culture') =>
    enemies(state, p).filter((e) => (res === 'energy' ? e.energy : e.culture) > 0)
      .map((e) => opt({ targetPlayer: e.id }, `Steal 1 ${res} from ${e.name} (has ${res === 'energy' ? e.energy : e.culture})`));

  const range = (max: number, fn: (n: number) => Action) =>
    Array.from({ length: Math.max(0, max) }, (_, i) => fn(i + 1));

  switch (planetId) {
    case 'cp2': return range(p.energy, (n) => opt({ amount: n }, `Convert ${n} energy → culture`));
    case 'cp36': return range(p.culture, (n) => opt({ amount: n }, `Convert ${n} culture → energy`));
    case 'cp3': {
      const out: Action[] = [
        opt({ face: 'energy' }, 'Free action: Acquire energy'),
        opt({ face: 'culture' }, 'Free action: Acquire culture'),
      ];
      myOrbiting(p, 'diplomacy').forEach((i) => out.push(opt({ face: 'diplomacy', shipIdx: i }, `Free action: Advance ship #${i + 1} (diplomacy)`)));
      myOrbiting(p, 'economy').forEach((i) => out.push(opt({ face: 'economy', shipIdx: i }, `Free action: Advance ship #${i + 1} (economy)`)));
      if (p.empireLevel < MAX_EMPIRE) {
        const cst = empire(p.empireLevel + 1).upgradeCost;
        if (p.energy >= cst) out.push(opt({ face: 'colony', resource: 'energy' }, `Free action: Upgrade empire (pay ${cst} energy)`));
        if (p.culture >= cst) out.push(opt({ face: 'colony', resource: 'culture' }, `Free action: Upgrade empire (pay ${cst} culture)`));
      }
      return out;
    }
    case 'cp1': return advOpts('economy');
    case 'cp4': return advOpts('diplomacy');
    case 'cp14': return advOpts();
    case 'cp24': return advOpts();
    case 'cp27': return advOpts('economy');
    case 'cp37': return advOpts('diplomacy');
    case 'cp10': case 'cp32': case 'cp33': case 'cp34': return regressOpts();
    case 'cp20': return stealOpts('energy');
    case 'cp31': return stealOpts('culture');
    case 'cp23':
      return state.turn.dice.filter((d) => d.activated && !d.inConverter)
        .map((d) => opt({ dieIds: [d.id] }, `Repeat the ${FACE_LABEL[d.face]} die`));
    case 'cp9': {
      const out: Action[] = [];
      for (const d of state.turn.dice.filter((x) => !x.activated && !x.inConverter)) {
        for (const f of ['move', 'energy', 'culture', 'diplomacy', 'economy', 'colony'] as const) {
          if (f === d.face) continue;
          out.push(opt({ dieIds: [d.id], face: f }, `Set a ${FACE_LABEL[d.face]} die → ${FACE_LABEL[f]}`));
        }
      }
      return out;
    }
    case 'cp39': {
      const out: Action[] = [];
      myOrbiting(p).forEach((i) => {
        const lvl = (p.ships[i] as { level: number }).level;
        out.push(opt({ shipIdx: i, resource: 'energy' }, `Displace ship #${i + 1} (${shipDesc(p, i)}) → +${lvl} energy`));
        out.push(opt({ shipIdx: i, resource: 'culture' }, `Displace ship #${i + 1} (${shipDesc(p, i)}) → +${lvl} culture`));
      });
      return out;
    }
    case 'cp22': {
      const out: Action[] = [];
      myOrbiting(p).forEach((i) => {
        const s = p.ships[i] as { planetId: string; level: number };
        for (const pid of state.centerRow) {
          if (pid === s.planetId) continue;
          const pl = PLANET(pid);
          if (!pl || s.level > pl.orbitTrackLength || playerOrbiting(p, pid) != null) continue;
          out.push(opt({ shipIdx: i, dest: { kind: 'orbit', planetId: pid, level: s.level } }, `Move ship #${i + 1} (${shipDesc(p, i)}) → ${pl.name} (space ${s.level})`));
        }
      });
      return out;
    }
    case 'cp7': {
      const out: Action[] = [];
      const ships = myOrbiting(p);
      for (const a of ships) for (const b of ships) {
        if (a === b) continue;
        out.push(opt({ shipIdx: a, shipIdx2: b }, `Regress ship #${a + 1} (${shipDesc(p, a)}), advance ship #${b + 1} (${shipDesc(p, b)})`));
      }
      return out;
    }
    case 'cp8':
      return state.centerRow.filter((pid) => !surfaceOccupied(state, pid))
        .map((pid) => opt({ planetId: pid }, `Discard & replace ${PLANET(pid)?.name}`));
    case 'cp28':
      return state.centerRow.filter((pid) => !META.has(pid) && PLANET_EFFECTS[pid])
        .map((pid) => opt({ planetId: pid }, `Use ${PLANET(pid)?.name}'s action`));
    case 'cp6': case 'cp35': {
      const out: Action[] = [];
      for (const e of enemies(state, p)) {
        for (const pid of e.colonized) {
          if (META.has(pid) || !PLANET_EFFECTS[pid]) continue;
          out.push(opt({ targetPlayer: e.id, planetId: pid }, `Pay ${e.name} to use ${PLANET(pid)?.name}`));
        }
      }
      return out;
    }
    default:
      return [];
  }
}
