import type { SecretMission } from './types.js';

// 12 secret-mission cards transcribed from the VASSAL module.
export const MISSIONS: SecretMission[] = [
  { id: 'm_seeker', name: 'SEEKER', objective: 'Gain 3 if you have the most culture at the end of the game (tied: gain 2).', bonusVp: 3 },
  { id: 'm_equalizer', name: 'EQUALIZER', objective: 'Gain 3 if you have an equal number of economy and diplomacy planets.', bonusVp: 3 },
  { id: 'm_elder', name: 'ELDER', objective: 'Gain 2 if you trigger the end of the game.', bonusVp: 2 },
  { id: 'm_conqueror', name: 'CONQUEROR', objective: 'Gain 3 if you have the most planets (tied: gain 2).', bonusVp: 3 },
  { id: 'm_hermit', name: 'HERMIT', objective: 'Gain 3 if you have the fewest planets (tied: gain 2).', bonusVp: 3 },
  { id: 'm_hoarder', name: 'HOARDER', objective: 'Gain 2 if you have at least 3 energy and 3 culture.', bonusVp: 2 },
  { id: 'm_industrialist', name: 'INDUSTRIALIST', objective: 'Gain 2 if you have completed your empire track (level 6).', bonusVp: 2 },
  { id: 'm_orbiter', name: 'ORBITER', objective: 'Gain 2 if all of your ships are on your Galaxy Mat.', bonusVp: 2 },
  { id: 'm_noble', name: 'NOBLE', objective: 'Gain 3 if you have the most diplomacy planets (tied: gain 2).', bonusVp: 3 },
  { id: 'm_explorer', name: 'EXPLORER', objective: 'Gain 2 if none of your ships are on your Galaxy Mat.', bonusVp: 2 },
  { id: 'm_charger', name: 'CHARGER', objective: 'Gain 3 if you have the most energy at the end of the game (tied: gain 2).', bonusVp: 3 },
  { id: 'm_trader', name: 'TRADER', objective: 'Gain 3 if you have the most economy planets (tied: gain 2).', bonusVp: 3 },
];

export const MISSIONS_BY_ID: Record<string, SecretMission> = Object.fromEntries(
  MISSIONS.map((m) => [m.id, m]),
);
