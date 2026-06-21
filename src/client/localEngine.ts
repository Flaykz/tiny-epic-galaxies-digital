import {
  createInitialState,
  tegAdapter,
  chooseAction,
  type Action,
  type GameState,
  type SeatSpec,
} from '../engine/index.js';

export interface LocalSeat extends SeatSpec {
  /** 'human' seats are controlled via the UI; 'ai' and rogue seats auto-play. */
  control: 'human' | 'ai';
}

/**
 * Drives a fully local game (hotseat + AI + solo Rogue). Holds the authoritative
 * GameState, auto-advances AI/Rogue seats, and notifies subscribers on change.
 */
export class LocalEngine {
  state: GameState;
  private seats: LocalSeat[];
  private listeners = new Set<() => void>();
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  aiThinkMs: number;
  // Snapshots of prior states for undo. Only deterministic, no-new-info actions
  // by the current human are undoable; revealing new info clears the stack.
  private undoStack: GameState[] = [];

  constructor(seats: LocalSeat[], seed: number, aiThinkMs = 650) {
    this.seats = seats;
    this.aiThinkMs = aiThinkMs;
    this.state = createInitialState({ seats, seed });
    this.scheduleAi();
  }

  /** Whether the last human move can be taken back (no new info revealed since). */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.state = prev;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  seatControl(playerId: string): 'human' | 'ai' {
    const idx = this.state.order.indexOf(playerId);
    return this.seats[idx]?.control ?? 'human';
  }

  /** The seat currently on the clock (active player or a pending follower). */
  currentActor(): string | null {
    return tegAdapter.currentActor(this.state);
  }

  legalActions(seat: string): Action[] {
    return tegAdapter.legalActions(this.state, seat);
  }

  /**
   * "New information revealed" since `before` = dice (re)rolled (rngState changed),
   * a new planet drawn (centerRow changed), or the turn passed to another player.
   * Past such a point a move can't be taken back; before it, it can.
   */
  private revealedInfo(before: GameState, after: GameState): boolean {
    return (
      after.rngState !== before.rngState ||
      after.turn.active !== before.turn.active ||
      JSON.stringify(after.centerRow) !== JSON.stringify(before.centerRow)
    );
  }

  /** Submit a human action. */
  submit(action: Action, actor: string): void {
    if (tegAdapter.currentActor(this.state) !== actor) return;
    const before = this.state;
    const after = tegAdapter.applyAction(this.state, action, actor);
    this.state = after;
    if (this.revealedInfo(before, after)) this.undoStack = [];
    else this.undoStack.push(before);
    this.emit();
    this.scheduleAi();
  }

  private scheduleAi(): void {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    const actor = tegAdapter.currentActor(this.state);
    if (!actor) return;
    if (this.seatControl(actor) !== 'ai') return;
    this.aiTimer = setTimeout(() => {
      const a = tegAdapter.currentActor(this.state);
      if (!a || this.seatControl(a) !== 'ai') return;
      const action = chooseAction(this.state, a, this.state.turnNumber * 31 + 7);
      const before = this.state;
      this.state = tegAdapter.applyAction(before, action, a);
      // An AI's OWN turn (or any board-revealing follow) ends undo; but an AI just
      // declining a follow window the human opened reveals nothing, so the human
      // can still take back the move that opened it.
      if (this.revealedInfo(before, this.state)) this.undoStack = [];
      this.emit();
      this.scheduleAi();
    }, this.aiThinkMs);
  }

  dispose(): void {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.listeners.clear();
  }
}
