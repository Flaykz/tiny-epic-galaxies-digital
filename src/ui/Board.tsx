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
import { downloadText, logText } from '../client/report.js';
import { useAsset, useArtless } from '../client/assets.js';
import { ReportDialog, GameOverDialog } from './Dialogs.js';

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
  /** Local games only: take back the last move (until new info is revealed). */
  canUndo?: boolean;
  onUndo?: () => void;
}

export function Board({ state, viewer, canAct, legalActions, onAction, onReport, canUndo, onUndo }: BoardProps) {
  const me = state.players.find((p) => p.id === viewer)!;
  const activeP = state.players.find((p) => p.id === state.turn.active)!;
  const pending = state.turn.pendingFollow;
  const gameOver = state.phase === 'gameOver';

  // Dialog state: report (with optional default severity) + the game-over popup.
  const [reportOpen, setReportOpen] = useState<null | 'bug' | 'feedback'>(null);
  const [gameOverDismissed, setGameOverDismissed] = useState(false);

  // Which die is selected for activation. Lives here so the dice tray and the
  // action list stay in sync — clicking a real die in the tray selects it.
  const [selectedDie, setSelectedDie] = useState<number | null>(null);
  // Reroll selection: null = not rerolling; otherwise the set of die ids to reroll.
  const [rerollSel, setRerollSel] = useState<number[] | null>(null);
  const rerollAction = legalActions.find((a) => a.type === 'reroll') as
    | { type: 'reroll'; dieIds: number[]; free?: boolean } | undefined;
  const activatableDieIds = new Set(
    legalActions.map(actionDieId).filter((x): x is number => x != null),
  );
  // Drop the selection if that die is no longer usable (used, rerolled, new turn).
  React.useEffect(() => {
    if (selectedDie != null && !activatableDieIds.has(selectedDie)) setSelectedDie(null);
  }, [selectedDie, state.turn.dice, state.turn.active]);
  // Exit reroll mode when reroll is no longer available (turn passed, etc.).
  React.useEffect(() => {
    if (rerollSel != null && !rerollAction) setRerollSel(null);
  }, [rerollSel, rerollAction, state.turn.active]);

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
            rerollAvailable={!!rerollAction}
            rerollFree={!!rerollAction?.free}
            rerollSel={rerollSel}
            onEnterReroll={() => { setSelectedDie(null); setRerollSel(rerollAction ? [...rerollAction.dieIds] : []); }}
            onToggleReroll={(id) => setRerollSel((cur) => cur == null ? [id] : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])}
            onConfirmReroll={() => {
              if (rerollSel && rerollSel.length) onAction({ type: 'reroll', dieIds: rerollSel, free: !!rerollAction?.free });
              setRerollSel(null);
            }}
            onCancelReroll={() => setRerollSel(null)}
          />
          <ActionPanel
            state={state}
            canAct={canAct}
            legalActions={legalActions}
            onAction={(a) => { onAction(a); setSelectedDie(null); }}
            viewerName={me.name}
            actorShips={me.ships}
            selectedDie={selectedDie}
            canUndo={canUndo}
            onUndo={onUndo}
          />
        </section>
      )}

      <LogPanel log={state.log} />

      <footer className="board-footer">
        {onUndo && (
          <button className="ghost-btn undo" disabled={!canUndo} onClick={onUndo} title="Take back your last move (until new info is revealed)">
            ↶ Undo
          </button>
        )}
        <button className="ghost-btn" onClick={() => downloadText(`teg-log-turn${state.turnNumber}.txt`, logText(state))}>
          ⬇ Download log
        </button>
        <button className="ghost-btn" onClick={() => setReportOpen('bug')}>
          🐞 Report a problem
        </button>
      </footer>

      {reportOpen && (
        <ReportDialog
          state={state}
          defaultSeverity={reportOpen === 'feedback' ? 'feedback' : 'bug'}
          title={reportOpen === 'feedback' ? 'Submit game log' : 'Report a problem'}
          category={reportOpen === 'feedback' ? 'game-log' : undefined}
          onClose={() => setReportOpen(null)}
        />
      )}
      {gameOver && !gameOverDismissed && (
        <GameOverDialog
          state={state}
          viewer={viewer}
          onSubmitLog={() => { setGameOverDismissed(true); setReportOpen('feedback'); }}
          onClose={() => setGameOverDismissed(true)}
        />
      )}
    </div>
  );
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
        {p.ships.map((s, i) => {
          const where = s.kind === 'galaxy' ? 'home'
            : s.kind === 'locked' ? 'locked'
            : s.kind === 'surface' ? `on ${PLANETS_BY_ID[s.planetId]?.name}`
            : `orbit ${PLANETS_BY_ID[s.planetId]?.name} ${s.level === 0 ? 'start' : `sp.${s.level}`}`;
          const glyph = s.kind === 'galaxy' ? '▲' : s.kind === 'locked' ? '▽' : s.kind === 'surface' ? '⬢' : `◔${s.level}`;
          return (
            <span key={i} className={`ship ${s.kind}`} title={`Ship #${i + 1}: ${where}`}>
              <b>{i + 1}</b>{glyph}
            </span>
          );
        })}
      </div>
      {p.colonized.length > 0 && (
        <div className="pp-colonies">
          <span className="pp-colonies-label">Colonies (use via Colony die):</span>
          <div className="colony-cards">
            {p.colonized.map((id) => {
              const cp = PLANETS_BY_ID[id];
              if (artless) {
                // No hover on touch/tablet, so show the action text inline.
                return (
                  <div key={id} className="colony-text">
                    <strong>{cp?.name}</strong> <span className="muted small">(+{cp?.vp} VP)</span>
                    <div className="colony-text-action">{cp?.action}</div>
                  </div>
                );
              }
              return (
                <div key={id} className="colony-card" title={`${cp?.name}: ${cp?.action}`}>
                  <img className="cc-thumb" src={asset(`/cards/${id}.jpg`)} alt={cp?.name} loading="lazy" />
                  <span className="cc-vp">+{cp?.vp}</span>
                  <span className="cc-name">{cp?.name}</span>
                  <img className="pc-zoom" src={asset(`/cards/${id}.jpg`)} alt="" aria-hidden="true" />
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
      {/* Hover to enlarge (escapes the scrolling row via fixed positioning). */}
      <img className="pc-zoom" src={asset(`/cards/${planet.id}.jpg`)} alt="" aria-hidden="true" />
    </div>
  );
}

function DiceTray({
  state,
  canAct,
  activatableDieIds,
  selectedDie,
  onSelect,
  rerollAvailable,
  rerollFree,
  rerollSel,
  onEnterReroll,
  onToggleReroll,
  onConfirmReroll,
  onCancelReroll,
}: {
  state: GameState;
  canAct: boolean;
  activatableDieIds: Set<number>;
  selectedDie: number | null;
  onSelect: (id: number) => void;
  rerollAvailable: boolean;
  rerollFree: boolean;
  rerollSel: number[] | null;
  onEnterReroll: () => void;
  onToggleReroll: (id: number) => void;
  onConfirmReroll: () => void;
  onCancelReroll: () => void;
}) {
  const asset = useAsset();
  const artless = useArtless();
  const rerolling = rerollSel != null;
  const FACE_GLYPH: Record<DieFace, string> = {
    move: '🚀', energy: '⚡', culture: '🏛', diplomacy: '🕊', economy: '📈', colony: '🏛',
  };
  return (
    <div className="dice-tray">
      <div className="dice-head">
        <h3>Dice {canAct && !rerolling && <span className="muted small">— click a die to activate it</span>}
          {rerolling && <span className="muted small">— pick which dice to reroll</span>}</h3>
        {canAct && !rerolling && rerollAvailable && (
          <button className="reroll-btn" onClick={onEnterReroll}>↻ Reroll…</button>
        )}
        {rerolling && (
          <span className="reroll-controls">
            <button className="reroll-btn primary" disabled={!rerollSel!.length} onClick={onConfirmReroll}>
              Reroll {rerollSel!.length} ({rerollFree ? 'free' : '1 energy'})
            </button>
            <button className="reroll-btn" onClick={onCancelReroll}>Cancel</button>
          </span>
        )}
      </div>
      <div className="dice">
        {state.turn.dice.map((d) => {
          const inactive = !d.activated && !d.inConverter;
          const usable = canAct && activatableDieIds.has(d.id);
          const rerollPick = rerolling && rerollSel!.includes(d.id);
          const interactive = rerolling ? inactive : usable;
          const cls = [
            'die',
            artless ? 'text' : '',
            d.activated ? 'activated' : '',
            d.inConverter ? 'converter' : '',
            interactive ? 'usable' : '',
            !rerolling && selectedDie === d.id ? 'sel' : '',
            rerollPick ? 'reroll-pick' : '',
          ].join(' ');
          return (
            <button
              key={d.id}
              className={cls}
              disabled={!interactive}
              onClick={() => { if (!interactive) return; rerolling ? onToggleReroll(d.id) : onSelect(d.id); }}
              title={rerolling
                ? `${FACE_LABEL[d.face]}${rerollPick ? ' — will reroll' : ' — kept'}`
                : `${FACE_LABEL[d.face]}${d.activated ? ' (used)' : d.inConverter ? ' (in converter)' : usable ? ' — click to use' : ''}`}
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
  canUndo,
  onUndo,
}: {
  state: GameState;
  canAct: boolean;
  legalActions: Action[];
  onAction: (a: Action) => void;
  viewerName: string;
  actorShips: import('../engine/index.js').ShipLocation[];
  selectedDie: number | null;
  canUndo?: boolean;
  onUndo?: () => void;
}) {
  if (!canAct) {
    return (
      <div className="action-panel waiting">
        <h3>Actions</h3>
        <p className="muted">Waiting for {state.players.find((p) => p.id === state.turn.active)!.name}…</p>
      </div>
    );
  }

  const actor = state.players.find((p) => p.id === state.turn.active);

  // Guarded submit: confirm before moving a ship OFF an orbit (you'd abandon the
  // track progress you've invested in getting there).
  const submit = (a: Action) => {
    if (a.type === 'activateMove') {
      const sh = actorShips[a.shipIdx];
      if (sh?.kind === 'orbit') {
        const pl = PLANETS_BY_ID[sh.planetId];
        const where = sh.level === 0 ? 'the start of its orbit' : `space ${sh.level}/${pl?.orbitTrackLength}`;
        if (!window.confirm(`Move ship #${a.shipIdx + 1} off ${pl?.name}? It abandons its orbit progress (${where}).`)) return;
      }
    }
    onAction(a);
  };

  // Target-choice prompt for a planet action.
  const choiceActions = legalActions.filter((a) => a.type === 'resolvePlanet' || a.type === 'skipPlanet');
  if (state.turn.pendingChoice && choiceActions.length > 0) {
    const planet = PLANETS_BY_ID[state.turn.pendingChoice.planetId];
    return (
      <div className="action-panel choose">
        <div className="ap-head">
          <h3>Choose a target</h3>
          {onUndo && (
            <button className="undo-btn" disabled={!canUndo} onClick={onUndo} title="Take back the move that triggered this (until new info is revealed)">
              ↶ Undo
            </button>
          )}
        </div>
        <p><strong>{planet?.name}</strong>: {planet?.action}</p>
        <div className="actions">
          {choiceActions.map((a, i) => (
            <button key={i} className={`act-btn ${a.type === 'skipPlanet' ? 'end' : ''}`} onClick={() => onAction(a)} title={actionTooltip(a)}>
              {actionLabel(a, actorShips, actor)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // NAGATO: choose ship moves (up to two).
  const moveActions = legalActions.filter((a) => a.type === 'nagatoMove' || a.type === 'endMoves');
  if (state.turn.pendingMoves && state.turn.pendingMoves.left > 0 && moveActions.length > 0) {
    return (
      <div className="action-panel choose">
        <h3>NAGATO — move a ship ({state.turn.pendingMoves.left} left)</h3>
        <p>Move one of your ships to a different planet, or stop.</p>
        <div className="actions">
          {moveActions.map((a, i) => (
            <button key={i} className={`act-btn ${a.type === 'endMoves' ? 'end' : ''}`} onClick={() => onAction(a)} title={actionTooltip(a)}>
              {actionLabel(a, actorShips, actor)}
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
              {actionLabel(a, actorShips, actor)}
            </button>
          ))}
        </div>
        <p className="muted small">
          (Following with a specific target uses an auto-chosen target in this build.)
        </p>
      </div>
    );
  }

  // Reroll is handled in the dice tray (so the player can pick which dice).
  const global = legalActions.filter((a) => actionDieId(a) == null && a.type !== 'reroll');
  const forDie = (id: number) => legalActions.filter((a) => actionDieId(a) === id);
  const selectedDieFace = selectedDie != null ? state.turn.dice.find((d) => d.id === selectedDie)?.face : null;

  return (
    <div className="action-panel">
      <div className="ap-head">
        <h3>Your actions</h3>
        {onUndo && (
          <button className="undo-btn" disabled={!canUndo} onClick={onUndo} title="Take back your last move (until new info is revealed)">
            ↶ Undo
          </button>
        )}
      </div>

      {selectedDie == null ? (
        <p className="muted">Click one of your dice on the left to see what it can do.</p>
      ) : (
        <div className="actions">
          <p className="muted small">Selected die: <strong>{selectedDieFace && FACE_LABEL[selectedDieFace]}</strong></p>
          {forDie(selectedDie).map((a, i) => (
            <button key={i} className="act-btn" onClick={() => submit(a)} title={actionTooltip(a)}>
              {actionLabel(a, actorShips, actor)}
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
            {actionLabel(a, actorShips, actor)}
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
    </div>
  );
}
