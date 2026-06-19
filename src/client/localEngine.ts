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

  constructor(seats: LocalSeat[], seed: number, aiThinkMs = 650) {
    this.seats = seats;
    this.aiThinkMs = aiThinkMs;
    this.state = createInitialState({ seats, seed });
    this.scheduleAi();
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

  /** Submit a human action. */
  submit(action: Action, actor: string): void {
    if (tegAdapter.currentActor(this.state) !== actor) return;
    this.state = tegAdapter.applyAction(this.state, action, actor);
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
      this.state = tegAdapter.applyAction(this.state, action, a);
      this.emit();
      this.scheduleAi();
    }, this.aiThinkMs);
  }

  dispose(): void {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.listeners.clear();
  }
}
