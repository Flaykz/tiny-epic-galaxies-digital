import React, { useMemo, useState } from 'react';
import { UpdateBanner } from 'digital-boardgame-framework/client';
import { Board } from './Board.js';
import { useLocalGame } from '../client/useLocalGame.js';
import type { LocalSeat } from '../client/localEngine.js';
import { MultiplayerApp } from './Multiplayer.js';

type Mode =
  | { kind: 'lobby' }
  | { kind: 'local'; seats: LocalSeat[]; seed: number }
  | { kind: 'multiplayer' };

export function App() {
  const [mode, setMode] = useState<Mode>({ kind: 'lobby' });

  return (
    <>
      <AssetCheck />
      {mode.kind === 'lobby' && <Lobby onStart={setMode} />}
      {mode.kind === 'multiplayer' && <MultiplayerApp onExit={() => setMode({ kind: 'lobby' })} />}
      {mode.kind === 'local' && <LocalGame seats={mode.seats} seed={mode.seed} onExit={() => setMode({ kind: 'lobby' })} />}
      {/* Shows a "new version — Reload" bar at the bottom only when a newer build is deployed. */}
      <UpdateBanner
        currentBuild={typeof __DBF_BUILD_ID__ !== 'undefined' ? __DBF_BUILD_ID__ : 'dev'}
        message="A new version of Tiny Epic Galaxies is available."
        reloadLabel="Reload"
        unstyled
        className="update-banner"
      />
    </>
  );
}

/** Shows a one-time notice if the VASSAL-derived art hasn't been fetched yet. */
function AssetCheck() {
  const [missing, setMissing] = useState(false);
  React.useEffect(() => {
    const img = new Image();
    img.onerror = () => setMissing(true);
    img.src = '/cards/cp1.jpg';
  }, []);
  if (!missing) return null;
  return (
    <div className="asset-notice">
      <strong>Card art not found.</strong> This project doesn't ship the copyrighted
      game art. Download it from the official VASSAL module by running{' '}
      <code>npm run setup-assets</code>, then reload.
    </div>
  );
}

function Lobby({ onStart }: { onStart: (m: Mode) => void }) {
  const [humans, setHumans] = useState(2);
  const [ais, setAis] = useState(0);

  const seed = useMemo(() => Math.floor(Math.random() * 1e9), []);

  const startLocal = () => {
    const seats: LocalSeat[] = [];
    for (let i = 0; i < humans; i++) seats.push({ name: `Player ${i + 1}`, control: 'human' });
    for (let i = 0; i < ais; i++) seats.push({ name: `AI ${i + 1}`, control: 'ai' });
    onStart({ kind: 'local', seats, seed });
  };

  const startSolo = () => {
    const seats: LocalSeat[] = [
      { name: 'You', control: 'human' },
      { name: 'Rogue Galaxy', control: 'ai', isRogue: true },
    ];
    onStart({ kind: 'local', seats, seed });
  };

  const total = humans + ais;

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>Tiny Epic Galaxies</h1>
        <p className="tagline">A digital port — built on the Digital Boardgame Framework, with real card art from the VASSAL module.</p>

        <div className="lobby-section">
          <h2>Local game (hotseat + AI)</h2>
          <div className="counter">
            <label>Humans</label>
            <button onClick={() => setHumans((n) => Math.max(0, n - 1))}>−</button>
            <span>{humans}</span>
            <button onClick={() => setHumans((n) => Math.min(5, n + 1))}>+</button>
          </div>
          <div className="counter">
            <label>AI players</label>
            <button onClick={() => setAis((n) => Math.max(0, n - 1))}>−</button>
            <span>{ais}</span>
            <button onClick={() => setAis((n) => Math.min(5, n + 1))}>+</button>
          </div>
          <p className="muted small">{total} of max 5 players</p>
          <button className="primary" disabled={total < 2 || total > 5} onClick={startLocal}>
            Start local game
          </button>
        </div>

        <div className="lobby-section">
          <h2>Solo — The Rogue Galaxy ☠</h2>
          <p className="muted small">Defeat the automated Rogue Galaxy before it reaches 21 VP.</p>
          <button className="primary" onClick={startSolo}>Start solo game</button>
        </div>

        <div className="lobby-section">
          <h2>Async multiplayer</h2>
          <p className="muted small">Create a game and share invite links. Requires the dev server (npm run server).</p>
          <button className="primary" onClick={() => onStart({ kind: 'multiplayer' })}>
            Multiplayer
          </button>
        </div>
      </div>
    </div>
  );
}

function LocalGame({ seats, seed, onExit }: { seats: LocalSeat[]; seed: number; onExit: () => void }) {
  const engine = useLocalGame({ seats, seed });
  const state = engine.state;

  const actor = engine.currentActor();
  // In hotseat, the screen "becomes" whichever human is on the clock so they see
  // their own secret mission. If the current actor is an AI, show the first human.
  const firstHuman = state.order.find((id) => engine.seatControl(id) === 'human') ?? state.order[0];
  const viewer = actor && engine.seatControl(actor) === 'human' ? actor : firstHuman;
  const canAct = !!actor && engine.seatControl(actor) === 'human' && actor === viewer;
  const legalActions = actor ? engine.legalActions(actor) : [];

  return (
    <div className="game-shell">
      <button className="exit-btn" onClick={onExit}>← Lobby</button>
      <Board
        state={state}
        viewer={viewer}
        canAct={canAct}
        legalActions={legalActions}
        onAction={(a) => actor && engine.submit(a, actor)}
      />
    </div>
  );
}
