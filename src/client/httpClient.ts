import { submitReportViaHttp } from 'digital-boardgame-framework/client';
import type { GameClientApi } from 'digital-boardgame-framework/client';
import type { Action, GameState } from '../engine/index.js';

const API = '/api';

interface ViewResult {
  view: GameState;
  yourTurn: boolean;
  turn: number;
  gameOver: boolean;
  you?: string;
}

/** GameClientApi over the dev HTTP server, for the framework's useGame hook. */
export function makeHttpClient(gameId: string, token: string): GameClientApi<GameState, Action> {
  const q = `?token=${encodeURIComponent(token)}`;
  return {
    async fetch() {
      const r = await fetch(`${API}/games/${gameId}${q}`);
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ViewResult;
    },
    async submit(action) {
      const r = await fetch(`${API}/games/${gameId}/actions${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `submit failed: ${r.status}`);
      return (await r.json()) as ViewResult;
    },
    async legalActions() {
      const r = await fetch(`${API}/games/${gameId}/legal${q}`);
      if (!r.ok) throw new Error(`legal failed: ${r.status}`);
      return (await r.json()) as Action[];
    },
    async report(submission) {
      return submitReportViaHttp(`${API}/games/${gameId}/report${q}`, submission);
    },
  };
}

export async function createGame(names: string[]): Promise<{ gameId: string; invites: Record<string, string> }> {
  const r = await fetch(`${API}/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ names }),
  });
  if (!r.ok) throw new Error(`create failed: ${r.status}`);
  return r.json();
}
