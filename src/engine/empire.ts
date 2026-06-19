// Empire-level track configuration.
//
// Per the official rules, a player starts at the star space with 4 dice and 2
// ships, and each upgrade adds either a die or a ship, alternating (die first),
// up to the component caps of 7 dice and 4 ships. Victory-point values per level
// are read from the Galaxy Mat's inner "victory points" arc.

export interface EmpireLevel {
  level: number;
  dice: number;
  ships: number;
  vp: number;
  /** Resources required to upgrade INTO this level (all energy or all culture). */
  upgradeCost: number;
}

// 6 empire levels. Start at level 1 (4 dice / 2 ships) and each upgrade adds a
// die OR a ship, alternating, reaching the 7-dice / 4-ship caps at level 6 — the
// maximum. VP-per-level is read from the mat's inner "victory points" arc.
export const EMPIRE_TRACK: EmpireLevel[] = [
  { level: 1, dice: 4, ships: 2, vp: 1, upgradeCost: 0 },
  { level: 2, dice: 5, ships: 2, vp: 2, upgradeCost: 2 },
  { level: 3, dice: 5, ships: 3, vp: 3, upgradeCost: 3 },
  { level: 4, dice: 6, ships: 3, vp: 5, upgradeCost: 4 },
  { level: 5, dice: 6, ships: 4, vp: 6, upgradeCost: 5 },
  { level: 6, dice: 7, ships: 4, vp: 8, upgradeCost: 6 },
];

export const MAX_EMPIRE = 6;
export const RESOURCE_MAX = 7;
export const WIN_VP = 21;
export const SHIP_COUNT = 4;

export function empire(level: number): EmpireLevel {
  return EMPIRE_TRACK[Math.min(Math.max(level, 1), MAX_EMPIRE) - 1];
}
