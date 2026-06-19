import React, { useMemo, useState } from 'react';
import { useGame } from 'digital-boardgame-framework/client';
import { makeHttpClient, createGame } from '../client/httpClient.js';
import { Board } from './Board.js';
import type { Action, GameState } from '../engine/index.js';

export function MultiplayerApp({ onExit }: { onExit: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('game');
  const token = params.get('token');

  if (gameId && token) {
    return <MultiplayerGame gameId={gameId} token={token} onExit={onExit} />;
  }
  return <MultiplayerLobby onExit={onExit} />;
}

function MultiplayerLobby({ onExit }: { onExit: () => void }) {
  const [count, setCount] = useState(2);
  const [invites, setInvites] = useState<Record<string, string> | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const names = Array.from({ length: count }, (_, i) => `Player ${i + 1}`);
      const res = await createGame(names);
      setGameId(res.gameId);
      setInvites(res.invites);
    } catch (e: any) {
      setError(`Could not reach the server. Start it with "npm run server". (${e?.message ?? e})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lobby">
      <button className="exit-btn" onClick={onExit}>← Lobby</button>
      <div className="lobby-card">
        <h1>Async Multiplayer</h1>
        {!invites ? (
          <>
            <div className="counter">
              <label>Players</label>
              <button onClick={() => setCount((n) => Math.max(2, n - 1))}>−</button>
              <span>{count}</span>
              <button onClick={() => setCount((n) => Math.min(5, n + 1))}>+</button>
            </div>
            <button className="primary" disabled={busy} onClick={create}>
              {busy ? 'Creating…' : 'Create game'}
            </button>
            {error && <p className="error">{error}</p>}
          </>
        ) : (
          <div className="invites">
            <p>Game <code>{gameId}</code> created. Share one link per player:</p>
            <ul>
              {Object.entries(invites).map(([seat, link]) => (
                // `link` is already the full invite URL the server built (gameUrl).
                <li key={seat}>
                  <strong>{seat}</strong>:{' '}
                  <a href={link}>{link}</a>{' '}
                  <button onClick={() => navigator.clipboard?.writeText(link)}>copy</button>
                </li>
              ))}
            </ul>
            <p className="muted small">Open your own seat's link to start playing.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MultiplayerGame({ gameId, token, onExit }: { gameId: string; token: string; onExit: () => void }) {
  const client = useMemo(() => makeHttpClient(gameId, token), [gameId, token]);
  const game = useGame<GameState, Action>(client, { pollMs: 2500 });

  if (game.loading && !game.view) return <div className="loading">Connecting…</div>;
  if (game.error) return <div className="loading error">Error: {game.error.message}</div>;
  if (!game.view || !game.you) return <div className="loading">Loading…</div>;

  return (
    <div className="game-shell">
      <button className="exit-btn" onClick={() => { window.history.replaceState({}, '', '/'); onExit(); }}>← Lobby</button>
      <Board
        state={game.view}
        viewer={game.you}
        canAct={game.yourTurn}
        legalActions={game.legalActions}
        onAction={(a) => game.submit(a)}
        onReport={(message) => game.reportBug(message)}
      />
    </div>
  );
}
