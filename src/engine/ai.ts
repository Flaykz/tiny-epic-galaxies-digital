import { Rng } from 'digital-boardgame-framework';
import type { Action, GameState } from './types.js';
import { tegAdapter } from './adapter.js';
import { baseVp, player, PLANET } from './helpers.js';

// A greedy heuristic AI used for AI seats and the Rogue Galaxy.
// It scores the resulting state after each legal action and picks the best,
// favouring colonization, advancing, upgrading, then acquiring resources.
export function chooseAction(state: GameState, actor: string, seed = 1): Action {
  const actions = tegAdapter.legalActions(state, actor);
  if (actions.length === 0) return { type: 'endTurn' };

  // Follow decisions: decline by default (keeps culture).
  if (actions.some((a) => a.type === 'follow')) {
    return { type: 'follow', accept: false };
  }

  const rng = new Rng(seed + state.turnNumber);
  let best: Action = actions[0];
  let bestScore = -Infinity;

  for (const a of actions) {
    if (a.type === 'endTurn') continue; // only end when nothing better
    let score: number;
    try {
      const after = tegAdapter.applyAction(state, a, actor);
      score = evaluate(after, actor) + rng.next() * 0.01;
    } catch {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }

  // If the best non-end action doesn't improve our position, end the turn.
  const now = evaluate(state, actor);
  if (bestScore <= now + 0.001 && actions.some((a) => a.type === 'endTurn')) {
    return { type: 'endTurn' };
  }
  return best;
}

function evaluate(state: GameState, actor: string): number {
  const p = player(state, actor);
  let score = baseVp(state, p) * 10;
  score += p.empireLevel * 2;
  score += (p.energy + p.culture) * 0.5;
  // Reward orbiting progress toward colonization.
  for (const s of p.ships) {
    if (s.kind === 'orbit') {
      const planet = PLANET(s.planetId);
      if (planet) score += (s.level / planet.orbitTrackLength) * planet.vp * 0.8;
    }
  }
  return score;
}
