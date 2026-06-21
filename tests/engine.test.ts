import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  tegAdapter,
  chooseAction,
  computeWinners,
  type GameState,
} from '../src/engine/index.js';
import { planetOptions } from '../src/engine/planetEffects.js';

function newGame(seed = 42): GameState {
  return createInitialState({
    seats: [{ name: 'Alice' }, { name: 'Bob' }],
    seed,
  });
}

describe('setup', () => {
  it('creates two players with starting resources and ships', () => {
    const s = newGame();
    expect(s.players).toHaveLength(2);
    expect(s.players[0].energy).toBe(2);
    expect(s.players[0].culture).toBe(1);
    // 2 ships on galaxy, 2 locked at empire level 1.
    expect(s.players[0].ships.filter((x) => x.kind === 'galaxy')).toHaveLength(2);
    expect(s.players[0].ships.filter((x) => x.kind === 'locked')).toHaveLength(2);
  });

  it('rolls dice for the active player at start (4 dice at level 1)', () => {
    const s = newGame();
    expect(s.turn.dice).toHaveLength(4);
  });

  it('deals a secret mission to each player', () => {
    const s = newGame();
    expect(s.players[0].mission).toBeDefined();
    expect(s.players[1].mission).toBeDefined();
  });

  it('center row has playerCount + 2 planets', () => {
    const s = newGame();
    expect(s.centerRow).toHaveLength(4);
  });
});

describe('legal actions and turn flow', () => {
  it('active player always has endTurn available', () => {
    const s = newGame();
    const acts = tegAdapter.legalActions(s, s.turn.active);
    expect(acts.some((a) => a.type === 'endTurn')).toBe(true);
  });

  it('non-active player has no actions (outside a follow window)', () => {
    const s = newGame();
    const other = s.order.find((id) => id !== s.turn.active)!;
    expect(tegAdapter.legalActions(s, other)).toHaveLength(0);
  });

  it('endTurn advances to the next player and rerolls', () => {
    const s = newGame();
    const first = s.turn.active;
    const s2 = tegAdapter.applyAction(s, { type: 'endTurn' }, first);
    expect(s2.turn.active).not.toBe(first);
    expect(s2.turn.dice.length).toBeGreaterThanOrEqual(4);
  });
});

describe('viewFor redaction', () => {
  it('hides opponent missions', () => {
    const s = newGame();
    const view = tegAdapter.viewFor(s, s.players[0].id);
    expect(view.players[0].mission?.id).not.toBe('hidden');
    expect(view.players[1].mission?.id).toBe('hidden');
  });
});

describe('full self-play game terminates with a winner', () => {
  it('plays to completion with AI on both seats', () => {
    let s = newGame(7);
    let guard = 0;
    while (tegAdapter.result!(s) === null && guard < 5000) {
      const actor = tegAdapter.currentActor(s);
      if (!actor) break;
      const action = chooseAction(s, actor, guard);
      s = tegAdapter.applyAction(s, action, actor);
      guard++;
    }
    const result = tegAdapter.result!(s);
    expect(result).not.toBeNull();
    expect(s.phase).toBe('gameOver');
    expect(guard).toBeLessThan(5000);
  });
});

describe('solo mode vs Rogue Galaxy', () => {
  it('sets up a rogue opponent with no missions', () => {
    const s = createInitialState({
      seats: [{ name: 'You' }, { name: 'Rogue', isRogue: true }],
      seed: 3,
    });
    expect(s.rogueId).toBe('p2');
    expect(s.players[0].mission).toBeUndefined();
  });

  it('plays a solo game to completion', () => {
    let s = createInitialState({
      seats: [{ name: 'You' }, { name: 'Rogue', isRogue: true }],
      seed: 9,
    });
    let guard = 0;
    while (tegAdapter.result!(s) === null && guard < 5000) {
      const actor = tegAdapter.currentActor(s);
      if (!actor) break;
      s = tegAdapter.applyAction(s, chooseAction(s, actor, guard), actor);
      guard++;
    }
    expect(tegAdapter.result!(s)).not.toBeNull();
  });
});

describe('HELIOS (cp8) discards only un-occupied planets', () => {
  it('excludes a planet that another player is orbiting', () => {
    const s = newGame(3);
    const occ = s.centerRow[0];
    s.players[1].ships[0] = { kind: 'orbit', planetId: occ, level: 0 };
    const labels = planetOptions(s, s.players[0], 'cp8').map((o) => o.label);
    expect(labels.some((l) => l.includes(occ))).toBe(false);
    expect(labels.length).toBe(s.centerRow.length - 1);
  });

  it('self-heals a ship left orbiting a planet no longer in the row', () => {
    let s = newGame(3);
    // Corrupt: ship orbiting a planet that is not in the center row.
    s.players[0].ships[0] = { kind: 'orbit', planetId: 'cp33', level: 1 };
    // Any applied action should normalize the dangling ship back home.
    const actor = tegAdapter.currentActor(s)!;
    s = tegAdapter.applyAction(s, chooseAction(s, actor, 1), actor);
    const stillDangling = s.players[0].ships.some(
      (sh) => (sh.kind === 'orbit' || sh.kind === 'surface') && !s.centerRow.includes(sh.planetId),
    );
    expect(stillDangling).toBe(false);
  });
});
