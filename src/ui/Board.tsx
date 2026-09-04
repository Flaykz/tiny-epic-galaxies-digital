import React, { useState } from 'react';
import {
  PLANETS_BY_ID,
  ROGUE_CARDS,
  MAX_EMPIRE,
  RESOURCE_MAX,
  baseVp,
  finalScore,
  empire,
  acquireCount,
  type Action,
  type DieFace,
  type GameState,
  type PlayerState,
  type Planet,
  type ShipLocation,
} from '../engine/index.js';
import { actionLabel, actionDieId, actionTooltip } from '../client/labels.js';
import { PlanetTokens } from './Tokens.js';
import { downloadText, logText } from '../client/report.js';
import { useAsset, useArtless } from '../client/assets.js';
import { ReportDialog, GameOverDialog, Sheet, ConfirmSheet, Toast } from './Dialogs.js';

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

/** Toggle browser fullscreen — most useful on a tablet/phone, where the browser
 *  chrome eats real screen space. Self-hides if the Fullscreen API isn't
 *  available at all (e.g. iPhone Safari doesn't support it). */
function FullscreenButton() {
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
  const [isFullscreen, setIsFullscreen] = useState(() => supported && !!document.fullscreenElement);

  React.useEffect(() => {
    if (!supported) return;
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [supported]);

  if (!supported) return null;

  const toggle = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  return (
    <button
      type="button"
      className="ghost-btn fullscreen-btn"
      onClick={toggle}
      title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      aria-pressed={isFullscreen}
    >
      ⛶
    </button>
  );
}

/** Abandon the current game and start a fresh one (same seats/settings) — local
 *  games only (see BoardProps.onReset). Confirms first (bottom sheet, not
 *  window.confirm — see ConfirmSheet): this discards all progress and can't
 *  be undone, same as the orbit-abandon confirm below. */
function ResetButton({ onReset }: { onReset: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <button type="button" className="ghost-btn reset-btn" onClick={() => setConfirmOpen(true)} title="Abandon this game and start a fresh one" aria-label="Reset game">
        ↺
      </button>
      <ConfirmSheet
        open={confirmOpen}
        title="Reset the current game?"
        description="All progress will be lost — this can’t be undone."
        confirmLabel="Reset game"
        destructive
        onConfirm={() => { setConfirmOpen(false); onReset(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

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
  /** Local games only: abandon the current game and start a fresh one with the
   *  same seats/settings. Omitted for multiplayer — you can't unilaterally
   *  discard other players' progress. */
  onReset?: () => void;
}

export function Board({ state, viewer, canAct, legalActions, onAction, onReport, canUndo, onUndo, onReset }: BoardProps) {
  const me = state.players.find((p) => p.id === viewer)!;
  const activeP = state.players.find((p) => p.id === state.turn.active)!;
  const pending = state.turn.pendingFollow;
  const gameOver = state.phase === 'gameOver';

  // Dialog state: report (with optional default severity) + the game-over popup.
  const [reportOpen, setReportOpen] = useState<null | 'bug' | 'feedback'>(null);
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  // On-demand log drawer (sub-task 5) — the log used to be an always-visible
  // panel with its own permanent internal scroll; now it opens on demand.
  const [logOpen, setLogOpen] = useState(false);
  // Lifted out of ActionPanel so the orbit-abandon confirm can render as a
  // bottom sheet instead of window.confirm — see ActionPanel's `submit`.
  const [pendingConfirm, setPendingConfirm] = useState<{ action: Action; message: string } | null>(null);

  // Which die is selected for activation. Lives here so the dice tray and the
  // action list stay in sync — clicking a real die in the tray selects it.
  const [selectedDie, setSelectedDie] = useState<number | null>(null);
  // The active ship/destination picker (see MovePickerContext) — published by
  // whichever MoveSteps is currently mounted, read by the Fleet chips and planet
  // cards so tapping them (instead of text buttons) drives the same picker.
  const [picker, setPicker] = useState<MovePicker | null>(null);
  // Same idea for the Diplomacy/Economy advance picker (see AdvancePickerContext).
  const [advPicker, setAdvPicker] = useState<AdvancePicker | null>(null);
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
  // Drop the selection if that die is no longer usable (used, rerolled, new turn).
  React.useEffect(() => {
    if (selectedDie != null && !activatableDieIds.has(selectedDie)) setSelectedDie(null);
  }, [selectedDie, state.turn.dice, state.turn.active]);
  // Exit reroll mode when reroll is no longer available (turn passed, etc.).
  React.useEffect(() => {
    if (rerollSel != null && !rerollAction) setRerollSel(null);
  }, [rerollSel, rerollAction, state.turn.active]);
  // Exit converter mode when it's no longer available (used it, turn passed, etc.).
  React.useEffect(() => {
    if (converterSel != null && !converterAction) setConverterSel(null);
  }, [converterSel, converterAction, state.turn.active]);

  const rerolling = rerollSel != null;
  const converting = converterSel != null;
  // Single-choice automation: when exactly one die can legally be activated there
  // is no "which die" decision left to make, so it comes up preselected (very
  // common on the last die of a turn). Deliberately a *derived* value rather
  // than a setSelectedDie effect: the effects above already own that state, and
  // an auto-select effect racing them is exactly the render-loop shape called
  // out in MoveSteps below. Suppressed while rerolling/converting — those modes
  // clear selectedDie on purpose (the dice tray owns the tray taps then, and the
  // action panel must not open a sheet over it).
  const autoDie = canAct && !rerolling && !converting && activatableDieIds.size === 1
    ? [...activatableDieIds][0]
    : null;
  // What the tray highlights and the action panel is scoped to. An explicit pick
  // always wins; the auto-pick only fills in the gap.
  const activeDie = selectedDie ?? autoDie;
  const colonyUpgradeActions = activeDie != null
    && state.turn.dice.find((d) => d.id === activeDie)?.face === 'colony'
    ? legalActions.filter((a): a is Extract<Action, { type: 'activateColonyGalaxy' }> => a.type === 'activateColonyGalaxy' && a.dieId === activeDie)
    : [];
  const colonyPlanetActions = activeDie != null
    && state.turn.dice.find((d) => d.id === activeDie)?.face === 'colony'
    ? legalActions.filter((a): a is Extract<Action, { type: 'activateColonyPlanet' }> => a.type === 'activateColonyPlanet' && a.dieId === activeDie)
    : [];

  // A follow window the viewer cannot actually take up (culture spent since it
  // opened, or no legal way to copy the face — e.g. an Economy die with no ship
  // orbiting an economy planet) leaves exactly one legal answer: decline. This
  // is the one decision the board resolves with zero taps, reporting it in a
  // non-blocking toast instead of a modal the player can only dismiss one way.
  const followActs = legalActions.filter((a) => a.type === 'follow');
  const followPlayer = pending?.queue.length ? state.players.find((p) => p.id === pending.queue[0]) : undefined;
  const followResource = pending && (pending.face === 'energy' || pending.face === 'culture') ? pending.face : null;
  const followCost = state.turn.oncePerTurn.includes('nibiru-follow-tax') ? 2 : 1;
  const followBefore = followResource && followPlayer ? (followResource === 'energy' ? followPlayer.energy : followPlayer.culture) : 0;
  const followGain = followResource && followPlayer ? acquireCount(followPlayer, followResource) : 0;
  const followAfter = Math.min(RESOURCE_MAX, followBefore + followGain);
  const followNet = followAfter - followBefore - followCost;
  const autoDeclineResource = !!followResource && !!followPlayer && followNet < 1;
  const declineAction = followActs.find((a) => a.type === 'follow' && !a.accept);
  const autoDecline = canAct && pending && pending.queue.length > 0
    && declineAction && (followActs.length === 1 || autoDeclineResource)
    ? declineAction
    : null;
  // Identity of *this* follow decision. log.length is what separates two
  // otherwise-identical windows (same source, same face, same follower) opened
  // by two dice in one turn, and it also makes the key stable across
  // multiplayer polls of an unchanged state — so the guard below can't
  // double-submit while our decline is still in flight, and React's dev-mode
  // double-invoked effects can't either.
  const followKey = autoDecline && pending
    ? `${state.turnNumber}|${state.log.length}|${pending.sourcePlayer}|${pending.face}|${pending.queue[0]}`
    : null;
  const autoDeclinedRef = React.useRef<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  React.useEffect(() => {
    if (!autoDecline || !followKey || !pending) return;
    if (autoDeclinedRef.current === followKey) return;
    autoDeclinedRef.current = followKey;
    const src = state.players.find((p) => p.id === pending.sourcePlayer)?.name ?? 'the active player';
    const cost = state.turn.oncePerTurn.includes('nibiru-follow-tax') ? 2 : 1;
    const why = me.culture < cost
      ? `you’d need ${cost} 🏛 culture`
      : 'there’s nothing you could copy';
    setToast({ id: Date.now(), text: `Can’t follow ${src}’s ${FACE_LABEL[pending.face]} — ${why}. Turn continues.` });
    onAction(autoDecline);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- followKey is the identity of this one follow decision (see above); everything else read here is derived from the same render and must not re-trigger the submit.
  }, [followKey]);

  return (
    <MovePickerContext.Provider value={{ picker, setPicker }}>
    <AdvancePickerContext.Provider value={{ picker: advPicker, setPicker: setAdvPicker }}>
    <div className="board">
      <header className="topbar">
        {/* No title here on purpose: during an active game it's dead weight
         *  the player already knows (they're the ones playing it) — the app
         *  icon/PWA chrome already identifies it. The lobby keeps its <h1>.
         *  Split into two groups (not one, left-aligned) so the header uses
         *  its full width instead of leaving most of it empty on the right:
         *  the turn indicator — the one piece of live info here — leads on
         *  the left, Fullscreen/Reset trail as secondary utility on the right. */}
        <div className="status-turn">
          {gameOver ? (
            <GameOver state={state} />
          ) : pending && pending.queue.length > 0 ? (
            <span className="turn-indicator follow">
              <span className="follow-indicator-die">{({ move: '🚀', energy: '⚡', culture: '🏛', diplomacy: '🕊', economy: '📈', colony: '🏛' } as Record<DieFace, string>)[pending.face]}</span>
              <span><strong>Follow action</strong> · {state.players.find((p) => p.id === pending.queue[0])!.name} · {FACE_LABEL[pending.face]}</span>
            </span>
          ) : (
            <span className={`turn-indicator ${activeP.color}`}>
              {activeP.name}'s turn {state.phase === 'finalRound' ? '· FINAL ROUND' : ''}
            </span>
          )}
        </div>
        <div className="status-tools">
          <FullscreenButton />
          {onReset && <ResetButton onReset={onReset} />}
        </div>
      </header>

      <section className="players-row" aria-label="Player status">
        <PlayerPanel p={me} state={state} isViewer isActive={me.id === state.turn.active} upgradeActions={colonyUpgradeActions} colonyActions={colonyPlanetActions} onUpgrade={(a) => { onAction(a); setSelectedDie(null); }} onColonyAction={(a) => { onAction(a); setSelectedDie(null); }} />
        <div className="opponents" aria-label="Opponents">
          {state.players.filter((p) => p.id !== viewer).map((p) => (
            <PlayerPanel key={p.id} p={p} state={state} isViewer={false} isActive={p.id === state.turn.active} />
          ))}
        </div>
      </section>

      <section className="planet-row">
        <div className="section-heading">
          <h2>Discovered Planets</h2>
          <span>{state.centerRow.length} available</span>
        </div>
        {/* The center row is only ever exactly 4 planets in solo (1 human) and
         *  2-human games; a 3+ human game grows it (humanCount + 2 — up to 7 at
         *  5 humans, see engine/setup.ts), which no longer fits the 2x2 grid's
         *  row budget in portrait. `dense` switches to 3 columns (fewer rows for
         *  the same count) and a tighter text clamp (see .cards.dense in
         *  styles.css) rather than leaving the extra planets to scroll off —
         *  a legal move target must never need a scroll to become visible. */}
        <div className={`cards ${state.centerRow.length > 4 ? 'dense' : ''}`}>
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
            selectedDie={activeDie}
            autoSelected={autoDie != null}
            onSelect={(id) => setSelectedDie((cur) => (cur === id ? null : id))}
            rerollAvailable={!!rerollAction}
            rerollFree={!!rerollAction?.free}
            rerollSel={rerollSel}
            // Entering reroll mode pre-checks every rerollable die (`dieIds` is
            // all of the player's inactive dice) — which already covers the
            // single-choice case: one rerollable die comes up checked and the
            // paid "Reroll 1" confirm is the only tap left.
            onEnterReroll={() => { setSelectedDie(null); setConverterSel(null); setRerollSel(rerollAction ? [...rerollAction.dieIds] : []); }}
            onToggleReroll={(id) => setRerollSel((cur) => cur == null ? [id] : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])}
            onConfirmReroll={() => {
              if (rerollSel && rerollSel.length) onAction({ type: 'reroll', dieIds: rerollSel, free: !!rerollAction?.free });
              setRerollSel(null);
            }}
            onCancelReroll={() => setRerollSel(null)}
            converterAvailable={!!converterAction}
            converterSel={converterSel}
            onEnterConverter={() => {
              setSelectedDie(null);
              setRerollSel(null);
              // Single-choice automation: the Converter needs 3 inactive dice
              // (engine: `dice.length >= 3`), so with *exactly* 3 the whole
              // spend/target assignment is forced — all three are consumed
              // either way and the survivor ends up on whichever face you pick,
              // so which physical die goes where changes nothing. Prefill and
              // land straight on the only real decision, the face. With 4+, the
              // die left untouched genuinely matters, so it stays a manual pick.
              const inactive = state.turn.dice.filter((d) => !d.activated && !d.inConverter);
              setConverterSel(inactive.length === 3
                ? { spend: [inactive[0].id, inactive[1].id], target: inactive[2].id }
                : { spend: [], target: null });
            }}
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
            onRequestConfirm={(action, message) => setPendingConfirm({ action, message })}
            viewerName={me.name}
            actorShips={me.ships}
            selectedDie={activeDie}
            // Hide the accept/decline popup only while the auto-decline is
            // actually in flight. If a later render still shows the same
            // window (a multiplayer submit that never landed, say), the ref
            // below already holds this key and the normal popup comes back, so
            // a failed auto-resolve can't leave the player at a dead end with
            // no way to answer.
            autoResolvingFollow={!!autoDecline && autoDeclinedRef.current !== followKey}
            canUndo={canUndo}
            onUndo={onUndo}
          />
        </section>
      )}

      <footer className="board-footer">
        {onUndo && (
          <button className="ghost-btn undo" disabled={!canUndo} onClick={onUndo} title="Take back your last move (until new info is revealed)">
            ↶ <span className="ghost-btn-label">Undo</span>
          </button>
        )}
        <button className="ghost-btn" onClick={() => setLogOpen(true)} aria-label="Open log">
          📜 <span className="ghost-btn-label">Log</span>
        </button>
        <button className="ghost-btn" onClick={() => downloadText(`teg-log-turn${state.turnNumber}.txt`, logText(state))} title="Download log" aria-label="Save log">
          ⬇ <span className="ghost-btn-label">Save</span>
        </button>
        <button className="ghost-btn" onClick={() => setReportOpen('bug')} title="Report a problem" aria-label="Report a problem">
          🐞 <span className="ghost-btn-label">Report</span>
        </button>
      </footer>

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="Log">
        <LogPanel log={state.log} />
      </Sheet>

      {/* Keyed per message so a second auto-declined follow restarts the timer. */}
      {toast && <Toast key={toast.id} message={toast.text} onDismiss={() => setToast(null)} />}

      <ConfirmSheet
        open={!!pendingConfirm}
        title="Abandon this orbit?"
        description={pendingConfirm?.message}
        confirmLabel="Move ship"
        destructive
        onConfirm={() => {
          if (pendingConfirm) { onAction(pendingConfirm.action); setSelectedDie(null); }
          setPendingConfirm(null);
        }}
        onCancel={() => setPendingConfirm(null)}
      />

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
    </AdvancePickerContext.Provider>
    </MovePickerContext.Provider>
  );
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
 * The currently-active move picker (at most one of the 4 MoveSteps call sites is
 * ever mounted at a time — they're mutually exclusive branches in ActionPanel).
 * MoveSteps publishes itself here instead of rendering ship/destination buttons,
 * so the Fleet chips (ship source, PlayerPanel) and the planet cards (destination,
 * PlanetCardView) can become the tap targets — on-board tap-to-move instead of a
 * text list, and it works with or without art since neither of those depends on it.
 */
interface MovePicker {
  moves: MoveOption[];
  actorShips: ShipLocation[];
  shipIdx: number | null;
  setShipIdx: (n: number | null) => void;
  submit: (a: Action) => void;
  verb: string;
}
const MovePickerContext = React.createContext<{ picker: MovePicker | null; setPicker: (p: MovePicker | null) => void }>({
  picker: null,
  setPicker: () => {},
});

/** One selectable Diplomacy/Economy advance: an already-orbiting ship on a
 *  specific planet, and the action to submit. A player can only ever have one
 *  ship orbiting a given planet, so each planet maps to at most one option. */
interface AdvanceOption { shipIdx: number; planetId: string; action: Action; }

/**
 * Same idea as MovePickerContext, for the Diplomacy/Economy dice: advancing a
 * ship has no destination *choice* (it just moves 1 space further on the orbit
 * track it's already on), so instead of a flat "Advance ship #N — economy" button
 * list, the eligible planet cards themselves become the tap targets — highlighted,
 * tap to confirm (see PlanetCardView).
 */
interface AdvancePicker {
  options: AdvanceOption[];
  submit: (a: Action) => void;
  verb: string;
}
const AdvancePickerContext = React.createContext<{ picker: AdvancePicker | null; setPicker: (p: AdvancePicker | null) => void }>({
  picker: null,
  setPicker: () => {},
});

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
  const { setPicker } = React.useContext(MovePickerContext);
  const shipIdxs = [...new Set(moves.map((m) => m.shipIdx))].sort((a, b) => a - b);
  // Convenience automation for the Move die: if a legal ship is still home on
  // the galaxy, preselect the first one. When every ship is on a planet there is
  // no safe default, so the player must pick the ship before its destination.
  // Derived (never written back to state) to avoid fighting ActionPanel's reset.
  const autoShip = actorShips.findIndex((ship, index) => ship.kind === 'galaxy' && shipIdxs.includes(index));
  const defaultShip = autoShip >= 0 ? autoShip : null;
  const pickedShip = moveShip != null && shipIdxs.includes(moveShip) ? moveShip : defaultShip;
  const shipPicked = pickedShip != null;

  // Publish this picker so the Fleet chips (PlayerPanel) and planet cards
  // (PlanetCardView) become the actual tap targets — see MovePickerContext.
  // `moves`/`actorShips`/`submit` are FRESH references every render (ActionPanel
  // rebuilds them from legalActions each time), so depending on them directly
  // would re-run this effect — and call setPicker — on every single render,
  // which is an infinite update loop (setPicker → Board re-renders → ActionPanel
  // re-renders → new moves/submit → effect deps "changed" → setPicker → ...).
  // Depend on cheap content signatures instead, so the effect (and setPicker)
  // only actually re-fires when the picker's *content* changed.
  const movesKey = moves.map((m) => `${m.shipIdx}:${m.dest.kind}${'planetId' in m.dest ? ':' + m.dest.planetId : ''}`).join('|');
  const shipsKey = actorShips.map((s) => `${s.kind}${'planetId' in s ? ':' + s.planetId : ''}${'level' in s ? ':' + s.level : ''}`).join('|');
  React.useEffect(() => {
    setPicker({ moves, actorShips, shipIdx: pickedShip, setShipIdx: setMoveShip, submit, verb });
    return () => setPicker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- movesKey/shipsKey stand in for moves/actorShips on purpose (see comment above); submit is safe to omit because its behavior only depends on data already covered by these keys plus the stable onAction/setMoveShip.
  }, [movesKey, shipsKey, pickedShip, setMoveShip, verb, setPicker]);

  if (moves.length === 0) {
    return (
      <div className="actions">
        {!extras && emptyText && <p className="muted">{emptyText}</p>}
        {extras}
      </div>
    );
  }

  // Step 1 — choose the ship (tap a Fleet chip above; also shown if a prior pick
  // is no longer movable).
  if (!shipPicked) {
    return (
      <div className="actions move-status">
        <p className="muted small">{prompt} <span className="move-hint">Tap one of your ships above.</span></p>
        {extras}
      </div>
    );
  }

  // Step 2 — the destination is chosen by tapping a Land/Orbit pill on a planet
  // card, or the Home-galaxy pill next to the Fleet, both driven by the picker
  // context above. This status line just confirms what's picked and lets the
  // player back out.
  const canGoHome = moves.some((m) => m.shipIdx === pickedShip && m.dest.kind === 'galaxy');
  return (
    <div className="actions move-status">
      <p className="muted small">
        {verb} <strong>Ship #{pickedShip! + 1}</strong> ({shipLocText(actorShips[pickedShip!])}) —
        tap a destination{canGoHome ? ' (or Home, above)' : ''} on a planet card above.{' '}
        {/* With one movable ship there is no other ship to choose — the link
         *  would just re-derive the same pick, so it's dropped. */}
        {shipIdxs.length > 1 && (
          <button className="link-btn" onClick={() => setMoveShip(null)}>Choose a different ship</button>
        )}
      </p>
      {extras}
    </div>
  );
}

/**
 * Diplomacy/Economy die: publishes its options to AdvancePickerContext (see
 * comment there) instead of rendering a flat button list — the eligible planet
 * cards become the tap targets. This is just a status line + publisher, mirroring
 * MoveSteps' pattern.
 *
 * Nothing here to auto-collapse (§4 audit): unlike MoveSteps there is no ship
 * *and* destination to pick — one planet card is one option, so a single
 * eligible ship already means a single tap target. The card's confirm control
 * (see PlanetCardView's advanceControls) is a deliberate confirmation, not a
 * selection step, and stays even when there's only one option.
 */
function AdvanceSteps({ options, submit, verb, emptyText }: { options: AdvanceOption[]; submit: (a: Action) => void; verb: string; emptyText?: string }) {
  const { setPicker } = React.useContext(AdvancePickerContext);
  // Same reasoning as MoveSteps: `options`/`submit` are fresh references every
  // render, so depend on a cheap content signature instead of the arrays/function
  // themselves, or this republishes (and re-renders Board) on every render.
  const optionsKey = options.map((o) => `${o.shipIdx}:${o.planetId}`).join('|');
  React.useEffect(() => {
    setPicker({ options, submit, verb });
    return () => setPicker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionsKey stands in for options on purpose (see comment above).
  }, [optionsKey, verb, setPicker]);

  if (options.length === 0) {
    return <div className="actions"><p className="muted">{emptyText ?? 'No ship can advance right now.'}</p></div>;
  }
  return (
    <div className="actions move-status">
      <p className="muted small">{verb} — tap a highlighted planet above to confirm.</p>
    </div>
  );
}

function PlayerPanel({ p, state, isViewer, isActive, upgradeActions = [], colonyActions = [], onUpgrade, onColonyAction }: { p: PlayerState; state: GameState; isViewer: boolean; isActive: boolean; upgradeActions?: Array<Extract<Action, { type: 'activateColonyGalaxy' }>>; colonyActions?: Array<Extract<Action, { type: 'activateColonyPlanet' }>>; onUpgrade?: (action: Extract<Action, { type: 'activateColonyGalaxy' }>) => void; onColonyAction?: (action: Extract<Action, { type: 'activateColonyPlanet' }>) => void }) {
  const lvl = empire(p.empireLevel);
  const next = p.empireLevel < MAX_EMPIRE ? empire(p.empireLevel + 1) : null;
  const asset = useAsset();
  const artless = useArtless();
  // Colony-card enlarge is hover-only on desktop; touch has no hover, so tapping
  // a card toggles the same zoom preview.
  const [zoomedColony, setZoomedColony] = useState<string | null>(null);
  // Opponent-only: tapping the compact chip opens the full detail in a sheet.
  const [detailOpen, setDetailOpen] = useState(false);
  // Read unconditionally (before the isViewer branch below) — Rules of Hooks.
  // Only the viewer's own Fleet chips act as tap targets for the picker.
  const { picker } = React.useContext(MovePickerContext);
  const nextBenefits = next ? [
    next.dice > lvl.dice ? `+${next.dice - lvl.dice} die` : null,
    next.ships > lvl.ships ? `+${next.ships - lvl.ships} ship` : null,
  ].filter(Boolean).join(' · ') : '';
  // Shared between the viewer's own colonies section and an opponent's detail
  // sheet — a compact thumbnail/text list of colonized planets.
  const renderColonies = (pl: PlayerState) => pl.colonized.length > 0 && (
    <div className="pp-colonies">
      <span className="pp-colonies-label">Colonies (use via Colony die):</span>
      <div className="colony-cards">
        {pl.colonized.map((id) => {
          const cp = PLANETS_BY_ID[id];
          if (artless) {
            return (
                <div key={id} className="colony-text">
                  <strong>{cp?.name}</strong> <span className="muted small">(+{cp?.vp} VP)</span>
                  <div className="colony-text-action">{cp?.action}</div>
                  {isViewer && colonyActions.find((a) => a.planetId === id) && <button type="button" className="colony-use-btn" onClick={() => onColonyAction?.(colonyActions.find((a) => a.planetId === id)!)}>Use colony</button>}
                </div>
            );
          }
          return (
            <div key={id} className="colony-card" title={`${cp?.name}: ${cp?.action}`} onClick={() => setZoomedColony((cur) => (cur === id ? null : id))}>
              <img className="cc-thumb" src={asset(`/cards/${id}.jpg`)} alt={cp?.name} loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              <span className="cc-vp">+{cp?.vp}</span>
              <span className="cc-name">{cp?.name}</span>
              {isViewer && colonyActions.find((a) => a.planetId === id) && <button type="button" className="colony-use-btn" onClick={(e) => { e.stopPropagation(); onColonyAction?.(colonyActions.find((a) => a.planetId === id)!); }}>Use</button>}
              <img className={`pc-zoom ${zoomedColony === id ? 'open' : ''}`} src={asset(`/cards/${id}.jpg`)} alt="" aria-hidden="true" />
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!isViewer) {
    // Persistent opponent summary: resources and empire level stay visible;
    // tapping remains available for colonies, mission and Rogue details.
    return (
      <>
        <button
          type="button"
          className={`opponent-chip ${p.color} ${isActive ? 'active' : ''}`}
          onClick={() => setDetailOpen(true)}
          title={`${p.name} — tap for details`}
        >
          <span className="oc-dot" aria-hidden="true" />
          <span className="oc-name">{p.name}{p.isRogue ? ' ☠' : ''}</span>
          <span className="oc-vp">{baseVp(state, p)}<small>VP</small></span>
          <span className="oc-resources">
            <MiniGauge type="energy" value={p.energy} />
            <MiniGauge type="culture" value={p.culture} />
            <MiniEmpireGauge level={p.empireLevel} />
          </span>
        </button>
        <Sheet open={detailOpen} onClose={() => setDetailOpen(false)} title={`${p.name}${p.isRogue ? ' ☠' : ''}`}>
          <div className="opponent-detail">
            <div className="opponent-stats">
              <span className="resource-chip vp" title="Victory points"><b>{baseVp(state, p)}</b><small>VP</small></span>
              <ResourceGauge type="energy" value={p.energy} />
              <ResourceGauge type="culture" value={p.culture} />
              <span className="resource-chip empire-detail-gauge" title={`${lvl.dice} dice and ${lvl.ships} ships`}>
                <span className="eyebrow">Empire</span>
                <EmpireLevelMeter level={p.empireLevel} />
                <small>{lvl.dice} dice · {lvl.ships} ships</small>
              </span>
            </div>
            {renderColonies(p)}
            {p.mission && p.mission.id !== 'hidden' && (
              <div className="pp-mission" title={p.mission.objective}>
                🎯 {p.mission.name}: {p.mission.objective}
              </div>
            )}
            {p.isRogue && <RogueCardLadder empireLevel={p.empireLevel} cardId={state.rogueCard} />}
          </div>
        </Sheet>
      </>
    );
  }

  return (
    <div className={`player-panel ${p.color} ${isActive ? 'active' : ''} ${isViewer ? 'viewer' : ''}`}>
      <div className="pp-head">
        <span><span className="eyebrow">Your galaxy</span><span className="pp-name">{p.name}</span></span>
        <span className="pp-vp">{baseVp(state, p)} VP</span>
      </div>
      <div className="player-overview">
        <div className="key-stats">
          <ResourceGauge type="energy" value={p.energy} />
          <ResourceGauge type="culture" value={p.culture} />
        </div>
        <div className={`empire-summary ${next && (p.energy >= next.upgradeCost || p.culture >= next.upgradeCost) ? 'affordable' : ''}`}>
          <div className="empire-current">
            <span className="eyebrow">Empire</span>
            <EmpireLevelMeter level={p.empireLevel} />
            <span>{lvl.vp} VP</span>
          </div>
          {next ? (
            <div className="empire-next">
              <span className="eyebrow">Next upgrade cost</span>
              <strong>{next.upgradeCost}</strong>
              <span>Unlocks {nextBenefits}</span>
            </div>
          ) : (
            <div className="empire-next maxed"><span className="eyebrow">Empire</span><strong>Maximum level</strong><span>All dice and ships unlocked</span></div>
          )}
          {isViewer && upgradeActions.length > 0 && (
            <div className="empire-upgrade-actions">
              <span className="eyebrow">Upgrade now</span>
              <div>
                {upgradeActions.map((a) => (
                  <button key={a.pay} type="button" className="empire-upgrade-btn" onClick={() => onUpgrade?.(a)}>
                    Pay {a.pay === 'energy' ? '⚡ Energy' : '🏛 Culture'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="pp-ships" aria-label="Ship locations">
        <span className="pp-ships-label">Fleet</span>
        {p.ships.map((s, i) => {
          const where = s.kind === 'galaxy' ? 'home'
            : s.kind === 'locked' ? 'locked'
            : s.kind === 'surface' ? `on ${PLANETS_BY_ID[s.planetId]?.name}`
            : `orbit ${PLANETS_BY_ID[s.planetId]?.name} ${s.level === 0 ? 'start' : `sp.${s.level}`}`;
          // A ship is a tap target when a move picker is active and it has at
          // least one legal destination (Home/Land/Orbit — see MovePickerContext).
          const movable = picker?.moves.some((m) => m.shipIdx === i) ?? false;
          const selected = picker?.shipIdx === i;
          if (!movable) {
            return (
              <span key={i} className={`ship ${s.kind}`} title={`Ship #${i + 1}: ${where}`}>
                <b>{i + 1}</b><img className="ship-art" src={asset(`/ships/${p.color}-rocket.png`)} alt="" aria-hidden="true" /><small className="ship-location">{where}</small>
              </span>
            );
          }
          return (
            <button
              key={i}
              type="button"
              className={`ship ${s.kind} tappable ${selected ? 'selected' : ''}`}
              title={`Ship #${i + 1}: ${where} — tap to move`}
              onClick={() => picker!.setShipIdx(selected ? null : i)}
            >
              <b>{i + 1}</b><img className="ship-art" src={asset(`/ships/${p.color}-rocket.png`)} alt="" aria-hidden="true" /><small className="ship-location">{where}</small>
            </button>
          );
        })}
        {/* Home-galaxy is a legal destination for a picked ship but isn't tied to
         *  any planet card, so it gets its own pill right next to the Fleet. */}
        {picker?.shipIdx != null && picker.moves.some((m) => m.shipIdx === picker.shipIdx && m.dest.kind === 'galaxy') && (
          <button
            type="button"
            className="ship-dest-pill home"
            onClick={() => {
              const m = picker.moves.find((mv) => mv.shipIdx === picker.shipIdx && mv.dest.kind === 'galaxy');
              if (m) picker.submit(m.action);
            }}
          >
            ⤴ Home galaxy
          </button>
        )}
      </div>
      {renderColonies(p)}
      {isViewer && p.mission && p.mission.id !== 'hidden' && (
        <div className="pp-mission" title={p.mission.objective}>
          🎯 {p.mission.name}: {p.mission.objective}
        </div>
      )}
    </div>
  );
}

/** Glanceable approximate resource level for the compact opponent chip — a
 *  small bar, not the full numeric readout (that's what the detail sheet's
 *  ResourceGauge is for). */
function MiniGauge({ type, value }: { type: 'energy' | 'culture'; value: number }) {
  const label = type === 'energy' ? 'Energy' : 'Culture';
  return (
    <span className={`oc-gauge ${type}`} title={`${label}: ${value}/${RESOURCE_MAX}`}>
      <span className="oc-gauge-label">{type === 'energy' ? '⚡ Energy' : '🏛 Culture'}</span>
      <span className="oc-gauge-track" role="progressbar" aria-label={`${label}: ${value} of ${RESOURCE_MAX}`} aria-valuemin={0} aria-valuemax={RESOURCE_MAX} aria-valuenow={value}>
        {Array.from({ length: RESOURCE_MAX }, (_, i) => <span key={i} className={`oc-gauge-segment ${i < value ? 'filled' : ''}`} />)}
        <strong>{value}<span>/{RESOURCE_MAX}</span></strong>
      </span>
    </span>
  );
}

function MiniEmpireGauge({ level }: { level: number }) {
  return (
    <span className="oc-gauge empire" title={`Empire level: ${level}/${MAX_EMPIRE}`}>
      <span className="oc-gauge-label">◆ Empire</span>
      <span className="oc-gauge-track" role="progressbar" aria-label={`Empire level ${level} of ${MAX_EMPIRE}`} aria-valuemin={1} aria-valuemax={MAX_EMPIRE} aria-valuenow={level}>
        {Array.from({ length: MAX_EMPIRE }, (_, i) => <span key={i} className={`oc-gauge-segment ${i < level ? 'filled' : ''}`} />)}
        <strong>L{level}<span>/{MAX_EMPIRE}</span></strong>
      </span>
    </span>
  );
}

function ResourceGauge({ type, value }: { type: 'energy' | 'culture'; value: number }) {
  const energy = type === 'energy';
  const label = energy ? 'Energy' : 'Culture';
  const icon = energy ? '⚡' : '🏛';
  return (
    <span className={`resource-chip resource-gauge ${type}`} title={`${label}: ${value}/${RESOURCE_MAX}`}>
      <span className="gauge-head"><b>{icon}</b><small>{label}</small></span>
      <span className="gauge-track" role="progressbar" aria-label={`${label}: ${value} of ${RESOURCE_MAX}`} aria-valuemin={0} aria-valuemax={RESOURCE_MAX} aria-valuenow={value}>
        {Array.from({ length: RESOURCE_MAX }, (_, i) => <span key={i} className={`gauge-segment ${i < value ? 'filled' : ''}`} />)}
        <strong>{value}<span>/{RESOURCE_MAX}</span></strong>
      </span>
    </span>
  );
}

function EmpireLevelMeter({ level }: { level: number }) {
  return (
    <span className="empire-level-meter" role="progressbar" aria-label={`Empire level ${level} of ${MAX_EMPIRE}`} aria-valuemin={1} aria-valuemax={MAX_EMPIRE} aria-valuenow={level}>
      {Array.from({ length: MAX_EMPIRE }, (_, i) => <span key={i} className={`empire-level-segment ${i < level ? 'filled' : ''}`} />)}
      <strong>L{level}<small>/{MAX_EMPIRE}</small></strong>
    </span>
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
      <span className="pp-rogue-card-label">☠ Colony action</span>
      <strong>{card.desc[active]}</strong>
      <details>
        <summary>{card.name} · {card.tier} — all levels</summary>
        <div className="rogue-ladder">
          {[1, 2, 3, 4, 5].map((lvl) => (
            <div key={lvl} className={`rogue-ladder-row ${lvl === active ? 'active' : ''}`} title={lvl === active ? 'Current Rogue empire level' : undefined}>
              <span className="rogue-ladder-lvl">L{lvl}</span>
              <span className="rogue-ladder-effect">{card.desc[lvl]}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function PlanetCardView({ planet, state }: { planet: Planet; state: GameState }) {
  const asset = useAsset();
  const artless = useArtless();
  // If this card's art can't load (no shipped art / no VASSAL module / a gap in
  // either), fall back to the clean text card instead of a broken image.
  const [imgFailed, setImgFailed] = useState(false);
  const textMode = artless || imgFailed;
  // Enlarge is hover-only on desktop; touch has no hover, so a tap toggles it too.
  const [zoomOpen, setZoomOpen] = useState(false);
  const { picker } = React.useContext(MovePickerContext);
  const { picker: advPicker } = React.useContext(AdvancePickerContext);
  // Ships currently on/around this planet.
  const here: string[] = [];
  for (const pl of state.players) {
    pl.ships.forEach((s) => {
      if (s.kind === 'surface' && s.planetId === planet.id) here.push(`${pl.name}: surface`);
      if (s.kind === 'orbit' && s.planetId === planet.id) here.push(`${pl.name}: ${s.level === 0 ? 'orbit start' : `orbit ${s.level}/${planet.orbitTrackLength}`}`);
    });
  }
  // Text mode already shows name (pc-text-head), colonize type (border-left
  // color) and VP (badge) elsewhere on the compact card, so its meta line only
  // needs to add what isn't shown yet — the colonize cost. Art mode has none
  // of that, so it keeps the full line.
  const meta = (
    <div className="pc-meta">
      {!textMode && <strong>{planet.name}</strong>}
      <span>
        {textMode
          ? `colonize in ${planet.orbitTrackLength + 1}`
          : <>{planet.resourceType === 'energy' ? '⚡' : '🏛'} · {planet.colonizeType} · colonize in {planet.orbitTrackLength + 1} · {planet.vp}VP</>}
      </span>
      {here.length > 0 && <span className="pc-ships">{here.join(' | ')}</span>}
    </div>
  );

  // When a ship is picked for a move (see MovePickerContext), this planet becomes
  // a tap target for whichever of "land"/"orbit" is a legal destination for it —
  // replaces the old flat "PLANETNAME — land on surface" text-button list.
  const landMove = picker?.shipIdx != null
    ? picker.moves.find((m) => m.shipIdx === picker.shipIdx && m.dest.kind === 'surface' && m.dest.planetId === planet.id)
    : undefined;
  const orbitMove = picker?.shipIdx != null
    ? picker.moves.find((m) => m.shipIdx === picker.shipIdx && m.dest.kind === 'orbit' && m.dest.planetId === planet.id)
    : undefined;
  const movePills = (landMove || orbitMove) && (
    <div className="pc-move-targets">
      {landMove && (
        <button type="button" className="ship-dest-pill" title={destText(landMove.dest)} onClick={(e) => { e.stopPropagation(); picker!.submit(landMove.action); }}>
          🛬 Land here
        </button>
      )}
      {orbitMove && (
        <button type="button" className="ship-dest-pill" title={destText(orbitMove.dest)} onClick={(e) => { e.stopPropagation(); picker!.submit(orbitMove.action); }}>
          🛰 Enter orbit
        </button>
      )}
    </div>
  );

  // Diplomacy/Economy: this planet has one of the viewer's ships already
  // orbiting it and eligible to advance (see AdvancePickerContext) — there's no
  // destination to pick (it just moves 1 space further on the track it's
  // already on), so tapping the card itself is the whole interaction.
  const advance = advPicker?.options.find((o) => o.planetId === planet.id);
  const actionable = !!(movePills || advance);
  // Diplomacy/Economy is a one-step choice: the highlighted planet exposes its
  // action immediately, so the player only needs one click after selecting the die.
  const advanceButton = advance && (
    <button type="button" className="ship-dest-pill pc-advance-target" onClick={(e) => { e.stopPropagation(); advPicker!.submit(advance.action); }}>
      ✓ Advance ship #{advance.shipIdx + 1}
    </button>
  );

  if (textMode) {
    // The compact 2x2 grid only has room for a couple of lines of action text
    // (see .pc-text-action's line-clamp) — same "tap to see the rest" contract
    // as the art card below, just via a fixed overlay instead of a bigger
    // image, so the full effect text is never lost, only ever a tap away, and
    // never needs the row's own scroll to read.
    return (
      <div
        className={`planet-card text ${planet.colonizeType} ${actionable ? 'actionable' : ''}`}
        onClick={() => setZoomOpen((v) => !v)}
      >
        <div className="pc-text-head">
          <strong>{planet.name}</strong>
          <span className="pc-expand-hint" aria-hidden="true">▾</span>
          <span className="pc-vp-badge">{planet.vp}</span>
        </div>
        <div className="pc-text-action">{planet.action}</div>
        {meta}
        {movePills}
        {advanceButton}
        {zoomOpen && (
          <div className="pc-zoom-wrap text" onClick={(e) => e.stopPropagation()}>
            <div className="pc-zoom-text-card">
              <div className="pc-text-head">
                <strong>{planet.name}</strong>
                <span className="pc-vp-badge">{planet.vp}</span>
              </div>
              <div className="pc-text-action full">{planet.action}</div>
              {meta}
              {movePills}
              {advance ? advanceButton : (
                <button type="button" className="ship-dest-pill close" onClick={() => setZoomOpen(false)}>✕ Close</button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`planet-card ${actionable ? 'actionable' : ''}`}>
      {/* No {meta} here on purpose: the actual VASSAL card art already prints
       *  the name, resource icon, colonize cost and VP on its face — a text
       *  summary under a *cropped* copy of that same card was both stealing
       *  the room the image needed to not be cropped AND repeating what's
       *  already on it. Ships here are conveyed by PlanetTokens instead
       *  (colored icons placed on the card itself, not a separate text line).
       *  Text mode has no art to read this off of, so it keeps {meta}. */}
      <div className="pc-art" onClick={() => setZoomOpen((v) => !v)}>
        <img src={asset(`/cards/${planet.id}.jpg`)} alt={`${planet.name} — ${planet.colonizeType}, colonize in ${planet.orbitTrackLength + 1}, ${planet.vp}VP`} loading="lazy" onError={() => setImgFailed(true)} />
        <PlanetTokens planet={planet} state={state} />
      </div>
      {advanceButton}
      {movePills}
      {/* Tap the art to enlarge (escapes the scrolling row via fixed positioning);
       *  an eligible advance gets its confirm/close buttons attached here too. */}
      {zoomOpen && (
        <div className="pc-zoom-wrap">
          <img className="pc-zoom-img" src={asset(`/cards/${planet.id}.jpg`)} alt="" onClick={() => setZoomOpen(false)} />
          {advance ? advanceButton : (
            <button type="button" className="ship-dest-pill close" onClick={() => setZoomOpen(false)}>✕ Close</button>
          )}
        </div>
      )}
    </div>
  );
}

function DiceTray({
  state,
  canAct,
  activatableDieIds,
  selectedDie,
  autoSelected,
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
  /** True when `selectedDie` wasn't tapped by the player but derived because it
   *  was the only activatable die (see Board's autoDie) — the header says so
   *  instead of telling them to pick a die they've already been given. */
  autoSelected: boolean;
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
        <h3>Dice {canAct && !rerolling && !converting && (
          <span className="muted small">
            {autoSelected
              ? '— only one die can be used; it’s selected'
              : activatableDieIds.size === 0
              ? '— no die can be used'
              : '— click a die to activate it'}
          </span>
        )}
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
  onRequestConfirm,
  viewerName,
  actorShips,
  selectedDie,
  autoResolvingFollow,
  canUndo,
  onUndo,
}: {
  state: GameState;
  canAct: boolean;
  legalActions: Action[];
  onAction: (a: Action) => void;
  /** Escapes the clipped action panel: Board renders the actual bottom-sheet
   *  confirm and calls onAction itself. */
  onRequestConfirm: (action: Action, message: string) => void;
  viewerName: string;
  actorShips: import('../engine/index.js').ShipLocation[];
  selectedDie: number | null;
  /** Board is auto-declining the open follow window this render (its only legal
   *  answer was "decline" — see Board's autoDecline): don't put the accept/
   *  decline controls on screen for the one frame before the state updates. */
  autoResolvingFollow?: boolean;
  canUndo?: boolean;
  onUndo?: () => void;
}) {
  // Move orders are picked in two steps: choose the ship, then its destination
  // (the flat ship×destination list was cumbersome — Joe Reil's suggestion).
  // Used for the Move die, NAGATO moves, and PIEDES repeat-move.
  const [moveShip, setMoveShip] = useState<number | null>(null);
  // The selected die's option list opens in a sheet (it doesn't fit inline in
  // portrait). Using a die is never mandatory — ending the turn instead is
  // always legal — and since Board now auto-selects a lone activatable die, that
  // sheet can open without the player ever tapping a die: it has to be
  // dismissible, or a single-usable-die turn would sit behind an overlay with no
  // way to reach End Turn. (The pendingChoice sheet below stays mandatory: there
  // the engine has no other legal action to offer.)
  const [optionsClosed, setOptionsClosed] = useState(false);
  const [colonyOptionsOpen, setColonyOptionsOpen] = useState(false);
  // Reset the ship pick when the context changes: a different die selected, a new
  // planet prompt, a NAGATO move consumed, or a different follow window. (Use stable
  // bits of pendingFollow, not the object — it's a fresh ref on every multiplayer poll.)
  React.useEffect(() => { setMoveShip(null); setOptionsClosed(false); setColonyOptionsOpen(false); }, [
    selectedDie,
    state.turn.pendingChoice?.planetId,
    state.turn.pendingMoves?.left,
    state.turn.pendingFollow?.sourcePlayer,
    state.turn.pendingFollow?.face,
  ]);

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
  // track progress you've invested in getting there) — via Board's ConfirmSheet
  // (see onRequestConfirm) rather than window.confirm.
  const submit = (a: Action) => {
    if (a.type === 'activateMove') {
      const sh = actorShips[a.shipIdx];
      if (sh?.kind === 'orbit') {
        const pl = PLANETS_BY_ID[sh.planetId];
        const where = sh.level === 0 ? 'the start of its orbit' : `space ${sh.level}/${pl?.orbitTrackLength}`;
        onRequestConfirm(a, `Move ship #${a.shipIdx + 1} off ${pl?.name}? It abandons its orbit progress (${where}).`);
        return;
      }
    }
    onAction(a);
  };

  // Target-choice prompt for a planet action.
  const choiceActions = legalActions.filter((a) => a.type === 'resolvePlanet' || a.type === 'skipPlanet');
  if (state.turn.pendingChoice && choiceActions.length > 0) {
    const planet = PLANETS_BY_ID[state.turn.pendingChoice.planetId];
    // Single-choice automation: a one-entry list isn't a choice. Reframe it as a
    // confirmation ("Confirm", one prominent button) instead of asking the
    // player to "choose a target" from a list of one. It still takes an explicit
    // tap — the action changes the game state.
    const singleChoice = choiceActions.length === 1;
    const head = (
      <>
        <div className="ap-head">
          <h3>{singleChoice ? 'Confirm' : 'Choose a target'}</h3>
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
    // The flat choice list competes for the dice tray's vertical space when
    // rendered inline (confirmed clipped in portrait) — it's a mandatory
    // decision (no dismiss), so it opens as a bottom sheet instead, same
    // family as ConfirmSheet/the log drawer. The head (title + planet blurb)
    // stays inline since it's just a couple of lines, not a list.
    return (
      <div className="action-panel choose">
        {head}
        <p className="muted small">{singleChoice ? 'Only one option — confirm below.' : 'Tap a target below.'}</p>
        <Sheet open title={singleChoice ? 'Confirm' : planet?.name}>
          <div className="actions">
            {choiceActions.map((a, i) => (
              <button
                key={i}
                className={`act-btn ${a.type === 'skipPlanet' ? 'end' : ''} ${singleChoice ? 'single-choice' : ''}`}
                onClick={() => onAction(a)}
                title={actionTooltip(a)}
              >
                {actionLabel(a, actorShips, actor)}
              </button>
            ))}
          </div>
        </Sheet>
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
    // Board is submitting the decline itself this render (nothing here was
    // followable) — flash a status line, not a popup asking a question that has
    // one answer. The toast explains it; the state update lands immediately.
    if (autoResolvingFollow) {
      return (
        <div className="action-panel waiting">
          <h3>Actions</h3>
          <p className="muted">Follow action — nothing you can copy; continuing…</p>
        </div>
      );
    }
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
    const follower = state.players.find((p) => p.id === state.turn.pendingFollow?.queue[0]);
    const resourceFollow = face === 'energy' || face === 'culture';
    const resourceIcon = face === 'energy' ? '⚡' : '🏛';
    const resourceName = face === 'energy' ? 'Energy' : 'Culture';
    const resourceGain = resourceFollow && follower ? acquireCount(follower, face) : 0;
    const resourceBefore = resourceFollow && follower ? (face === 'energy' ? follower.energy : follower.culture) : 0;
    const resourceAfter = Math.min(RESOURCE_MAX, resourceBefore + resourceGain);
    const resourceNet = resourceAfter - resourceBefore - (state.turn.oncePerTurn.includes('nibiru-follow-tax') ? 2 : 1);
    const sourceName = state.players.find((p) => p.id === state.turn.pendingFollow?.sourcePlayer)?.name ?? 'the active player';
    const card = (
      <div className="action-panel follow-card">
        {resourceFollow ? <div className="follow-resource-header"><span aria-hidden="true">{resourceIcon}</span><strong>{sourceName} plays {FACE_LABEL[face]}</strong></div> : <FollowHeader face={face} sourceName={sourceName} follower={follower} state={state} />}
        {face === 'move' ? (
          <MoveSteps
            moves={followMoves}
            actorShips={actorShips}
            moveShip={moveShip}
            setMoveShip={setMoveShip}
            submit={onAction}
            verb="Follow move:"
            prompt="Follow the move — which ship?"
            extras={declineBtn && React.cloneElement(declineBtn, { className: 'follow-decline' })}
          />
        ) : resourceFollow ? (
          <div className="actions follow-choices follow-resource-choices">
            {followActions.map((a, i) => {
              const accepting = a.type === 'follow' && a.accept;
              return <button key={i} className={`act-btn ${accepting ? 'follow-accept' : 'follow-decline'}`} onClick={() => onAction(a)} title={actionTooltip(a)}>
                {accepting ? `Follow · ${resourceNet >= 0 ? '+' : ''}${resourceNet} ${resourceIcon} ${resourceName}` : 'Decline follow'}
              </button>;
            })}
          </div>
        ) : (
          <div className="actions follow-choices">
            {followActions.map((a, i) => (
              <button key={i} className={`act-btn ${a.type === 'follow' && a.accept ? 'follow-accept' : 'follow-decline'}`} onClick={() => onAction(a)} title={actionTooltip(a)}>
                <span className="follow-action-icon" aria-hidden="true">{a.type === 'follow' && a.accept ? ({ move: '🚀', energy: '⚡', culture: '🏛', diplomacy: '🕊', economy: '📈', colony: '✦' } as Record<DieFace, string>)[face] : '×'}</span>
                <span className="follow-action-label">{actionLabel(a, actorShips, actor)}</span>
                <span className="follow-action-arrow" aria-hidden="true">{a.type === 'follow' && a.accept ? '→' : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
    // Follow is an action state, so every face stays in the board's Actions
    // region. Keeping it inline also leaves the galaxy, resources and planets
    // visible while the player decides whether copying the action is worthwhile.
    return card;
  }

  // Reroll and Converter are handled in the dice tray (so the player can pick
  // which dice go where), not as flat buttons here.
  const global = legalActions.filter((a) => actionDieId(a) == null && a.type !== 'reroll' && a.type !== 'convert');
  const forDie = (id: number) => legalActions.filter((a) => actionDieId(a) === id);
  const selectedDieFace = selectedDie != null ? state.turn.dice.find((d) => d.id === selectedDie)?.face : null;
  // Forced end of turn: ending the turn is the *only* legal action left — no die
  // has a legal use, and there's no reroll/Converter to fall back on either
  // (both would appear in legalActions). Nudge the button with a pulse; never
  // submit it for the player, ending your own turn stays a line you cross
  // yourself.
  const forcedEnd = legalActions.length === 1 && legalActions[0].type === 'endTurn';
  // No die can be activated, but something else still can (a reroll, the
  // Converter): don't tell the player to "click one of your dice" — the tray
  // says the same thing and there's nothing there to click.
  const noUsableDie = !legalActions.some((a) => actionDieId(a) != null);

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
        <p className="muted">
          {forcedEnd
            ? 'No die can be used any more — end your turn.'
            : noUsableDie
            ? 'No die can be used right now.'
            : 'Click one of your dice on the left to see what it can do.'}
        </p>
      ) : selectedDieFace === 'move' ? (
        <MoveSteps
          moves={forDie(selectedDie).flatMap((a) => (a.type === 'activateMove' ? [{ shipIdx: a.shipIdx, dest: a.dest, action: a }] : []))}
          actorShips={actorShips}
          moveShip={moveShip}
          setMoveShip={setMoveShip}
          submit={submit}
          emptyText="No ship can move right now."
        />
      ) : selectedDieFace === 'diplomacy' || selectedDieFace === 'economy' ? (
        <AdvanceSteps
          options={forDie(selectedDie).flatMap((a) => {
            if (a.type !== 'activateAdvance') return [];
            const loc = actorShips[a.shipIdx];
            return loc?.kind === 'orbit' ? [{ shipIdx: a.shipIdx, planetId: loc.planetId, action: a }] : [];
          })}
          submit={submit}
          verb={`Advance ${FACE_LABEL[selectedDieFace]}`}
          emptyText="No ship is orbiting a matching planet right now."
        />
      ) : (
        // As with the target-choice list above, a flat button list competes
        // for the dice tray's vertical space when rendered inline — it opens
        // as a bottom sheet once there's an actual list to show. The status
        // line ("Selected die: X") always stays inline; it's just text.
        (() => {
          const options = forDie(selectedDie);
          const galaxyUpgradeAvailable = selectedDieFace === 'colony' && options.some((a) => a.type === 'activateColonyGalaxy');
          const colonyDirectAvailable = selectedDieFace === 'colony' && options.some((a) => a.type === 'activateColonyPlanet');
          // Single-choice automation, same reframing as the target list above: a
          // one-option list becomes a confirmation with one prominent button.
          const single = options.length === 1;
          return (
            <div className="actions move-status">
              <p className="muted small">
                Selected die: <strong>{selectedDieFace && FACE_LABEL[selectedDieFace]}</strong>
                {options.length === 0 ? '' : (galaxyUpgradeAvailable || colonyDirectAvailable) ? ' — choose directly in Your galaxy.' : single ? ' — one option; confirm below.' : ' — tap a choice below.'}
              </p>
              {options.length === 0 && <p className="muted">No legal use for this die right now.</p>}
              {(galaxyUpgradeAvailable || colonyDirectAvailable) && !colonyOptionsOpen ? (
                <button className="act-btn single-choice" onClick={() => setColonyOptionsOpen(true)}>
                  Choose another Colony action
                </button>
              ) : options.length > 0 && (optionsClosed ? (
                <button className="act-btn" onClick={() => setOptionsClosed(false)}>
                  {single ? 'Show the option again' : `Show ${selectedDieFace ? FACE_LABEL[selectedDieFace] : 'die'} options`}
                </button>
              ) : (
                <Sheet
                  open
                  onClose={() => setOptionsClosed(true)}
                  title={single ? 'Confirm' : selectedDieFace ? FACE_LABEL[selectedDieFace] : undefined}
                >
                  <div className="actions">
                    {options.map((a, i) => (
                      <button key={i} className={`act-btn ${single ? 'single-choice' : ''}`} onClick={() => submit(a)} title={actionTooltip(a)}>
                        {actionLabel(a, actorShips, actor)}
                      </button>
                    ))}
                  </div>
                </Sheet>
              ))}
            </div>
          );
        })()
      )}

      <div className="global-actions">
        {global.map((a, i) => (
          <button
            key={i}
            className={`act-btn ${a.type === 'endTurn' ? 'end' : 'global'}${forcedEnd && a.type === 'endTurn' ? ' forced' : ''}`}
            onClick={() => onAction(a)} title={actionTooltip(a)}
          >
            {actionLabel(a, actorShips, actor)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What accepting a follow actually gets you, per die face — shown instead of the
 *  generic "Play the X action" so the reward is concrete at a glance. Mirrors
 *  applyFollowEffect() in src/engine/adapter.ts. Energy/culture faces are handled
 *  separately below (the gain isn't fixed — see FollowHeader). */
const FOLLOW_REWARD: Partial<Record<DieFace, string>> = {
  move: 'Move one of your ships',
  diplomacy: 'Advance a ship 1 step (diplomacy)',
  economy: 'Advance a ship 1 step (economy)',
  colony: 'Trigger a colonized planet, or spend toward an empire upgrade',
};

function FollowHeader({ face, sourceName, follower, state }: { face: DieFace; sourceName: string; follower?: PlayerState; state: GameState }) {
  const asset = useAsset();
  const artless = useArtless();
  const glyph: Record<DieFace, string> = { move: '🚀', energy: '⚡', culture: '🏛', diplomacy: '🕊', economy: '📈', colony: '🏛' };
  const cost = state.turn.oncePerTurn.includes('nibiru-follow-tax') ? 2 : 1;
  const culture = follower?.culture;

  // Unlike a normal die, an Acquire follow doesn't gain a flat amount — it's +1
  // per ship on a matching planet (and +1 energy per ship still on the Galaxy
  // Card), same as the die itself (rulebook p.6). acquireCount() is the engine's
  // own side-effect-free helper for that count, so the preview here can never
  // drift from what actually happens if the player accepts.
  const gainFace = face === 'energy' || face === 'culture' ? face : null;
  const gain = gainFace && follower ? acquireCount(follower, gainFace) : null;
  const before = gainFace && follower ? (gainFace === 'energy' ? follower.energy : follower.culture) : null;
  const after = gain != null && before != null ? Math.min(RESOURCE_MAX, before + gain) : null;
  const next = follower && follower.empireLevel < MAX_EMPIRE ? empire(follower.empireLevel + 1) : null;
  // Call out the one case that actually matters strategically: this follow is
  // what pushes the follower up to affording their next empire upgrade.
  const unlocksUpgrade = next && before != null && after != null && before < next.upgradeCost && after >= next.upgradeCost;

  let reward: React.ReactNode;
  let weak = false;
  if (gainFace && gain != null && before != null && after != null) {
    const icon = gainFace === 'energy' ? '⚡' : '🏛';
    if (before >= RESOURCE_MAX) {
      weak = true;
      reward = <>Already at {RESOURCE_MAX} {icon} {gainFace} — following won't gain anything</>;
    } else if (gain === 0) {
      weak = true;
      reward = <>No ships positioned to gain {icon} {gainFace} right now — following would gain nothing</>;
    } else {
      const net = after - before - cost;
      reward = (
        <>
          <span className="follow-net-gain">{net >= 0 ? '+' : ''}{net} {icon} {gainFace}</span>
          <small className="follow-reward-after">
            Gain {gain} {icon} · cost {cost} 🏛 · {before} → {after} {icon}
            {next && (unlocksUpgrade ? ` · unlocks the ${next.upgradeCost}${icon} empire upgrade!` : ` · upgrade needs ${next.upgradeCost}${icon}`)}
          </small>
        </>
      );
    }
  } else {
    reward = FOLLOW_REWARD[face];
  }

  return (
    <>
      <div className="follow-header">
        <div className="follow-die" aria-label={`${FACE_LABEL[face]} die`}>
          {artless ? <span>{glyph[face]}</span> : <img src={asset(DIE_IMG[face])} alt="" />}
        </div>
        <div className="follow-title">
          <span className="eyebrow">Follow action</span>
          <h3>{sourceName} plays {FACE_LABEL[face]}</h3>
          <p>Copy this action on your turn</p>
        </div>
        <div className="follow-cost">
          <span>Cost</span>
          <strong>{cost} 🏛</strong>
          {culture != null && (
            <small className="follow-cost-after">You have {culture} 🏛 → {Math.max(0, culture - cost)} 🏛 after</small>
          )}
        </div>
      </div>
      <div className={`follow-reward ${weak ? 'weak' : ''}`}>
        <span>{weak ? '⚠ Follow bonus' : '↗ Follow bonus'}</span>
        <strong>{reward}</strong>
      </div>
    </>
  );
}

/** Renders inside the on-demand log drawer (see Board's `logOpen` Sheet) —
 *  internal scroll here is fine since it's only opened on explicit request,
 *  never present during a decision. */
function LogPanel({ log }: { log: import('digital-boardgame-framework').GameLogEntry[] }) {
  return (
    <ul className="log-list">
      {log.slice(-200).reverse().map((e) => (
        <li key={e.seq}>{e.msg ?? e.kind}</li>
      ))}
    </ul>
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
