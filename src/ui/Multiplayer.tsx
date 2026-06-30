import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Keeps a transient render error (e.g. a polled view momentarily out of sync with
 * legalActions) from white-screening the whole app. Reset by `resetKey` (the turn
 * number), so the next poll remounts a clean Board instead of staying broken.
 */
class BoardBoundary extends React.Component<{ resetKey: unknown; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { resetKey: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <div className="loading">Syncing…</div>;
    return this.props.children;
  }
}
import { useGame, useIdentity, SignInBar, RankedStatus } from 'digital-boardgame-framework/client';
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

  // Create a 2-player game where seat p2 is a server-driven, rated AI ('easy'),
  // then take the human straight to their seat (p1). The AI plays under
  // `ai:tiny-epic-galaxies:easy` on the leaderboard.
  const createVsAi = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createGame(['You', '🤖 AI (easy)'], { p2: 'easy' });
      const mySeat = res.invites.p1;
      if (mySeat) window.location.assign(mySeat);
    } catch (e: any) {
      setError(`Could not reach the server. Start it with "npm run server". (${e?.message ?? e})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lobby">
      <button className="exit-btn" onClick={onExit}>← Lobby</button>
      <SignInBar leaderboardHref="https://games-hub-5vo.pages.dev" />
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
            <div className="vs-ai">
              <button className="primary" disabled={busy} onClick={createVsAi}>
                {busy ? 'Creating…' : 'Play vs AI (ranked)'}
              </button>
              <p className="muted small">
                Sign in first so your result counts toward your rating.
              </p>
            </div>
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
  const { identity } = useIdentity();
  const identityToken = identity?.token;
  // Ride the hub identity token along with each move so the server can attribute
  // this seat (ranked). claimSeat additionally attaches it up-front on sign-in.
  const client = useMemo(
    () => makeHttpClient(gameId, token, () => identityToken),
    [gameId, token, identityToken],
  );
  const game = useGame<GameState, Action>(client, { pollMs: 1000 });

  // When signed in, claim this seat once so the identity is attached before the
  // game ends (so the ranked report has both seats attributed).
  useEffect(() => {
    if (identityToken) claimSeat(gameId, token, identityToken);
  }, [gameId, token, identityToken]);

  if (game.loading && !game.view) return <div className="loading">Connecting…</div>;
  if (game.error) return <div className="loading error">Error: {game.error.message}</div>;
  if (!game.view || !game.you) return <div className="loading">Loading…</div>;

  return (
    <div className="game-shell">
      <button className="exit-btn" onClick={() => { window.history.replaceState({}, '', '/'); onExit(); }}>← Lobby</button>
      <SignInBar leaderboardHref="https://games-hub-5vo.pages.dev" />
      <BoardBoundary resetKey={game.turn}>
        <Board
          state={game.view}
          viewer={game.you}
          canAct={game.yourTurn}
          legalActions={game.legalActions}
          onAction={(a) => game.submit(a)}
          onReport={(message) => game.reportBug(message)}
        />
      </BoardBoundary>
      {game.gameOver && <RankedStatus ranked={game.ranked} />}
    </div>
  );
}
