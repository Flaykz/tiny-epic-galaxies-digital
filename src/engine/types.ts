// Core domain types for the Tiny Epic Galaxies digital port.

/** The six action-die faces (confirmed from the VASSAL dice art). */
export type DieFace =
  | 'move' // rocket: move a ship
  | 'energy' // acquire energy
  | 'culture' // acquire culture
  | 'diplomacy' // advance colonization (diplomacy)
  | 'economy' // advance colonization (economy)
  | 'colony'; // utilize a colony (galaxy mat or a colonized planet action)

export type ResourceType = 'energy' | 'culture';
export type ColonizeType = 'diplomacy' | 'economy';

/** A planet card, as transcribed from the real cards in the VASSAL module. */
export interface Planet {
  id: string;
  name: string;
  /** Resource the planet produces when an Acquire die is activated. */
  resourceType: ResourceType;
  /** Number of advance steps required to colonize (the highest number on the orbit arc). */
  orbitTrackLength: number;
  /** Which advance action (diplomacy/economy) advances/colonizes this planet. */
  colonizeType: ColonizeType;
  /** Verbatim surface-action text shown on the card. */
  action: string;
  /** Victory points awarded for colonizing. */
  vp: number;
}

export interface SecretMission {
  id: string;
  name: string;
  objective: string;
  bonusVp: number;
}

export type Color = 'blue' | 'green' | 'red' | 'yellow' | 'black';

/** Where a single ship is. */
export type ShipLocation =
  | { kind: 'galaxy' } // standing on the player's own Galaxy Mat (available)
  | { kind: 'locked' } // not yet unlocked by empire level
  | { kind: 'surface'; planetId: string } // standing on a planet surface
  | { kind: 'orbit'; planetId: string; level: number }; // lying on a colony track at `level`

export interface PlayerState {
  id: string; // seat id, e.g. "p1"
  name: string;
  color: Color;
  isRogue: boolean;
  empireLevel: number; // 1..7
  energy: number; // 0..7
  culture: number; // 0..7
  ships: ShipLocation[]; // fixed length 4
  colonized: string[]; // planet ids slid under the galaxy mat
  mission?: SecretMission; // hidden from opponents
}

/** A die in play this turn. */
export interface Die {
  id: number;
  face: DieFace;
  activated: boolean; // moved to the Activation Bay / used
  inConverter: boolean; // consumed by the Converter (spent, not activatable)
}

/** Per-turn ephemeral flags reset each turn. */
export interface TurnState {
  active: string; // player id whose turn it is
  dice: Die[];
  freeRerollUsed: boolean;
  converterUsedThisTurn: boolean;
  /** Planet/card "only once per turn" markers, by a string key. */
  oncePerTurn: string[];
  /** Tracks follows that happened on the most recent activation (for Birnomius/Bisschop). */
  lastActivationFollows: number;
  /** Pending follow decision queue: after an activation, these players may follow. */
  pendingFollow: PendingFollow | null;
  /** Pending target choice for a planet action that requires player input. */
  pendingChoice: PendingChoice | null;
  /** NAGATO (cp21): up-to-two ship moves still owed to a player this activation.
   *  Coexists with pendingChoice — a move that lands on a surface opens a normal
   *  pendingChoice which resolves first, then the remaining moves resume. */
  pendingMoves: PendingMoves | null;
}

export interface PendingMoves {
  player: string;
  left: number;
  /** Follow window to open once all moves are done (the die face used to reach NAGATO). */
  thenFollow: DieFace | null;
}

export interface PendingChoice {
  player: string;
  planetId: string;
  source: 'surface' | 'colony';
  /** Follow window to open once the choice resolves (the die face that was used). */
  thenFollow: DieFace | null;
  /** ZALAX (cp25): die ids already rerolled this activation (excluded from re-offer). */
  rerolled?: number[];
}

export interface PendingFollow {
  face: DieFace;
  queue: string[]; // remaining player ids to offer (clockwise from active)
  // The colony/move sub-target chosen by the active player, so followers copy the *action* not target.
  sourcePlayer: string;
}

export type Phase = 'playing' | 'finalRound' | 'gameOver';

export interface GameState {
  schemaVersion: number;
  rngState: number; // serialized Rng
  players: PlayerState[];
  order: string[]; // seating order (player ids), clockwise
  centerRow: string[]; // planet ids available to colonize (face up in the middle)
  deck: string[]; // remaining planet ids
  turn: TurnState;
  phase: Phase;
  /** Player id who triggered the end (reached 21); final round ends when it returns to the next player after them. */
  endTriggeredBy: string | null;
  turnNumber: number;
  log: string[];
  winners: string[] | null;
  /** Solo mode: the rogue galaxy player id, if any. */
  rogueId: string | null;
  /** Whether the per-activation "follow" prompt is offered. Enabled for local
   *  hotseat (instant); disabled for async multiplayer, where prompting every
   *  opponent after every die is a network round-trip per the framework playbook. */
  followEnabled: boolean;
}

/** The flat, fully-specified action union. Every action is atomic & enumerable. */
export type Action =
  // Activate a die for its face action. Sub-parameters fully specify the choice.
  | { type: 'activateMove'; dieId: number; shipIdx: number; dest: ShipLocation }
  | { type: 'activateAcquire'; dieId: number; resource: ResourceType }
  | { type: 'activateAdvance'; dieId: number; advance: ColonizeType; shipIdx: number }
  | { type: 'activateColonyGalaxy'; dieId: number; pay: ResourceType } // upgrade empire
  | { type: 'activateColonyPlanet'; dieId: number; planetId: string; choice?: PlanetActionChoice }
  // Converter: spend 2 dice, set a 3rd to chosen face.
  | { type: 'convert'; spend: [number, number]; target: number; face: DieFace }
  // Reroll a set of inactive dice (first free, then 1 energy).
  | { type: 'reroll'; dieIds: number[]; free?: boolean }
  // Follow decision (the player being offered a follow).
  | { type: 'follow'; accept: boolean; params?: FollowParams }
  // Resolve a pending planet-action target choice (carries a UI label).
  | { type: 'resolvePlanet'; choice: PlanetActionChoice; label?: string }
  | { type: 'skipPlanet' }
  // NAGATO (cp21): perform one of the up-to-two ship moves; or stop early.
  | { type: 'nagatoMove'; shipIdx: number; dest: ShipLocation; label?: string }
  | { type: 'endMoves' }
  // End the current player's turn.
  | { type: 'endTurn' };

/** Parameters needed to resolve some planet surface actions that require choices. */
export interface PlanetActionChoice {
  shipIdx?: number;
  shipIdx2?: number;
  targetPlayer?: string;
  targetShip?: { player: string; shipIdx: number };
  /** Second regress target (BRUMBAUGH cp40 hits up to two enemy ships). */
  targetShip2?: { player: string; shipIdx: number };
  resource?: ResourceType;
  amount?: number;
  dest?: ShipLocation;
  dieIds?: number[];
  face?: DieFace;
  planetId?: string;
}

export interface FollowParams {
  // When following a move/advance/colony, the follower supplies their own target.
  shipIdx?: number;
  dest?: ShipLocation;
  advance?: ColonizeType;
  resource?: ResourceType;
  planetId?: string;
  pay?: ResourceType;
  choice?: PlanetActionChoice;
}
