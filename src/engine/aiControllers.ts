// Server-side AI opponents for Tiny Epic Galaxies. Keyed by difficulty — these
// keys are the rating-id suffixes the AI plays under on the leaderboard (e.g.
// `ai:tiny-epic-galaxies:easy`). Bump a key (e.g. 'easy@2') if you ever change
// an AI's strength so it earns a fresh rating instead of dragging the old one.
//
// All three reuse the existing greedy 1-ply `chooseAction` heuristic — it's
// cheap (no deep search), so it fits a Cloudflare Worker CPU budget. The tiers
// differ only in evaluation weights and a little exploration noise: Easy hoards
// and wanders, Hard plays the tuned colonization-pushing profile.
import type { PlayerController } from 'digital-boardgame-framework';
import { chooseAction, DEFAULT_WEIGHTS, type AiWeights } from './ai.js';
import type { Action, GameState } from './types.js';

// Easy: values resources highly (hoards), weak colonization drive → loses tempo.
const EASY: AiWeights = { vp: 8, empire: 1, resource: 1.2, orbit: 0.8, deployed: 0.2 };
// Medium: a middle ground between hoarding and the tuned aggressive profile.
const MEDIUM: AiWeights = { vp: 10, empire: 1.2, resource: 0.5, orbit: 1.5, deployed: 0.3 };
// Hard: the tuned profile — spend resources, push colonization.
const HARD: AiWeights = DEFAULT_WEIGHTS;

function controller(weights: AiWeights, jitter: number): PlayerController<GameState, Action, string> {
  return {
    selectAction: async (ctx) => {
      // Mix a per-call seed so Easy/Medium make a few suboptimal choices rather
      // than always greedily-best (the heuristic itself already adds tiny noise).
      const seed = ctx.state.turnNumber * 31 + 7 + Math.floor(ctx.rng.next() * jitter);
      return chooseAction(ctx.state, ctx.actor, seed, weights);
    },
  };
}

export const tegAiControllers: Record<string, PlayerController<GameState, Action, string>> = {
  // @2: the AI now evaluates follow offers (instead of always declining) and
  // values orbit presence, so it actually colonizes — a real strength jump.
  'easy@2': controller(EASY, 1000),
  'medium@2': controller(MEDIUM, 200),
  'hard@2': controller(HARD, 0),
  // Legacy keys so in-flight games (and cached clients) keep resolving; they
  // finish under the old rating ids, while new games rate under @2.
  easy: controller(EASY, 1000),
  medium: controller(MEDIUM, 200),
  hard: controller(HARD, 0),
};
