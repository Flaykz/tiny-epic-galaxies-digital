import React, { useState } from 'react';
import {
  PLANETS_BY_ID,
  baseVp,
  finalScore,
  empire,
  type Action,
  type DieFace,
  type GameState,
  type PlayerState,
  type Planet,
} from '../engine/index.js';
import { actionLabel, actionDieId, actionTooltip } from '../client/labels.js';
import { MatTokens, PlanetTokens } from './Tokens.js';
import { downloadText, logText, problemReport } from '../client/report.js';
import { useAsset, useArtless } from '../client/assets.js';

const DIE_IMG: Record<DieFace, string> = {
  move: '/dice/move.jpg',
  energy: '/dice/energy.jpg',
  culture: '/dice/culture.jpg',
  diplomacy: '/dice/diplomacy.jpg',
  economy: '/dice/economy.jpg',
  colony: '/dice/colony.jpg',
};

const FACE_LABEL: Record<DieFace, string> = {
  move: 'Move',
  energy: 'Energy',
  culture: 'Culture',
  diplomacy: 'Diplomacy',
  economy: 'Economy',
  colony: 'Colony',
};

export interface BoardProps {
  state: GameState;
  /** The seat this screen acts as (its missions are visible, it can submit when on the clock). */
  viewer: string;
  /** True if the viewer is allowed to act right now (their controller is human and they're on the clock). */
  canAct: boolean;
  legalActions: Action[];
  onAction: (a: Action) => void;
  /** Submit a problem report to the server (multiplayer). When absent, the
   *  "Report a problem" button downloads a local JSON report instead. */
  onReport?: (message: string) => Promise<string | void>;
}

export function Board({ state, viewer, canAct, legalActions, onAction, onReport }: BoardProps) {
  const me = state.players.find((p) => p.id === viewer)!;
  const activeP = state.players.find((p) => p.id === state.turn.active)!;
  const pending = state.turn.pendingFollow;
  const gameOver = state.phase === 'gameOver';

  // Which die is selected for activation. Lives here so the dice tray and the
  // action list stay in sync — clicking a real die in the tray selects it.
  const [selectedDie, setSelectedDie] = useState<number | null>(null);
  const activatableDieIds = new Set(
    legalActions.map(actionDieId).filter((x): x is number => x != null),
  );
  // Drop the selection if that die is no longer usable (used, rerolled, new turn).
  React.useEffect(() => {
    if (selectedDie != null && !activatableDieIds.has(selectedDie)) setSelectedDie(null);
  }, [selectedDie, state.turn.dice, state.turn.active]);

  return (
    <div className="board">
      <header className="topbar">
        <h1>Tiny Epic Galaxies</h1>
        <div className="status">
          {gameOver ? (
            <GameOver state={state} />
          ) : pending && pending.queue.length > 0 ? (
            <span className="turn-indicator follow">
              Follow window — {state.players.find((p) => p.id === pending.queue[0])!.name} may follow ({FACE_LABEL[pending.face]})
            </span>
          ) : (
            <span className={`turn-indicator ${activeP.color}`}>
              {activeP.name}'s turn {state.phase === 'finalRound' ? '· FINAL ROUND' : ''}
            </span>
          )}
        </div>
      </header>

      <section className="players-row">
        {state.players.map((p) => (
          <PlayerPanel key={p.id} p={p} state={state} isViewer={p.id === viewer} isActive={p.id === state.turn.active} />
        ))}
      </section>

      <section className="planet-row">
        <h2>Discovered Planets</h2>
        <div className="cards">
          {state.centerRow.map((id) => (
            <PlanetCardView key={id} planet={PLANETS_BY_ID[id]} state={state} />
          ))}
        </div>
      </section>

      {!gameOver && (
        <section className="play-area">
          <DiceTray
            state={state}
            canAct={canAct}
            activatableDieIds={activatableDieIds}
            selectedDie={selectedDie}
            onSelect={(id) => setSelectedDie((cur) => (cur === id ? null : id))}
          />
          <ActionPanel
            state={state}
            canAct={canAct}
            legalActions={legalActions}
            onAction={(a) => { onAction(a); setSelectedDie(null); }}
            viewerName={me.name}
            actorShips={me.ships}
            selectedDie={selectedDie}
          />
        </section>
      )}

      <LogPanel log={state.log} />

      <footer className="board-footer">
        <button className="ghost-btn" onClick={() => downloadText(`teg-log-turn${state.turnNumber}.txt`, logText(state))}>
          ⬇ Download log
        </button>
        <button className="ghost-btn" onClick={() => reportProblem(state, onReport)}>
          🐞 Report a problem
        </button>
      </footer>
    </div>
  );
}

async function reportProblem(state: GameState, onReport?: (m: string) => Promise<string | void>) {
  const message = window.prompt('Describe the problem (what happened vs. what you expected):');
  if (!message) return;
  if (onReport) {
    try {
      const id = await onReport(message);
      window.alert(id ? `Thanks! Report submitted (id ${id}).` : 'Thanks! Report submitted.');
    } catch (e: any) {
      window.alert(`Could not submit to the server — downloading a local report instead.\n(${e?.message ?? e})`);
      downloadText(`teg-report-turn${state.turnNumber}.json`, problemReport(state, message), 'application/json');
    }
  } else {
    downloadText(`teg-report-turn${state.turnNumber}.json`, problemReport(state, message), 'application/json');
    window.alert('A problem report (with the game log + state) was downloaded. Attach it when you send the bug.');
  }
}

function resourceDots(n: number) {
  return '●'.repeat(n) + '○'.repeat(Math.max(0, 7 - n));
}

function PlayerPanel({ p, state, isViewer, isActive }: { p: PlayerState; state: GameState; isViewer: boolean; isActive: boolean }) {
  const lvl = empire(p.empireLevel);
  const asset = useAsset();
  const artless = useArtless();
  return (
    <div className={`player-panel ${p.color} ${isActive ? 'active' : ''} ${isViewer ? 'viewer' : ''}`}>
      <div className="pp-head">
        <span className="pp-name">{p.name}{p.isRogue ? ' ☠' : ''}</span>
        <span className="pp-vp">{baseVp(state, p)} VP</span>
      </div>
      {!artless && (
        <div className="pp-mat">
          <img src={asset(`/mats/pads-${p.color}.jpg`)} alt={`${p.name} galaxy mat`} loading="lazy" />
          <MatTokens p={p} />
          <span className="mat-badge level" title="Current empire level">L{p.empireLevel}</span>
          <span className="mat-badge energy" title="Energy">⚡{p.energy}</span>
          <span className="mat-badge culture" title="Culture">🏛{p.culture}</span>
        </div>
      )}
      <div className="pp-stats">
        <span title="Empire level">🏛 L{p.empireLevel} ({lvl.dice}d/{lvl.ships}s)</span>
        <span title="Energy" className="res energy">⚡ {p.energy}</span>
        <span title="Culture" className="res culture">🏛 {p.culture}</span>
      </div>
      <div className="pp-ships">
        {p.ships.map((s, i) => (
          <span key={i} className={`ship ${s.kind}`} title={`Ship #${i + 1}: ${s.kind}`}>
            {s.kind === 'galaxy' ? '▲' : s.kind === 'locked' ? '▽' : s.kind === 'surface' ? '⬢' : `◔${s.level}`}
          </span>
        ))}
      </div>
      {p.colonized.length > 0 && (
        <div className="pp-colonies">
          <span className="pp-colonies-label">Colonies (use via Colony die):</span>
          <div className="colony-cards">
            {p.colonized.map((id) => {
              const cp = PLANETS_BY_ID[id];
              if (artless) {
                return (
                  <span key={id} className="colony-chip" title={cp?.action}>
                    {cp?.name} (+{cp?.vp})
                  </span>
                );
              }
              return (
                <div key={id} className="colony-card" title={`${cp?.name}: ${cp?.action}`}>
                  <img src={asset(`/cards/${id}.jpg`)} alt={cp?.name} loading="lazy" />
                  <span className="cc-vp">+{cp?.vp}</span>
                  <span className="cc-name">{cp?.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {isViewer && p.mission && p.mission.id !== 'hidden' && (
        <div className="pp-mission" title={p.mission.objective}>
          🎯 {p.mission.name}: {p.mission.objective}
        </div>
      )}
    </div>
  );
}

function PlanetCardView({ planet, state }: { planet: Planet; state: GameState }) {
  const asset = useAsset();
  const artless = useArtless();
  // Ships currently on/around this planet.
  const here: string[] = [];
  for (const pl of state.players) {
    pl.ships.forEach((s) => {
      if (s.kind === 'surface' && s.planetId === planet.id) here.push(`${pl.name}: surface`);
      if (s.kind === 'orbit' && s.planetId === planet.id) here.push(`${pl.name}: ${s.level === 0 ? 'orbit start' : `orbit ${s.level}/${planet.orbitTrackLength}`}`);
    });
  }
  const meta = (
    <div className="pc-meta">
      <strong>{planet.name}</strong>
      <span>{planet.resourceType === 'energy' ? '⚡' : '🏛'} · {planet.colonizeType} · colonize in {planet.orbitTrackLength + 1} · {planet.vp}VP</span>
      {here.length > 0 && <span className="pc-ships">{here.join(' | ')}</span>}
    </div>
  );

  if (artless) {
    return (
      <div className={`planet-card text ${planet.colonizeType}`}>
        <div className="pc-text-head">
          <strong>{planet.name}</strong>
          <span className="pc-vp-badge">{planet.vp}</span>
        </div>
        <div className="pc-text-action">{planet.action}</div>
        {meta}
      </div>
    );
  }
  return (
    <div className="planet-card">
      <div className="pc-art">
        <img src={asset(`/cards/${planet.id}.jpg`)} alt={planet.name} loading="lazy" />
        <PlanetTokens planet={planet} state={state} />
      </div>
      {meta}
    </div>
  );
}

function DiceTray({
  state,
  canAct,
  activatableDieIds,
  selectedDie,
  onSelect,
}: {
  state: GameState;
  canAct: boolean;
  activatableDieIds: Set<number>;
  selectedDie: number | null;
  onSelect: (id: number) => void;
}) {
  const asset = useAsset();
  const artless = useArtless();
  const FACE_GLYPH: Record<DieFace, string> = {
    move: '🚀', energy: '⚡', culture: '🏛', diplomacy: '🕊', economy: '📈', colony: '🏛',
  };
  return (
    <div className="dice-tray">
      <h3>Dice {canAct && <span className="muted small">— click a die to activate it</span>}</h3>
      <div className="dice">
        {state.turn.dice.map((d) => {
          const usable = canAct && activatableDieIds.has(d.id);
          const cls = [
            'die',
            artless ? 'text' : '',
            d.activated ? 'activated' : '',
            d.inConverter ? 'converter' : '',
            usable ? 'usable' : '',
            selectedDie === d.id ? 'sel' : '',
          ].join(' ');
          return (
            <button
              key={d.id}
              className={cls}
              disabled={!usable}
              onClick={() => usable && onSelect(d.id)}
              title={`${FACE_LABEL[d.face]}${d.activated ? ' (used)' : d.inConverter ? ' (in converter)' : usable ? ' — click to use' : ''}`}
            >
              {artless
                ? <span className="die-glyph">{FACE_GLYPH[d.face]}</span>
                : <img src={asset(DIE_IMG[d.face])} alt={FACE_LABEL[d.face]} />}
              <span>{FACE_LABEL[d.face]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActionPanel({
  state,
  canAct,
  legalActions,
  onAction,
  viewerName,
  actorShips,
  selectedDie,
}: {
  state: GameState;
  canAct: boolean;
  legalActions: Action[];
  onAction: (a: Action) => void;
  viewerName: string;
  actorShips: import('../engine/index.js').ShipLocation[];
  selectedDie: number | null;
}) {
  if (!canAct) {
    return (
      <div className="action-panel waiting">
        <h3>Actions</h3>
        <p className="muted">Waiting for {state.players.find((p) => p.id === state.turn.active)!.name}…</p>
      </div>
    );
  }

  // Target-choice prompt for a planet action.
  const choiceActions = legalActions.filter((a) => a.type === 'resolvePlanet' || a.type === 'skipPlanet');
  if (state.turn.pendingChoice && choiceActions.length > 0) {
    const planet = PLANETS_BY_ID[state.turn.pendingChoice.planetId];
    return (
      <div className="action-panel choose">
        <h3>Choose a target</h3>
        <p><strong>{planet?.name}</strong>: {planet?.action}</p>
        <div className="actions">
          {choiceActions.map((a, i) => (
            <button key={i} className={`act-btn ${a.type === 'skipPlanet' ? 'end' : ''}`} onClick={() => onAction(a)} title={actionTooltip(a)}>
              {actionLabel(a, actorShips)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const followActions = legalActions.filter((a) => a.type === 'follow');
  if (followActions.length > 0) {
    return (
      <div className="action-panel follow">
        <h3>Follow?</h3>
        <p>{viewerName}, you may copy the {FACE_LABEL[state.turn.pendingFollow!.face]} action by spending 1 culture.</p>
        <div className="actions">
          {followActions.map((a, i) => (
            <button key={i} className="act-btn" onClick={() => onAction(a)} title={actionTooltip(a)}>
              {actionLabel(a, actorShips)}
            </button>
          ))}
        </div>
        <p className="muted small">
          (Following with a specific target uses an auto-chosen target in this build.)
        </p>
      </div>
    );
  }

  const global = legalActions.filter((a) => actionDieId(a) == null);
  const forDie = (id: number) => legalActions.filter((a) => actionDieId(a) === id);
  const selectedDieFace = selectedDie != null ? state.turn.dice.find((d) => d.id === selectedDie)?.face : null;

  return (
    <div className="action-panel">
      <h3>Your actions</h3>

      {selectedDie == null ? (
        <p className="muted">Click one of your dice on the left to see what it can do.</p>
      ) : (
        <div className="actions">
          <p className="muted small">Selected die: <strong>{selectedDieFace && FACE_LABEL[selectedDieFace]}</strong></p>
          {forDie(selectedDie).map((a, i) => (
            <button key={i} className="act-btn" onClick={() => onAction(a)} title={actionTooltip(a)}>
              {actionLabel(a, actorShips)}
            </button>
          ))}
          {forDie(selectedDie).length === 0 && <p className="muted">No legal use for this die right now.</p>}
        </div>
      )}

      <div className="global-actions">
        {global.map((a, i) => (
          <button
            key={i}
            className={`act-btn ${a.type === 'endTurn' ? 'end' : 'global'}`}
            onClick={() => onAction(a)} title={actionTooltip(a)}
          >
            {actionLabel(a, actorShips)}
          </button>
        ))}
      </div>
    </div>
  );
}

function LogPanel({ log }: { log: string[] }) {
  return (
    <section className="log-panel">
      <h3>Log</h3>
      <ul>
        {log.slice(-14).reverse().map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

function GameOver({ state }: { state: GameState }) {
  const winners = state.winners ?? [];
  const ranked = state.players
    .filter((p) => !p.isRogue)
    .map((p) => ({ p, score: finalScore(state, p) }))
    .sort((a, b) => b.score - a.score);
  return (
    <div className="gameover">
      <strong>
        🏆 {winners.length ? winners.map((id) => state.players.find((p) => p.id === id)!.name).join(', ') : 'Rogue Galaxy'} wins!
      </strong>
      <ul>
        {ranked.map(({ p, score }) => (
          <li key={p.id}>
            {p.name}: {score} VP {p.mission ? `(mission ${p.mission.name})` : ''}
          </li>
        ))}
      </ul>
      <button className="ghost-btn" onClick={() => downloadText(`teg-final-log.txt`, logText(state))}>
        ⬇ Download full game log
      </button>
    </div>
  );
}
