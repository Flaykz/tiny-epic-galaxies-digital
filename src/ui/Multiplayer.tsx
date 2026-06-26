import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, useIdentity, SignInBar } from 'digital-boardgame-framework/client';
import { makeHttpClient, createGame, claimSeat } from '../client/httpClient.js';
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
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (seat: string, link: string) => {
    navigator.clipboard?.writeText(link);
    setCopied(seat);
    setTimeout(() => setCopied((c) => (c === seat ? null : c)), 1500);
  };

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
            <p>Game <code>{gameId}</code> created. Open <strong>your</strong> seat and send the others their link:</p>
            <ul>
              {Object.entries(invites).map(([seat, link], i) => (
                // `link` is already the full invite URL the server built (gameUrl).
                <li key={seat}>
                  <div className="invite-row">
                    <strong>{seat}{i === 0 ? ' (you)' : ''}</strong>
                    <button
                      className="primary small"
                      onClick={() => window.open(link, '_blank', 'noopener')}
                    >
                      Open seat ↗
                    </button>
                    <button onClick={() => copy(seat, link)}>
                      {copied === seat ? 'Copied!' : 'Copy link'}
                    </button>
                  </div>
                  <a className="invite-link" href={link} target="_blank" rel="noreferrer">{link}</a>
                </li>
              ))}
            </ul>
            <p className="muted small">Each seat opens in a new tab so this list stays put.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MultiplayerGame({ gameId, token, onExit }: { gameId: string; token: string; onExit: () => void }) {
  const client = useMemo(() => makeHttpClient(gameId, token), [gameId, token]);
  const game = useGame<GameState, Action>(client, { pollMs: 1000 });

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
