import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  tegAdapter,
  chooseAction,
  computeWinners,
  type GameState,
} from '../src/engine/index.js';
import { planetOptions, PLANET_EFFECTS } from '../src/engine/planetEffects.js';

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
    const labels = planetOptions(s, s.players[0], 'cp8').map((o) => (o as { label?: string }).label ?? '');
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

describe('follow an upgrade pays both the follow tax and the full upgrade cost', () => {
  it('does not offer a culture-funded upgrade follow that the tax would make unaffordable', () => {
    const s = newGame(5);
    const follower = s.players[1];
    // Set up a colony die on the active player so a follow window opens.
    follower.empireLevel = 5; // L5->L6 costs 6
    follower.culture = 6;     // exactly the upgrade cost, but the +1 follow tax makes it short
    follower.energy = 0;
    // Drive the follow-option generator directly via legalActions in a follow window.
    s.turn.pendingFollow = { face: 'colony', queue: [follower.id], sourcePlayer: s.players[0].id } as any;
    const acts = tegAdapter.legalActions(s, follower.id);
    const cultureUpgrade = acts.find((a) => a.type === 'follow' && (a as any).params?.pay === 'culture');
    expect(cultureUpgrade).toBeUndefined();
  });

  it('refunds the follow tax if the copied upgrade cannot be afforded', () => {
    let s = newGame(5);
    const follower = s.players[1];
    follower.empireLevel = 5;
    follower.culture = 6; // enough for the tax but not tax+upgrade
    follower.energy = 0;
    const before = follower.empireLevel;
    s.turn.pendingFollow = { face: 'colony', queue: [follower.id], sourcePlayer: s.players[0].id } as any;
    s = tegAdapter.applyAction(s, { type: 'follow', accept: true, params: { pay: 'culture' } } as any, follower.id);
    const f = s.players[1];
    expect(f.empireLevel).toBe(before); // no upgrade
    expect(f.culture).toBe(6);          // tax refunded
  });
});

describe('planet effect cost/limit fidelity', () => {
  it('MAIA (cp5) enforces the discard-2-dice cost', () => {
    const s = newGame(1);
    const p = s.players[0];
    p.energy = 0; p.culture = 0;
    s.turn.dice = [{ id: 0, face: 'energy', activated: false }, { id: 1, face: 'culture', activated: false }, { id: 2, face: 'move', activated: false }] as any;
    PLANET_EFFECTS['cp5'](s, p, {});
    expect(s.turn.dice.filter((d: any) => d.inConverter).length).toBe(2);
    expect(p.energy).toBe(2);
    expect(p.culture).toBe(2);
    // With fewer than 2 inactive dice, no benefit.
    const s2 = newGame(1); const p2 = s2.players[0]; p2.energy = 0;
    s2.turn.dice = [{ id: 0, face: 'move', activated: true }] as any;
    PLANET_EFFECTS['cp5'](s2, p2, {});
    expect(p2.energy).toBe(0);
  });

  it('LA-TORRES (cp20) only steals once per turn', () => {
    const s = newGame(1);
    const p = s.players[0]; s.players[1].energy = 5;
    expect(PLANET_EFFECTS['cp20'](s, p, {})).toMatch(/stole/);
    expect(PLANET_EFFECTS['cp20'](s, p, {})).toMatch(/already used/);
  });
});

describe('PIEDES (cp23) can repeat a move die', () => {
  it('offers concrete repeat-move destinations and performs the move', () => {
    let s = newGame(2);
    const p = s.players[0];
    s.centerRow[0] = 'cp23';
    s.turn.dice = [{ id: 9, face: 'move', activated: true }, { id: 0, face: 'move', activated: false }] as any;
    p.ships[0] = { kind: 'galaxy' };
    p.ships[1] = { kind: 'galaxy' };
    // Land ship 0 on PIEDES surface; this should prompt (repeat-move options exist).
    s = tegAdapter.applyAction(s, { type: 'activateMove', dieId: 0, shipIdx: 0, dest: { kind: 'surface', planetId: 'cp23' } } as any, p.id);
    expect(s.turn.pendingChoice?.planetId).toBe('cp23');
    const repeat = tegAdapter.legalActions(s, p.id).find(
      (a) => a.type === 'resolvePlanet' && /Repeat move: ship #2 .* \(orbit\)/.test((a as any).label ?? ''),
    )!;
    expect(repeat).toBeTruthy();
    s = tegAdapter.applyAction(s, repeat, p.id);
    expect(s.players[0].ships[1].kind).not.toBe('galaxy'); // the repeated move happened
    expect(s.turn.pendingChoice).toBeNull();
  });
});

describe('following a move onto a surface still prompts for the planet action', () => {
  it('opens a pendingChoice for the follower, then resumes the follow queue', () => {
    let s = createInitialState({ seats: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 2 });
    const f1 = s.players[1], f2 = s.players[2];
    s.centerRow[0] = 'cp14'; // SHOUHUA: "Advance a ship +1"
    f1.ships[0] = { kind: 'galaxy' };
    f1.ships[1] = { kind: 'orbit', planetId: s.centerRow[1], level: 0 };
    f1.culture = 3;
    f2.culture = 3;
    s.turn.pendingFollow = { face: 'move', queue: [f1.id, f2.id], sourcePlayer: s.players[0].id } as any;
    s = tegAdapter.applyAction(s, { type: 'follow', accept: true, params: { shipIdx: 0, dest: { kind: 'surface', planetId: 'cp14' } } } as any, f1.id);
    // The follower must be prompted for the advance target, not auto-resolved.
    expect(s.turn.pendingChoice?.player).toBe(f1.id);
    expect(tegAdapter.currentActor(s)).toBe(f1.id);
    const choice = tegAdapter.legalActions(s, f1.id).find((a) => a.type === 'resolvePlanet')!;
    s = tegAdapter.applyAction(s, choice, f1.id);
    // After resolving, the follow window resumes with the next follower.
    expect(s.turn.pendingChoice).toBeNull();
    expect(tegAdapter.currentActor(s)).toBe(f2.id);
  });
});
