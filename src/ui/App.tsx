import React, { useEffect, useMemo, useState } from 'react';
import { UpdateBanner, VmodSetupDialog } from 'digital-boardgame-framework/client';
import { AssetContext, useGameAssets, VMOD_URL } from '../client/assets.js';
import { Board } from './Board.js';
import { useLocalGame } from '../client/useLocalGame.js';
import type { LocalSeat } from '../client/localEngine.js';
import { MultiplayerApp } from './Multiplayer.js';
import { ROGUE_CARDS, type RogueCardId } from '../engine/index.js';

// The five Rogue Galaxy cards in difficulty order, for the solo selector.
const ROGUE_ORDER: RogueCardId[] = ['rothkel', 'artemis', 'zendica', 'hades', 'gamelyn'];

type Mode =
  | { kind: 'lobby' }
  | { kind: 'local'; seats: LocalSeat[]; seed: number; rogueDifficulty?: 'beginner' | 'advanced'; rogueCard?: import('../engine/index.js').RogueCardId }
  | { kind: 'multiplayer' };

export function App() {
  // An invite link (?game=…&token=…) must open straight into the multiplayer
  // game, not the lobby — otherwise the params are ignored and you bounce back.
  const [mode, setMode] = useState<Mode>(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('game') && p.get('token') ? { kind: 'multiplayer' } : { kind: 'lobby' };
  });

  const assets = useGameAssets();

  return (
    <AssetContext.Provider value={{ resolve: assets.resolve, artless: assets.artless }}>
      {mode.kind === 'lobby' && <Lobby onStart={setMode} />}
      {mode.kind === 'multiplayer' && <MultiplayerApp onExit={() => setMode({ kind: 'lobby' })} />}
      {mode.kind === 'local' && (
        <LocalGame
          // Keying on `seed` forces a full remount (fresh LocalEngine — see
          // useLocalGame.ts, which only ever initializes once per instance) when
          // onReset below picks a new one, instead of the game silently
          // continuing on stale state.
          key={mode.seed}
          seats={mode.seats}
          seed={mode.seed}
          rogueDifficulty={mode.rogueDifficulty}
          rogueCard={mode.rogueCard}
          onExit={() => setMode({ kind: 'lobby' })}
          onReset={() => setMode((m) => (m.kind === 'local' ? { ...m, seed: Math.floor(Math.random() * 1e9) } : m))}
        />
      )}
      {/* Bring-your-own-art: when the build ships no images, prompt the user to
          download + choose the official VASSAL module (cached locally). */}
      {assets.needsSetup && (
        <VmodSetupDialog
          api={assets.vmod}
          gameName="Tiny Epic Galaxies"
          moduleName="Tiny Epic Galaxies 0.2"
          moduleUrl={VMOD_URL}
          onSkip={assets.dismiss}
          skipLabel="Play without images (text mode)"
        />
      )}
      {/* Shows a "new version — Reload" bar at the bottom only when a newer build is deployed.
          `url` must be base-aware (import.meta.env.BASE_URL) — the hook's own default is
          root-absolute ('/version.json'), which 404s once the app is served from a subpath
          like GitHub Pages' /tiny-epic-galaxies-digital/, silently disabling this forever. */}
      <UpdateBanner
        currentBuild={typeof __DBF_BUILD_ID__ !== 'undefined' ? __DBF_BUILD_ID__ : 'dev'}
        url={`${import.meta.env.BASE_URL}version.json`}
        message="A new version of Tiny Epic Galaxies is available."
        reloadLabel="Reload"
        unstyled
        className="update-banner"
      />
    </AssetContext.Provider>
  );
}

/** Offer to install the PWA (adds it to the home screen / app list, and it
 *  then works fully offline for local/solo play — see vite.config.ts). Browsers
 *  fire `beforeinstallprompt` only when the page is actually installable and
 *  not already installed; this self-hides otherwise (notably: iOS Safari never
 *  fires it at all — install there is manual, via the Share sheet). */
function InstallButton() {
  const [prompt, setPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) || (typeof navigator !== 'undefined' && (navigator as any).standalone === true),
  );

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => { setPrompt(null); setInstalled(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || !prompt) return null;

  const install = async () => {
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    setPrompt(null); // a prompt event can only be used once
  };

  return (
    <button type="button" className="ghost-btn install-btn" onClick={install}>
      📲 Install app
    </button>
  );
}

function Lobby({ onStart }: { onStart: (m: Mode) => void }) {
  const [humans, setHumans] = useState(2);
  const [ais, setAis] = useState(0);
  const [soloDifficulty, setSoloDifficulty] = useState<'beginner' | 'advanced'>('beginner');
  const [soloCard, setSoloCard] = useState<RogueCardId>('artemis');

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
      { name: ROGUE_CARDS[soloCard].name, control: 'ai', isRogue: true },
    ];
    onStart({ kind: 'local', seats, seed, rogueDifficulty: soloDifficulty, rogueCard: soloCard });
  };

  const total = humans + ais;

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="lobby-head">
          <h1>Tiny Epic Galaxies</h1>
          <InstallButton />
        </div>
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
          <div className="difficulty">
            <label>Rogue Galaxy</label>
            <select value={soloCard} onChange={(e) => setSoloCard(e.target.value as RogueCardId)}>
              {ROGUE_ORDER.map((id) => (
                <option key={id} value={id}>{ROGUE_CARDS[id].name} — {ROGUE_CARDS[id].tier}</option>
              ))}
            </select>
          </div>
          <div className="difficulty">
            <label>Difficulty</label>
            <div className="seg">
              <button
                className={`seg-btn ${soloDifficulty === 'beginner' ? 'on' : ''}`}
                onClick={() => setSoloDifficulty('beginner')}
              >Beginner</button>
              <button
                className={`seg-btn ${soloDifficulty === 'advanced' ? 'on' : ''}`}
                onClick={() => setSoloDifficulty('advanced')}
              >Advanced</button>
            </div>
          </div>
          <p className="muted small">
            {soloDifficulty === 'beginner'
              ? 'Beginner: the Rogue discards any die it can’t use.'
              : 'Advanced: the Rogue rerolls each unusable die once before discarding it.'}
          </p>
          <button className="primary" onClick={startSolo}>Start solo game</button>
        </div>

        <div className="lobby-section">
          <h2>Async multiplayer</h2>
          <p className="muted small">Create a game and share invite links. Requires the dev server (npm run server).</p>
          <button className="primary" onClick={() => onStart({ kind: 'multiplayer' })}>
            Multiplayer
          </button>
        </div>

        <PlayCount />
      </div>
    </div>
  );
}

/** Best-effort "N games played" from the games hub. Never blocks the lobby. */
function PlayCount() {
  const [count, setCount] = useState<number | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch('https://games-hub-5vo.pages.dev/stats?game=tiny-epic-galaxies')
      .then((r) => r.json())
      .then((d) => { if (alive && typeof d?.count === 'number') setCount(d.count); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (count == null) return null;
  return <p className="muted small play-count">{count.toLocaleString()} games played</p>;
}

function LocalGame({ seats, seed, rogueDifficulty, rogueCard, onExit, onReset }: { seats: LocalSeat[]; seed: number; rogueDifficulty?: 'beginner' | 'advanced'; rogueCard?: import('../engine/index.js').RogueCardId; onExit: () => void; onReset: () => void }) {
  const engine = useLocalGame({ seats, seed, rogueDifficulty, rogueCard });
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
        canUndo={canAct && engine.canUndo()}
        onUndo={() => engine.undo()}
        onReset={onReset}
      />
    </div>
  );
}
