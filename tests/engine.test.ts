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

  it('plays a solo game to completion with the Rogue automa, never landing on a surface', async () => {
    const { rogueNextAction } = await import('../src/engine/index.js');
    let s = createInitialState({ seats: [{ name: 'You' }, { name: 'Rogue', isRogue: true }], seed: 9 });
    const rid = s.rogueId!;
    let guard = 0, rogueSurfaced = false;
    while (tegAdapter.result!(s) === null && guard < 20000) {
      const actor = tegAdapter.currentActor(s);
      if (!actor) break;
      const action = actor === rid ? rogueNextAction(s) : chooseAction(s, actor, guard);
      s = tegAdapter.applyAction(s, action, actor);
      if (s.players.find((p) => p.id === rid)!.ships.some((sh) => sh.kind === 'surface')) rogueSurfaced = true;
      guard++;
    }
    expect(tegAdapter.result!(s)).not.toBeNull();
    expect(rogueSurfaced).toBe(false); // "A Rogue ship can never land on a planet's surface"
  });

  it('Rogue end-of-turn: max energy upgrades the empire; reaching the skull wins', async () => {
    const { rogueEndOfTurn } = await import('../src/engine/rogue.js');
    let s = createInitialState({ seats: [{ name: 'You' }, { name: 'Rogue', isRogue: true }], seed: 1 });
    const r = s.players.find((p) => p.isRogue)!;
    r.empireLevel = 2; r.energy = 7;
    rogueEndOfTurn(s);
    expect(r.empireLevel).toBe(3);
    expect(r.energy).toBe(0);
    // At max empire, a max-energy upgrade reaches the skull → Rogue wins.
    r.empireLevel = 6; r.energy = 7;
    rogueEndOfTurn(s);
    expect(s.phase).toBe('gameOver');
    expect(s.winners).toEqual([]);
  });

  it('Advanced difficulty rerolls an unusable Rogue die once before discarding', () => {
    let s = createInitialState({ seats: [{ name: 'You' }, { name: 'Rogue', isRogue: true }], seed: 2, rogueDifficulty: 'advanced' });
    expect(s.rogueDifficulty).toBe('advanced');
    const r = s.players.find((p) => p.isRogue)!;
    // No ship on the Galaxy → a Move die is unusable and should be rerolled.
    r.ships = s.centerRow.map((pid) => ({ kind: 'orbit' as const, planetId: pid, level: 0 }));
    s.turn.active = r.id;
    s.turn.dice = [{ id: 0, face: 'move', activated: false }] as any;
    const before = s.log.length;
    s = tegAdapter.applyAction(s, { type: 'rogueResolveDie', dieId: 0 } as any, r.id);
    expect(s.log.slice(before).some((l) => /rerolled an unusable die/.test(l.msg ?? ''))).toBe(true);
  });

  it('Beginner difficulty discards an unusable Rogue die (no reroll)', () => {
    let s = createInitialState({ seats: [{ name: 'You' }, { name: 'Rogue', isRogue: true }], seed: 2, rogueDifficulty: 'beginner' });
    const r = s.players.find((p) => p.isRogue)!;
    r.ships = s.centerRow.map((pid) => ({ kind: 'orbit' as const, planetId: pid, level: 0 }));
    s.turn.active = r.id;
    s.turn.dice = [{ id: 0, face: 'move', activated: false }] as any;
    const before = s.log.length;
    s = tegAdapter.applyAction(s, { type: 'rogueResolveDie', dieId: 0 } as any, r.id);
    expect(s.log.slice(before).some((l) => /rerolled an unusable die/.test(l.msg ?? ''))).toBe(false);
  });

  it('all five Rogue cards run every colony-ladder level without error', async () => {
    const { ROGUE_CARDS } = await import('../src/engine/index.js');
    const { resolveRogueDie } = await import('../src/engine/rogue.js');
    for (const id of ['rothkel', 'artemis', 'zendica', 'hades', 'gamelyn'] as const) {
      for (let lvl = 1; lvl <= 5; lvl++) {
        const s = createInitialState({ seats: [{ name: 'You' }, { name: 'R', isRogue: true }], seed: 3, rogueCard: id });
        const r = s.players.find((p) => p.isRogue)!;
        r.empireLevel = lvl;
        // give the human something to lose / regress
        s.players[0].energy = 3; s.players[0].culture = 3;
        s.players[0].ships[0] = { kind: 'orbit', planetId: s.centerRow[0], level: 1 };
        expect(() => resolveRogueDie(s, 'colony')).not.toThrow();
      }
      expect(ROGUE_CARDS[id].name).toBeTruthy();
    }
  });

  it("ZENDICA's 'lose a die' drops one die from the human's next roll", async () => {
    const { resolveRogueDie } = await import('../src/engine/rogue.js');
    let s = createInitialState({ seats: [{ name: 'You' }, { name: 'Z', isRogue: true }], seed: 3, rogueCard: 'zendica' });
    const r = s.players.find((p) => p.isRogue)!;
    const h = s.players[0];
    r.empireLevel = 4; // ZENDICA L4 = "you lose a die next turn"
    resolveRogueDie(s, 'colony');
    expect(h.diceMalus).toBe(1);
    const normal = (await import('../src/engine/index.js')).empire(h.empireLevel).dice;
    s.turn.active = h.id;
    (await import('../src/engine/setup.js')).rollForActive(s);
    expect(s.turn.dice.length).toBe(normal - 1);
    expect(h.diceMalus).toBe(0); // consumed
  });

  it("Rogue MOVE A SHIP enters orbit of the leftmost planet without a Rogue ship", async () => {
    const { resolveRogueDie } = await import('../src/engine/rogue.js');
    let s = createInitialState({ seats: [{ name: 'You' }, { name: 'Rogue', isRogue: true }], seed: 5 });
    const r = s.players.find((p) => p.isRogue)!;
    r.ships = [{ kind: 'galaxy' }, { kind: 'galaxy' }, { kind: 'galaxy' }, { kind: 'galaxy' }];
    const leftmost = s.centerRow[0];
    resolveRogueDie(s, 'move');
    const orbiting = r.ships.find((sh) => sh.kind === 'orbit');
    expect(orbiting).toBeTruthy();
    expect((orbiting as { planetId: string }).planetId).toBe(leftmost);
    expect((orbiting as { level: number }).level).toBe(0);
    expect(r.ships.some((sh) => sh.kind === 'surface')).toBe(false);
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

  it('NAKAGAWAKOZI (cp27) does not offer or charge when unaffordable / no target', () => {
    const s = newGame(1);
    const p = s.players[0];
    p.energy = 0;
    p.ships[0] = { kind: 'orbit', planetId: s.centerRow[0], level: 0 };
    expect(planetOptions(s, p, 'cp27')).toHaveLength(0); // can't afford → not offered
    PLANET_EFFECTS['cp27'](s, p, {});
    expect(p.energy).toBe(0); // never charged
    // Affordable but no economy ship: must not charge.
    const s2 = newGame(1); const p2 = s2.players[0];
    p2.energy = 2; p2.ships = [{ kind: 'galaxy' }, { kind: 'galaxy' }, { kind: 'galaxy' }, { kind: 'galaxy' }];
    PLANET_EFFECTS['cp27'](s2, p2, {});
    expect(p2.energy).toBe(2);
  });

  it('LA-TORRES (cp20) only steals once per turn', () => {
    const s = newGame(1);
    const p = s.players[0]; s.players[1].energy = 5;
    expect(PLANET_EFFECTS['cp20'](s, p, {})).toMatch(/stole/);
    expect(PLANET_EFFECTS['cp20'](s, p, {})).toMatch(/already used/);
  });
});

describe('regress never knocks a ship off the orbit track', () => {
  it('a ship at the orbit start stays at the start (not returned home)', async () => {
    const { regressShip } = await import('../src/engine/helpers.js');
    const s = newGame(1);
    const p = s.players[0];
    p.ships[0] = { kind: 'orbit', planetId: 'cp13', level: 0 };
    regressShip(s, p, 0, 1);
    expect(p.ships[0]).toEqual({ kind: 'orbit', planetId: 'cp13', level: 0 });
    // Over-regress clamps to the start, still on the track.
    p.ships[1] = { kind: 'orbit', planetId: 'cp13', level: 2 };
    regressShip(s, p, 1, 5);
    expect(p.ships[1]).toEqual({ kind: 'orbit', planetId: 'cp13', level: 0 });
  });
});

describe('regress/reroll planets prompt for their targets', () => {
  it('BRUMBAUGH (cp40) prompts for which two enemy ships to regress', () => {
    let s = createInitialState({ seats: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 4 });
    const p = s.players[0]; p.energy = 5;
    s.players[1].ships[0] = { kind: 'orbit', planetId: s.centerRow[1], level: 2 };
    s.players[2].ships[0] = { kind: 'orbit', planetId: s.centerRow[2], level: 1 };
    s.centerRow[0] = 'cp40'; p.ships[0] = { kind: 'galaxy' };
    s.turn.dice = [{ id: 0, face: 'move', activated: false }] as any;
    s = tegAdapter.applyAction(s, { type: 'activateMove', dieId: 0, shipIdx: 0, dest: { kind: 'surface', planetId: 'cp40' } } as any, p.id);
    expect(s.turn.pendingChoice?.planetId).toBe('cp40');
    const pick = tegAdapter.legalActions(s, p.id).find((a) => a.type === 'resolvePlanet')!;
    s = tegAdapter.applyAction(s, pick, p.id);
    expect(s.players[1].ships[0].kind === 'orbit' ? (s.players[1].ships[0] as any).level : -1).toBe(1);
    expect(s.players[2].ships[0].kind === 'orbit' ? (s.players[2].ships[0] as any).level : -1).toBe(0);
    expect(s.players[0].energy).toBe(3);
  });

  it('MAIA (cp5) prompts for which two inactive dice to discard', () => {
    let s = newGame(1);
    const p = s.players[0];
    p.energy = 5; p.culture = 5;
    s.centerRow[0] = 'cp5'; p.ships[0] = { kind: 'galaxy' };
    s.turn.dice = [
      { id: 0, face: 'move', activated: false },
      { id: 1, face: 'energy', activated: false },
      { id: 2, face: 'culture', activated: false },
      { id: 3, face: 'diplomacy', activated: false },
    ] as any;
    s = tegAdapter.applyAction(s, { type: 'activateMove', dieId: 0, shipIdx: 0, dest: { kind: 'surface', planetId: 'cp5' } } as any, p.id);
    // Must pause for the player's choice — not auto-discard the first two dice.
    expect(s.turn.pendingChoice?.planetId).toBe('cp5');
    expect(s.turn.dice.filter((d: any) => d.inConverter).length).toBe(0);
    // Choose to spend the energy(1) + diplomacy(3) dice, sparing culture(2).
    const pick = tegAdapter.legalActions(s, p.id).find(
      (a) => a.type === 'resolvePlanet' && (a as any).choice.dieIds?.includes(1) && (a as any).choice.dieIds?.includes(3))!;
    s = tegAdapter.applyAction(s, pick, p.id);
    const discarded = s.turn.dice.filter((d: any) => d.inConverter).map((d: any) => d.id).sort();
    expect(discarded).toEqual([1, 3]);
    expect(s.players[0].energy).toBe(7);
    expect(s.players[0].culture).toBe(7);
    expect(s.turn.pendingChoice).toBeNull();
  });

  it('ZALAX (cp25) prompts per die and excludes already-rerolled dice', () => {
    let s = newGame(4);
    const p = s.players[0];
    s.centerRow[0] = 'cp25'; p.ships[0] = { kind: 'galaxy' };
    s.turn.dice = [{ id: 0, face: 'move', activated: false }, { id: 1, face: 'energy', activated: false }, { id: 2, face: 'culture', activated: false }] as any;
    s = tegAdapter.applyAction(s, { type: 'activateMove', dieId: 0, shipIdx: 0, dest: { kind: 'surface', planetId: 'cp25' } } as any, p.id);
    expect(s.turn.pendingChoice?.planetId).toBe('cp25');
    const r1 = tegAdapter.legalActions(s, p.id).find((a) => a.type === 'resolvePlanet' && (a as any).choice.dieIds[0] === 1)!;
    s = tegAdapter.applyAction(s, r1, p.id);
    // Still prompting, die 1 excluded, only die 2 offered.
    const remaining = tegAdapter.legalActions(s, p.id).filter((a) => a.type === 'resolvePlanet').map((a) => (a as any).choice.dieIds[0]);
    expect(remaining).toEqual([2]);
    s = tegAdapter.applyAction(s, { type: 'skipPlanet' } as any, p.id);
    expect(s.turn.pendingChoice).toBeNull();
  });
});

describe('win is detected when a FOLLOW colonizes the winning planet', () => {
  it('ends the solo game immediately on a colonizing follow', async () => {
    const { PLANETS_BY_ID, baseVp } = await import('../src/engine/index.js');
    let s = createInitialState({ seats: [{ name: 'You' }, { name: 'Rogue', isRogue: true }], seed: 3 });
    const me = s.players[0];
    const eco = s.centerRow.find((id) => PLANETS_BY_ID[id].colonizeType === 'economy')!;
    const pl = PLANETS_BY_ID[eco];
    me.ships = [{ kind: 'orbit', planetId: eco, level: pl.orbitTrackLength }, { kind: 'galaxy' }, { kind: 'galaxy' }, { kind: 'galaxy' }];
    me.culture = 5; me.empireLevel = 6; me.colonized = ['cp14', 'cp8', 'cp23'];
    expect(baseVp(s, me)).toBeGreaterThanOrEqual(21);
    expect(s.phase).toBe('playing'); // not yet detected — win is only checked on an action
    s.turn.pendingFollow = { face: 'economy', queue: [me.id], sourcePlayer: s.players[1].id } as any;
    s.turn.active = s.players[1].id;
    s = tegAdapter.applyAction(s, { type: 'follow', accept: true, params: { shipIdx: 0, advance: 'economy' } } as any, me.id);
    expect(s.phase).toBe('gameOver');
    expect(s.winners).toEqual([me.id]);
  });
});

describe('NAGATO (cp21) moves two ships', () => {
  it('pays 1 culture, prompts for two moves, and interleaves a landed surface choice', () => {
    let s = createInitialState({ seats: [{ name: 'A' }, { name: 'B' }], seed: 6 });
    const p = s.players[0];
    p.culture = 3;
    s.centerRow[0] = 'cp14'; // SHOUHUA (surface action) for the chaining test
    s.centerRow[1] = 'cp21'; // NAGATO
    p.ships = [{ kind: 'galaxy' }, { kind: 'orbit', planetId: s.centerRow[2], level: 1 }, { kind: 'galaxy' }, { kind: 'galaxy' }];
    s.turn.dice = [{ id: 0, face: 'move', activated: false }] as any;
    s = tegAdapter.applyAction(s, { type: 'activateMove', dieId: 0, shipIdx: 0, dest: { kind: 'surface', planetId: 'cp21' } } as any, p.id);
    expect(s.players[0].culture).toBe(2); // paid 1
    expect(s.turn.pendingMoves?.left).toBe(2);
    // Move one ship onto SHOUHUA's surface — its action must prompt before move #2.
    const mv = tegAdapter.legalActions(s, p.id).find((a) => a.type === 'nagatoMove' && (a as any).dest.kind === 'surface' && (a as any).dest.planetId === 'cp14')!;
    s = tegAdapter.applyAction(s, mv, p.id);
    expect(s.turn.pendingChoice?.planetId).toBe('cp14');
    expect(s.turn.pendingMoves?.left).toBe(1);
    // Resolve SHOUHUA, then the remaining NAGATO move resumes.
    const sa = tegAdapter.legalActions(s, p.id).find((a) => a.type === 'resolvePlanet') ?? { type: 'skipPlanet' as const };
    s = tegAdapter.applyAction(s, sa as any, p.id);
    expect(s.turn.pendingChoice).toBeNull();
    expect(s.turn.pendingMoves?.left).toBe(1);
    expect(tegAdapter.currentActor(s)).toBe(p.id);
    s = tegAdapter.applyAction(s, { type: 'endMoves' } as any, p.id);
    expect(s.turn.pendingMoves).toBeNull();
  });

  it('is once per turn and needs 1 culture', () => {
    let s = createInitialState({ seats: [{ name: 'A' }, { name: 'B' }], seed: 6 });
    const p = s.players[0];
    p.culture = 0;
    s.centerRow[0] = 'cp21';
    p.ships = [{ kind: 'galaxy' }, { kind: 'galaxy' }, { kind: 'galaxy' }, { kind: 'galaxy' }];
    s.turn.dice = [{ id: 0, face: 'move', activated: false }] as any;
    s = tegAdapter.applyAction(s, { type: 'activateMove', dieId: 0, shipIdx: 0, dest: { kind: 'surface', planetId: 'cp21' } } as any, p.id);
    expect(s.turn.pendingMoves).toBeNull(); // couldn't afford → no moves queued
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
