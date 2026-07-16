import { Rng } from 'digital-boardgame-framework';
import type { Action, GameState } from './types.js';
import { tegAdapter } from './adapter.js';
import { baseVp, player, PLANET } from './helpers.js';

// A greedy heuristic AI used for AI seats and the Rogue Galaxy.
// It scores the resulting state after each legal action and picks the best,
// favouring colonization, advancing, upgrading, then acquiring resources.

export interface AiWeights {
  vp: number;        // weight on actual victory points (empire + colonized planets)
  empire: number;    // small bonus per empire level (dice/ships compound)
  resource: number;  // value of held energy/culture (low = spend, don't hoard)
  orbit: number;     // value of orbit progress toward colonizing (× planet VP)
  deployed: number;  // bonus per ship off the home mat (out doing things)
}

// Tuned to spend resources and push colonization (vs the original hoarding profile).
export const DEFAULT_WEIGHTS: AiWeights = {
  vp: 12, empire: 1.5, resource: 0.15, orbit: 2.2, deployed: 0.4,
};

export function chooseAction(state: GameState, actor: string, seed = 1, w: AiWeights = DEFAULT_WEIGHTS): Action {
  const actions = tegAdapter.legalActions(state, actor);
  if (actions.length === 0) return { type: 'endTurn' };

  // Follow decisions run through the same greedy evaluation: decline is
  // actions[0], so an accept option is only taken when the copied action is
  // worth more than the culture it costs (e.g. an advance that colonizes).

  const rng = new Rng(seed + state.turnNumber);
  let best: Action = actions[0];
  let bestScore = -Infinity;

  for (const a of actions) {
    if (a.type === 'endTurn') continue; // only end when nothing better
    let score: number;
    try {
      const after = tegAdapter.applyAction(state, a, actor);
      score = evaluate(after, actor, w) + rng.next() * 0.01;
    } catch {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }

  // If the best non-end action doesn't improve our position, end the turn.
  const now = evaluate(state, actor, w);
  if (bestScore <= now + 0.001 && actions.some((a) => a.type === 'endTurn')) {
    return { type: 'endTurn' };
  }
  return best;
}

function evaluate(state: GameState, actor: string, w: AiWeights): number {
  const p = player(state, actor);
  let score = baseVp(state, p) * w.vp;
  score += p.empireLevel * w.empire;
  score += (p.energy + p.culture) * w.resource;
  for (const s of p.ships) {
    if (s.kind === 'orbit') {
      const planet = PLANET(s.planetId);
      // Reward orbit progress toward colonizing, scaled by the planet's value.
      // The +0.5 values merely BEING in orbit (colonization potential) — without
      // it, entering a track at level 0 scores the same as a surface landing, so
      // the greedy 1-ply AI never starts colonizing (it takes the surface
      // action's immediate payoff instead).
      if (planet) score += ((s.level + 0.5) / planet.orbitTrackLength) * planet.vp * w.orbit;
      score += w.deployed;
    } else if (s.kind === 'surface') {
      score += w.deployed;
    }
  }
  return score;
}
