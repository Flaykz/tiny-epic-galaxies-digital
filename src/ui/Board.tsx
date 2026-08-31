import React, { useState } from 'react';
import {
  PLANETS_BY_ID,
  ROGUE_CARDS,
  baseVp,
  finalScore,
  empire,
  type Action,
  type DieFace,
  type GameState,
  type PlayerState,
  type Planet,
  type ShipLocation,
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

type ActivateMoveAction = Extract<Action, { type: 'activateMove' }>;
type MobileView = 'command' | 'galaxy' | 'log';

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
  // Direct manipulation for Move dice: click or drag a ship, then choose a
  // legal surface/orbit/home target directly on the board.
  const [directMoveShip, setDirectMoveShip] = useState<number | null>(null);
  // Touch layouts use focused, full-height views instead of stacking the whole
  // desktop board. The current view is still harmless on pointer/desktop CSS.
  const [mobileView, setMobileView] = useState<MobileView>('command');
  // Reroll selection: null = not rerolling; otherwise the set of die ids to reroll.
  const [rerollSel, setRerollSel] = useState<number[] | null>(null);
  // Converter selection: null = not converting; otherwise the 2 dice to spend and
  // the die to change. RAW: spend any 2 inactive dice, set any 3rd to a chosen face.
  const [converterSel, setConverterSel] = useState<{ spend: number[]; target: number | null } | null>(null);
  const rerollAction = legalActions.find((a) => a.type === 'reroll') as
    | { type: 'reroll'; dieIds: number[]; free?: boolean } | undefined;
  const converterAction = legalActions.find((a) => a.type === 'convert');
  const activatableDieIds = new Set(
    legalActions.map(actionDieId).filter((x): x is number => x != null),
  );
  const selectedDieFace = selectedDie == null
    ? null
    : state.turn.dice.find((d) => d.id === selectedDie)?.face ?? null;
  const directMoveActions = selectedDieFace === 'move'
    ? legalActions.filter((a): a is ActivateMoveAction =>
        a.type === 'activateMove' && a.dieId === selectedDie)
    : [];
  const movableShipIds = new Set(directMoveActions.map((a) => a.shipIdx));
  const selectMoveShip = (shipIdx: number | null) => {
    setDirectMoveShip(shipIdx);
    if (shipIdx != null) setMobileView('galaxy');
  };
  const submitDirectMove = (a: ActivateMoveAction) => {
    const ship = activeP.ships[a.shipIdx];
    if (ship?.kind === 'orbit') {
      const currentPlanet = PLANETS_BY_ID[ship.planetId];
      const where = ship.level === 0 ? 'the start of its orbit' : `space ${ship.level}/${currentPlanet?.orbitTrackLength}`;
      if (!window.confirm(`Move ship #${a.shipIdx + 1} off ${currentPlanet?.name}? It abandons its orbit progress (${where}).`)) return;
    }
    onAction(a);
    setSelectedDie(null);
    setDirectMoveShip(null);
    setMobileView('command');
  };
  // Drop the selection if that die is no longer usable (used, rerolled, new turn).
  React.useEffect(() => {
    if (selectedDie != null && !activatableDieIds.has(selectedDie)) setSelectedDie(null);
  }, [selectedDie, state.turn.dice, state.turn.active]);
  React.useEffect(() => {
    if (selectedDieFace !== 'move' || (directMoveShip != null && !movableShipIds.has(directMoveShip))) {
      setDirectMoveShip(null);
    }
  }, [selectedDieFace, directMoveShip, state.turn.active, state.turn.dice]);
  // Exit reroll mode when reroll is no longer available (turn passed, etc.).
  React.useEffect(() => {
    if (rerollSel != null && !rerollAction) setRerollSel(null);
  }, [rerollSel, rerollAction, state.turn.active]);
  // Exit converter mode when it's no longer available (used it, turn passed, etc.).
  React.useEffect(() => {
    if (converterSel != null && !converterAction) setConverterSel(null);
  }, [converterSel, converterAction, state.turn.active]);

  return (
    <div className={`board mobile-view-${mobileView}`}>
      <header className="topbar">
        <div className="game-title">
          <span className="game-kicker">Galactic command</span>
          <h1>Tiny Epic Galaxies</h1>
        </div>
        <div className="status">
          {gameOver ? (
            <GameOver state={state} />
          ) : pending && pending.queue.length > 0 ? (
            <span className="turn-indicator follow">
              Follow window — {state.players.find((p) => p.id === pending.queue[0])!.name} may follow ({FACE_LABEL[pending.face]})
            </span>
          ) : (
            <span className={`turn-indicator ${activeP.color}`}>
              <span className="turn-number">Turn {state.turnNumber}</span>
              {activeP.name}'s turn {state.phase === 'finalRound' ? '· FINAL ROUND' : ''}
            </span>
          )}
        </div>
      </header>

      <section className="players-row">
        {state.players.map((p) => (
          <PlayerPanel
            key={p.id}
            p={p}
            state={state}
            isViewer={p.id === viewer}
            isActive={p.id === state.turn.active}
            movableShipIds={p.id === state.turn.active ? movableShipIds : new Set()}
            selectedMoveShip={p.id === state.turn.active ? directMoveShip : null}
            homeMove={p.id === state.turn.active && directMoveShip != null
              ? directMoveActions.find((a) => a.shipIdx === directMoveShip && a.dest.kind === 'galaxy')
              : undefined}
            onSelectMoveShip={selectMoveShip}
            onDirectMove={submitDirectMove}
          />
        ))}
      </section>

      <div className="galaxy-column">
        <section className="planet-row">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Shared galaxy</span>
              <h2>Discovered planets</h2>
            </div>
            <span className="section-count">{state.centerRow.length} in orbit</span>
          </div>
          <div className="cards">
            {state.centerRow.map((id) => (
              <PlanetCardView
                key={id}
                planet={PLANETS_BY_ID[id]}
                state={state}
                activePlayerId={state.turn.active}
                moveActions={directMoveActions}
                movableShipIds={movableShipIds}
                selectedMoveShip={directMoveShip}
                onSelectMoveShip={selectMoveShip}
                onDirectMove={submitDirectMove}
              />
            ))}
          </div>
        </section>
        <LogPanel log={state.log} />
      </div>

      {!gameOver && (
        <section className="play-area">
          <DiceTray
            state={state}
            canAct={canAct}
            activatableDieIds={activatableDieIds}
            selectedDie={selectedDie}
            onSelect={(id) => { setSelectedDie((cur) => (cur === id ? null : id)); setMobileView('command'); }}
            rerollAvailable={!!rerollAction}
            rerollFree={!!rerollAction?.free}
            rerollSel={rerollSel}
            onEnterReroll={() => { setSelectedDie(null); setConverterSel(null); setRerollSel(rerollAction ? [...rerollAction.dieIds] : []); }}
            onToggleReroll={(id) => setRerollSel((cur) => cur == null ? [id] : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])}
            onConfirmReroll={() => {
              if (rerollSel && rerollSel.length) onAction({ type: 'reroll', dieIds: rerollSel, free: !!rerollAction?.free });
              setRerollSel(null);
            }}
            onCancelReroll={() => setRerollSel(null)}
            converterAvailable={!!converterAction}
            converterSel={converterSel}
            onEnterConverter={() => { setSelectedDie(null); setRerollSel(null); setConverterSel({ spend: [], target: null }); }}
            onToggleConverterDie={(id) => setConverterSel((cur) => {
              if (cur == null) return cur;
              // Clicking an already-chosen die takes it back out.
              if (cur.spend.includes(id)) return { ...cur, spend: cur.spend.filter((x) => x !== id) };
              if (cur.target === id) return { ...cur, target: null };
              // Otherwise fill the two Converter slots first, then the die to change.
              if (cur.spend.length < 2) return { ...cur, spend: [...cur.spend, id] };
              return { ...cur, target: id };
            })}
            onConfirmConverter={(face) => {
              if (converterSel && converterSel.spend.length === 2 && converterSel.target != null) {
                onAction({ type: 'convert', spend: [converterSel.spend[0], converterSel.spend[1]], target: converterSel.target, face });
              }
              setConverterSel(null);
            }}
            onCancelConverter={() => setConverterSel(null)}
          />
          <ActionPanel
            state={state}
            canAct={canAct}
            legalActions={legalActions}
            onAction={(a) => { onAction(a); setSelectedDie(null); }}
            viewerName={me.name}
            actorShips={me.ships}
            selectedDie={selectedDie}
            directMoveShip={directMoveShip}
            onSelectMoveShip={selectMoveShip}
            canUndo={canUndo}
            onUndo={onUndo}
          />
        </section>
      )}

      <footer className="board-footer">
        <button className="ghost-btn" onClick={() => downloadText(`teg-log-turn${state.turnNumber}.txt`, logText(state))}>
          ↓ Export log
        </button>
        <button className="ghost-btn" onClick={() => setReportOpen('bug')}>
          Report a problem
        </button>
      </footer>

      <nav className="mobile-nav" aria-label="Game views">
        <button
          type="button"
          className={mobileView === 'command' ? 'active' : ''}
          aria-pressed={mobileView === 'command'}
          onClick={() => setMobileView('command')}
        >
          <span className="mobile-nav-icon" aria-hidden="true">⚄</span>
          <span>Command</span>
        </button>
        <button
          type="button"
          className={mobileView === 'galaxy' ? 'active' : ''}
          aria-pressed={mobileView === 'galaxy'}
          onClick={() => setMobileView('galaxy')}
        >
          <span className="mobile-nav-icon" aria-hidden="true">◎</span>
          <span>Galaxy</span>
          <b aria-label={`${state.centerRow.length} planets`}>{state.centerRow.length}</b>
        </button>
        <button
          type="button"
          className={mobileView === 'log' ? 'active' : ''}
          aria-pressed={mobileView === 'log'}
          onClick={() => setMobileView('log')}
        >
          <span className="mobile-nav-icon" aria-hidden="true">≡</span>
          <span>Log</span>
          <b aria-label={`${state.log.length} entries`}>{state.log.length}</b>
        </button>
      </nav>

      {reportOpen && (
        <ReportDialog
          state={state}
          defaultSeverity={reportOpen === 'feedback' ? 'feedback' : 'bug'}
          title={reportOpen === 'feedback' ? 'Submit game log' : 'Report a problem'}
          category={reportOpen === 'feedback' ? 'game-log' : 'tiny-epic-galaxies'}
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

/** Where a ship currently sits (for the move-order ship picker). */
function shipLocText(loc: import('../engine/index.js').ShipLocation): string {
  switch (loc.kind) {
    case 'galaxy': return 'on your galaxy';
    case 'locked': return 'locked';
    case 'surface': return `on ${PLANETS_BY_ID[loc.planetId]?.name ?? loc.planetId}`;
    case 'orbit': {
      const pl = PLANETS_BY_ID[loc.planetId];
      return `orbiting ${pl?.name ?? loc.planetId} (${loc.level === 0 ? 'start' : `space ${loc.level}/${pl?.orbitTrackLength}`})`;
    }
  }
}

/** A move destination, for the second step of a move order. */
function destText(d: ShipLocation): string {
  if (d.kind === 'surface') return `${PLANETS_BY_ID[d.planetId]?.name ?? d.planetId} — land on surface`;
  if (d.kind === 'orbit') return `${PLANETS_BY_ID[d.planetId]?.name ?? d.planetId} — enter orbit`;
  return 'Home galaxy';
}

/** One selectable move: a ship index, its destination, and the action to submit. */
interface MoveOption { shipIdx: number; dest: ShipLocation; action: Action; }

/**
 * Two-step move picker: choose the ship, then its destination. Shared by the Move
 * die, NAGATO, and PIEDES repeat-move. `extras` are extra buttons shown alongside
 * the ship list in step 1 (e.g. PIEDES's non-move repeats, NAGATO's "Done").
 */
function MoveSteps({ moves, actorShips, moveShip, setMoveShip, submit, prompt = 'Move which ship?', verb = 'Move', extras, emptyText }: {
  moves: MoveOption[];
  actorShips: ShipLocation[];
  moveShip: number | null;
  setMoveShip: (n: number | null) => void;
  submit: (a: Action) => void;
  prompt?: string;
  verb?: string;
  extras?: React.ReactNode;
  emptyText?: string;
}) {
  const shipIdxs = [...new Set(moves.map((m) => m.shipIdx))].sort((a, b) => a - b);

  // Step 1 — choose the ship (also shown if a prior pick is no longer movable).
  if (moveShip == null || !shipIdxs.includes(moveShip)) {
    return (
      <div className="actions">
        {moves.length > 0 && <p className="muted small">{prompt}</p>}
        {moves.length === 0 && !extras && emptyText && <p className="muted">{emptyText}</p>}
        {shipIdxs.map((idx) => (
          <button key={`ship${idx}`} className="act-btn" onClick={() => setMoveShip(idx)}>
            {verb} ship #{idx + 1} — {shipLocText(actorShips[idx])}
          </button>
        ))}
        {extras}
      </div>
    );
  }

  // Step 2 — choose the destination for the picked ship.
  const dests = moves.filter((m) => m.shipIdx === moveShip);
  return (
    <div className="actions">
      <p className="muted small">{verb} <strong>Ship #{moveShip + 1}</strong> ({shipLocText(actorShips[moveShip])}) to:</p>
      {dests.map((m, i) => (
        <button key={i} className="act-btn" onClick={() => submit(m.action)} title={destText(m.dest)}>
          {destText(m.dest)}
        </button>
      ))}
      <button className="act-btn global" onClick={() => setMoveShip(null)}>← Choose a different ship</button>
    </div>
  );
}

function PlayerPanel({
  p,
  state,
  isViewer,
  isActive,
  movableShipIds,
  selectedMoveShip,
  homeMove,
  onSelectMoveShip,
  onDirectMove,
}: {
  p: PlayerState;
  state: GameState;
  isViewer: boolean;
  isActive: boolean;
  movableShipIds: Set<number>;
  selectedMoveShip: number | null;
  homeMove?: ActivateMoveAction;
  onSelectMoveShip: (shipIdx: number | null) => void;
  onDirectMove: (action: ActivateMoveAction) => void;
}) {
  const lvl = empire(p.empireLevel);
  const asset = useAsset();
  const artless = useArtless();
  return (
    <div
      className={`player-panel ${p.color} ${isActive ? 'active' : ''} ${isViewer ? 'viewer' : ''} ${homeMove ? 'accepts-home-drop' : ''}`}
      onDragOver={(e) => { if (homeMove) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDrop={(e) => { if (homeMove) { e.preventDefault(); onDirectMove(homeMove); } }}
    >
      <div className="pp-head">
        <span className="pp-name">{p.name}{p.isRogue ? ' ☠' : ''}{isViewer && <small>You</small>}</span>
        <span className="pp-vp">{baseVp(state, p)} VP</span>
      </div>
      {!artless && (
        <div className="pp-mat">
          <img src={asset(`/mats/pads-${p.color}.jpg`)} alt={`${p.name} galaxy mat`} loading="lazy" />
          <MatTokens
            p={p}
            movableShipIds={movableShipIds}
            selectedShip={selectedMoveShip}
            onSelectShip={onSelectMoveShip}
          />
          <span className="mat-badge level" title="Current empire level">L{p.empireLevel}</span>
          <span className="mat-badge energy" title="Energy">⚡{p.energy}</span>
          <span className="mat-badge culture" title="Culture">🏛{p.culture}</span>
        </div>
      )}
      <div className="pp-stats">
        <span title="Empire level" className="stat empire"><small>Empire</small><b>L{p.empireLevel}</b></span>
        <span title="Available dice" className="stat"><small>Dice</small><b>{lvl.dice}</b></span>
        <span title="Unlocked ships" className="stat"><small>Ships</small><b>{lvl.ships}</b></span>
        <span title="Energy" className="stat res energy"><small>Energy</small><b>⚡{p.energy}</b></span>
        <span title="Culture" className="stat res culture"><small>Culture</small><b>◆{p.culture}</b></span>
      </div>
      <div className="pp-ships">
        {p.ships.map((s, i) => {
          const where = s.kind === 'galaxy' ? 'home'
            : s.kind === 'locked' ? 'locked'
            : s.kind === 'surface' ? `on ${PLANETS_BY_ID[s.planetId]?.name}`
            : `orbit ${PLANETS_BY_ID[s.planetId]?.name} ${s.level === 0 ? 'start' : `sp.${s.level}`}`;
          const glyph = s.kind === 'galaxy' ? '▲' : s.kind === 'locked' ? '▽' : s.kind === 'surface' ? '⬢' : `◔${s.level}`;
          const movable = movableShipIds.has(i);
          const contents = movable
            ? <><span className="ship-rocket" aria-hidden="true">🚀</span><b>{i + 1}</b><small>{glyph}</small></>
            : <><b>{i + 1}</b>{glyph}</>;
          return movable ? (
            <button
              key={i}
              type="button"
              className={`ship ship-move-source ${s.kind} ${selectedMoveShip === i ? 'selected' : ''}`}
              title={`Select ship #${i + 1}: ${where}`}
              aria-label={`Select ship ${i + 1}, ${where}`}
              draggable
              onClick={() => onSelectMoveShip(selectedMoveShip === i ? null : i)}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i));
                onSelectMoveShip(i);
              }}
            >
              {contents}
            </button>
          ) : (
            <span key={i} className={`ship ${s.kind}`} title={`Ship #${i + 1}: ${where}`}>
              {contents}
            </span>
          );
        })}
      </div>
      {movableShipIds.size > 0 && (
        <p className="direct-move-hint">
          {selectedMoveShip == null ? 'Tap or drag a rocket' : `Ship ${selectedMoveShip + 1} selected — choose a destination`}
        </p>
      )}
      {homeMove && (
        <button className="direct-move-target home" type="button" onClick={() => onDirectMove(homeMove)}>
          <span>⌂</span> Return ship {homeMove.shipIdx + 1} home
        </button>
      )}
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
                  {/* Hide a broken thumb (missing art); the name/VP overlay stays. */}
                  <img className="cc-thumb" src={asset(`/cards/${id}.jpg`)} alt={cp?.name} loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
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
      {p.isRogue && <RogueCardLadder empireLevel={p.empireLevel} cardId={state.rogueCard} />}
    </div>
  );
}

/** Read-only display of the active Rogue Galaxy card's colony-action ladder, so
 *  the player can see which Rogue they're facing (each difficulty is a distinct
 *  card) and what it does at every empire level. The Rogue's current level is
 *  highlighted — a Colony die resolves that row. */
function RogueCardLadder({ empireLevel, cardId }: { empireLevel: number; cardId?: string }) {
  const card = ROGUE_CARDS[(cardId ?? 'artemis') as keyof typeof ROGUE_CARDS] ?? ROGUE_CARDS.artemis;
  const active = Math.min(Math.max(empireLevel, 1), 5);
  return (
    <div className="pp-rogue-card">
      <span className="pp-rogue-card-label">☠ {card.name} — {card.tier} · Colony Action ladder</span>
      <div className="rogue-ladder">
        {[1, 2, 3, 4, 5].map((lvl) => (
          <div key={lvl} className={`rogue-ladder-row ${lvl === active ? 'active' : ''}`} title={lvl === active ? 'Current Rogue empire level' : undefined}>
            <span className="rogue-ladder-lvl">L{lvl}</span>
            <span className="rogue-ladder-effect">{card.desc[lvl]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanetCardView({
  planet,
  state,
  activePlayerId,
  moveActions,
  movableShipIds,
  selectedMoveShip,
  onSelectMoveShip,
  onDirectMove,
}: {
  planet: Planet;
  state: GameState;
  activePlayerId: string;
  moveActions: ActivateMoveAction[];
  movableShipIds: Set<number>;
  selectedMoveShip: number | null;
  onSelectMoveShip: (shipIdx: number | null) => void;
  onDirectMove: (action: ActivateMoveAction) => void;
}) {
  const asset = useAsset();
  const artless = useArtless();
  // If this card's art can't load (no shipped art / no VASSAL module / a gap in
  // either), fall back to the clean text card instead of a broken image.
  const [imgFailed, setImgFailed] = useState(false);
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
  const planetTargets = selectedMoveShip == null
    ? []
    : moveActions.filter((a) =>
        a.shipIdx === selectedMoveShip
        && (a.dest.kind === 'surface' || a.dest.kind === 'orbit')
        && a.dest.planetId === planet.id);
  const directTargets = planetTargets.length > 0 && (
    <div className="direct-move-targets" aria-label={`Move ship ${selectedMoveShip! + 1} to ${planet.name}`}>
      {planetTargets.map((a) => (
        <button
          key={a.dest.kind}
          type="button"
          className={`direct-move-target ${a.dest.kind}`}
          onClick={() => onDirectMove(a)}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={(e) => { e.preventDefault(); onDirectMove(a); }}
        >
          <span>{a.dest.kind === 'surface' ? '▼' : '◎'}</span>
          {a.dest.kind === 'surface' ? 'Surface' : 'Orbit'}
        </button>
      ))}
    </div>
  );

  if (artless || imgFailed) {
    return (
      <div className={`planet-card text ${planet.colonizeType}`}>
        <div className="pc-text-head">
          <strong>{planet.name}</strong>
          <span className="pc-vp-badge">{planet.vp}</span>
        </div>
        <div className="pc-text-action">{planet.action}</div>
        <div className="pc-facts">
          <span>{planet.resourceType === 'energy' ? '⚡ Energy' : '◆ Culture'}</span>
          <span>{planet.colonizeType === 'economy' ? '▥ Economy' : '◇ Diplomacy'}</span>
          <span>Orbit {planet.orbitTrackLength + 1}</span>
        </div>
        {here.length > 0 && <span className="pc-ships">{here.join(' | ')}</span>}
        {directTargets}
      </div>
    );
  }
  return (
    <div className="planet-card">
      <div className="pc-art">
        <img src={asset(`/cards/${planet.id}.jpg`)} alt={planet.name} loading="lazy" onError={() => setImgFailed(true)} />
        <PlanetTokens
          planet={planet}
          state={state}
          activePlayerId={activePlayerId}
          movableShipIds={movableShipIds}
          selectedShip={selectedMoveShip}
          onSelectShip={onSelectMoveShip}
        />
      </div>
      {meta}
      {directTargets}
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
  converterAvailable,
  converterSel,
  onEnterConverter,
  onToggleConverterDie,
  onConfirmConverter,
  onCancelConverter,
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
  converterAvailable: boolean;
  converterSel: { spend: number[]; target: number | null } | null;
  onEnterConverter: () => void;
  onToggleConverterDie: (id: number) => void;
  onConfirmConverter: (face: DieFace) => void;
  onCancelConverter: () => void;
}) {
  const asset = useAsset();
  const artless = useArtless();
  const rerolling = rerollSel != null;
  const converting = converterSel != null;
  const FACE_GLYPH: Record<DieFace, string> = {
    move: '🚀', energy: '⚡', culture: '🏛', diplomacy: '🕊', economy: '📈', colony: '🏛',
  };
  const FACE_ORDER: DieFace[] = ['move', 'energy', 'culture', 'diplomacy', 'economy', 'colony'];
  // Converter is "armed" once 2 dice are in the slots and a third is chosen —
  // then the player picks the face to set it to.
  const converterReady = converting && converterSel!.spend.length === 2 && converterSel!.target != null;
  return (
    <div className="dice-tray">
      <div className="dice-head">
        <h3>Your dice {canAct && !rerolling && !converting && <span className="muted small">Select one to act</span>}
          {rerolling && <span className="muted small">— pick which dice to reroll</span>}
          {converting && <span className="muted small">— Converter: spend 2 dice, then set a 3rd</span>}</h3>
        {canAct && !rerolling && !converting && (rerollAvailable || converterAvailable) && (
          <span className="dice-tools">
            {rerollAvailable && <button className="reroll-btn" onClick={onEnterReroll}>↻ Reroll…</button>}
            {converterAvailable && <button className="reroll-btn" onClick={onEnterConverter}>⚙ Converter…</button>}
          </span>
        )}
        {rerolling && (
          <span className="reroll-controls">
            <button className="reroll-btn primary" disabled={!rerollSel!.length} onClick={onConfirmReroll}>
              Reroll {rerollSel!.length} ({rerollFree ? 'free' : '1 energy'})
            </button>
            <button className="reroll-btn" onClick={onCancelReroll}>Cancel</button>
          </span>
        )}
        {converting && (
          <span className="reroll-controls converter-controls">
            {converterReady ? (
              <>
                <span className="muted small">Set it to:</span>
                {FACE_ORDER.map((f) => (
                  <button key={f} className="reroll-btn primary" onClick={() => onConfirmConverter(f)} title={`Change the chosen die to ${FACE_LABEL[f]}`}>
                    {FACE_LABEL[f]}
                  </button>
                ))}
              </>
            ) : (
              <span className="muted small">
                {converterSel!.spend.length < 2
                  ? `Pick ${2 - converterSel!.spend.length} die to spend`
                  : 'Now pick the die to change'}
              </span>
            )}
            <button className="reroll-btn" onClick={onCancelConverter}>Cancel</button>
          </span>
        )}
      </div>
      <div className="dice">
        {state.turn.dice.map((d) => {
          const inactive = !d.activated && !d.inConverter;
          const usable = canAct && activatableDieIds.has(d.id);
          const rerollPick = rerolling && rerollSel!.includes(d.id);
          const spendPick = converting && converterSel!.spend.includes(d.id);
          const targetPick = converting && converterSel!.target === d.id;
          const interactive = rerolling || converting ? inactive : usable;
          const cls = [
            'die',
            artless ? 'text' : '',
            d.activated ? 'activated' : '',
            d.inConverter ? 'converter' : '',
            interactive ? 'usable' : '',
            !rerolling && !converting && selectedDie === d.id ? 'sel' : '',
            rerollPick ? 'reroll-pick' : '',
            spendPick ? 'converter-spend' : '',
            targetPick ? 'converter-target' : '',
          ].join(' ');
          return (
            <button
              key={d.id}
              className={cls}
              disabled={!interactive}
              onClick={() => { if (!interactive) return; rerolling ? onToggleReroll(d.id) : converting ? onToggleConverterDie(d.id) : onSelect(d.id); }}
              title={rerolling
                ? `${FACE_LABEL[d.face]}${rerollPick ? ' — will reroll' : ' — kept'}`
                : converting
                ? `${FACE_LABEL[d.face]}${spendPick ? ' — into the Converter' : targetPick ? ' — will change' : inactive ? ' — click to pick' : ''}`
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
  directMoveShip,
  onSelectMoveShip,
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
  directMoveShip: number | null;
  onSelectMoveShip: (shipIdx: number | null) => void;
  canUndo?: boolean;
  onUndo?: () => void;
}) {
  // Move orders are picked in two steps: choose the ship, then its destination
  // (the flat ship×destination list was cumbersome — Joe Reil's suggestion).
  // Used for the Move die, NAGATO moves, and PIEDES repeat-move.
  const [moveShip, setMoveShip] = useState<number | null>(null);
  // Reset the ship pick when the context changes: a different die selected, a new
  // planet prompt, a NAGATO move consumed, or a different follow window. (Use stable
  // bits of pendingFollow, not the object — it's a fresh ref on every multiplayer poll.)
  React.useEffect(() => { setMoveShip(null); }, [
    selectedDie,
    state.turn.pendingChoice?.planetId,
    state.turn.pendingMoves?.left,
    state.turn.pendingFollow?.sourcePlayer,
    state.turn.pendingFollow?.face,
  ]);
  React.useEffect(() => {
    if (directMoveShip != null) setMoveShip(directMoveShip);
  }, [directMoveShip]);

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
    const head = (
      <>
        <div className="ap-head">
          <h3>Choose a target</h3>
          {onUndo && (
            <button className="undo-btn" disabled={!canUndo} onClick={onUndo} title="Take back the move that triggered this (until new info is revealed)">
              ↶ Undo
            </button>
          )}
        </div>
        <p><strong>{planet?.name}</strong>: {planet?.action}</p>
      </>
    );
    // PIEDES (cp23) repeat-move options carry a destination — give them the same
    // two-step ship→destination picker; non-move repeats stay as plain buttons.
    if (state.turn.pendingChoice.planetId === 'cp23') {
      const repeatMoves = choiceActions.flatMap((a) =>
        a.type === 'resolvePlanet' && a.choice.dest && a.choice.shipIdx != null
          ? [{ shipIdx: a.choice.shipIdx, dest: a.choice.dest, action: a }]
          : []);
      const others = choiceActions.filter((a) => !(a.type === 'resolvePlanet' && a.choice.dest));
      return (
        <div className="action-panel choose">
          {head}
          <MoveSteps
            moves={repeatMoves}
            actorShips={actorShips}
            moveShip={moveShip}
            setMoveShip={setMoveShip}
            submit={onAction}
            verb="Repeat move:"
            prompt="Repeat a move — which ship?"
            extras={others.map((a, i) => (
              <button key={i} className={`act-btn ${a.type === 'skipPlanet' ? 'end' : ''}`} onClick={() => onAction(a)} title={actionTooltip(a)}>
                {actionLabel(a, actorShips, actor)}
              </button>
            ))}
          />
        </div>
      );
    }
    return (
      <div className="action-panel choose">
        {head}
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

  // NAGATO: choose ship moves (up to two) — same two-step picker as the Move die.
  const moveActions = legalActions.filter((a) => a.type === 'nagatoMove' || a.type === 'endMoves');
  if (state.turn.pendingMoves && state.turn.pendingMoves.left > 0 && moveActions.length > 0) {
    const nagatoMoves = moveActions.flatMap((a) => (a.type === 'nagatoMove' ? [{ shipIdx: a.shipIdx, dest: a.dest, action: a }] : []));
    const stop = moveActions.find((a) => a.type === 'endMoves');
    return (
      <div className="action-panel choose">
        <h3>NAGATO — move a ship ({state.turn.pendingMoves.left} left)</h3>
        <p>Move one of your ships to a different planet, or stop.</p>
        <MoveSteps
          moves={nagatoMoves}
          actorShips={actorShips}
          moveShip={moveShip}
          setMoveShip={setMoveShip}
          submit={onAction}
          extras={stop && <button className="act-btn end" onClick={() => onAction(stop)}>Done moving</button>}
        />
      </div>
    );
  }

  const followActions = legalActions.filter((a) => a.type === 'follow');
  // Guard on pendingFollow too: in multiplayer the polled view and legalActions can
  // be momentarily out of sync (follow already resolved server-side but legalActions
  // not yet refreshed), and reading a null pendingFollow.face white-screened the app.
  if (state.turn.pendingFollow && followActions.length > 0) {
    const face = state.turn.pendingFollow.face;
    const decline = followActions.find((a) => a.type === 'follow' && !a.accept);
    const declineBtn = decline && (
      <button className="act-btn end" onClick={() => onAction(decline)} key="decline">Decline follow</button>
    );
    // Following a MOVE offers one option per ship×destination — use the same
    // two-step ship→destination picker as a normal move.
    const followMoves = face === 'move'
      ? followActions.flatMap((a) =>
          a.type === 'follow' && a.accept && a.params?.dest && a.params.shipIdx != null
            ? [{ shipIdx: a.params.shipIdx, dest: a.params.dest, action: a }]
            : [])
      : [];
    return (
      <div className="action-panel follow">
        <h3>Follow?</h3>
        <p>{viewerName}, you may copy the {FACE_LABEL[face]} action by spending 1 culture.</p>
        {face === 'move' ? (
          <MoveSteps
            moves={followMoves}
            actorShips={actorShips}
            moveShip={moveShip}
            setMoveShip={setMoveShip}
            submit={onAction}
            verb="Follow move:"
            prompt="Follow the move — which ship?"
            extras={declineBtn}
          />
        ) : (
          <div className="actions">
            {followActions.map((a, i) => (
              <button key={i} className={`act-btn ${a.type === 'follow' && !a.accept ? 'end' : ''}`} onClick={() => onAction(a)} title={actionTooltip(a)}>
                {actionLabel(a, actorShips, actor)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Reroll and Converter are handled in the dice tray (so the player can pick
  // which dice go where), not as flat buttons here.
  const global = legalActions.filter((a) => actionDieId(a) == null && a.type !== 'reroll' && a.type !== 'convert');
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
        <p className="muted">Tap one of your dice above to see what it can do.</p>
      ) : selectedDieFace === 'move' && directMoveShip != null ? (
        <div className="direct-move-summary">
          <span className="direct-move-summary-icon">🚀</span>
          <div>
            <strong>Ship {directMoveShip + 1} ready to move</strong>
            <p>Choose Surface or Orbit directly on a highlighted planet.</p>
          </div>
          <button className="act-btn global" onClick={() => { setMoveShip(null); onSelectMoveShip(null); }}>
            Change ship
          </button>
        </div>
      ) : selectedDieFace === 'move' ? (
        <MoveSteps
          moves={forDie(selectedDie).flatMap((a) => (a.type === 'activateMove' ? [{ shipIdx: a.shipIdx, dest: a.dest, action: a }] : []))}
          actorShips={actorShips}
          moveShip={directMoveShip ?? moveShip}
          setMoveShip={(shipIdx) => { setMoveShip(shipIdx); onSelectMoveShip(shipIdx); }}
          submit={submit}
          prompt="Tap a highlighted rocket, or choose one here"
          emptyText="No ship can move right now."
        />
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

function LogPanel({ log }: { log: import('digital-boardgame-framework').GameLogEntry[] }) {
  return (
    <section className="log-panel">
      <div className="log-head">
        <div>
          <span className="section-kicker">Latest events</span>
          <h3>Flight recorder</h3>
        </div>
        <span className="section-count">{log.length}</span>
      </div>
      <ul>
        {log.slice(-8).reverse().map((e) => (
          <li key={e.seq}>{e.msg ?? e.kind}</li>
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
