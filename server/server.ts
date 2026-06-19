import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GameServer } from 'digital-boardgame-framework/server';
import { FsStore } from 'digital-boardgame-framework/server/node';
import { jsonCodec } from 'digital-boardgame-framework';
import { tegAdapter, createInitialState } from '../src/engine/index.js';
import type { Action, GameState } from '../src/engine/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.PUBLIC_URL ?? 'http://localhost:5173';

const store = new FsStore(join(__dirname, '..', '.data'));

const server = new GameServer<GameState, Action, string>({
  adapter: tegAdapter,
  codec: jsonCodec<GameState>(),
  store,
  gameUrl: (gameId, token) => `${PUBLIC_URL}/?game=${gameId}&token=${token}`,
});

function json(res: import('node:http').ServerResponse, code: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(data);
}

async function readBody(req: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const http = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const token = url.searchParams.get('token') ?? '';

    if (req.method === 'OPTIONS') return json(res, 204, {});

    // POST /api/games  -> create a game
    if (req.method === 'POST' && parts[0] === 'games' && parts.length === 1) {
      const body = await readBody(req);
      const names: string[] = body.names ?? ['Player 1', 'Player 2'];
      const players = names.map((_, i) => `p${i + 1}`);
      const initialState = createInitialState({
        seats: names.map((name: string) => ({ name })),
        seed: Math.floor(Math.random() * 1e9),
      });
      const result = await server.createGame({ initialState, players });
      return json(res, 200, result);
    }

    // /api/games/:id ...
    if (parts[0] === 'games' && parts[1]) {
      const gameId = parts[1];
      const sub = parts[2];

      if (req.method === 'GET' && !sub) {
        return json(res, 200, await server.fetch(gameId, token));
      }
      if (req.method === 'GET' && sub === 'legal') {
        return json(res, 200, await server.legalActions(gameId, token));
      }
      if (req.method === 'POST' && sub === 'actions') {
        const action = await readBody(req);
        return json(res, 200, await server.submit(gameId, token, action));
      }
      if (req.method === 'POST' && sub === 'report') {
        const body = await readBody(req);
        return json(res, 200, await server.report(gameId, token, body));
      }
    }

    return json(res, 404, { error: 'not found' });
  } catch (e: any) {
    return json(res, 400, { error: String(e?.message ?? e) });
  }
});

http.listen(PORT, () => {
  console.log(`TEG multiplayer server on http://localhost:${PORT}`);
  console.log(`Frontend expected at ${PUBLIC_URL}`);
});
