import React from 'react';
import type { Color, GameState, Planet, PlayerState } from '../engine/index.js';

// ---- Calibrated overlay positions (percentages of the underlying image) ----

// Empire-upgrade track: the hexagon arc on the FAR RIGHT of the Galaxy Mat
// (★ at the bottom climbing up), calibrated on the BLUE mat. Levels 1..6.
const EMPIRE_POS: Record<number, { x: number; y: number }> = {
  1: { x: 53, y: 72 }, // ★ start
  2: { x: 61, y: 58 },
  3: { x: 66, y: 44 },
  4: { x: 68, y: 32 },
  5: { x: 67, y: 22 },
  6: { x: 66, y: 7 }, // max level
};
// Centre of the galaxy swirl on the mat — where standing (home) ships sit.
const GALAXY_CENTER = { x: 21, y: 37 };

// The 5 mat scans are translated/scaled differently, so blue-space coordinates
// don't line up on the others. We map every blue anchor through a per-mat
// similarity transform derived from two measured reference points: the level-1
// (★) and level-6 hexagon centres on each mat.
type Pt = { x: number; y: number };
const BLUE_REF = { p1: EMPIRE_POS[1], p6: EMPIRE_POS[6] };
const MAT_REF: Record<Color, { p1: Pt; p6: Pt }> = {
  blue: BLUE_REF,
  green: { p1: { x: 52, y: 73 }, p6: { x: 64, y: 8 } },
  red: { p1: { x: 50, y: 70 }, p6: { x: 60, y: 7 } },
  yellow: { p1: { x: 53, y: 75 }, p6: { x: 63, y: 7 } },
  black: { p1: { x: 52, y: 73 }, p6: { x: 63, y: 7 } },
};

/** Build the blue→color transform (translation + rotation + uniform scale). */
function matTransform(color: Color): (p: Pt) => Pt {
  const ref = MAT_REF[color] ?? BLUE_REF;
  const A1 = BLUE_REF.p1, A2 = BLUE_REF.p6, B1 = ref.p1, B2 = ref.p6;
  const dAx = A2.x - A1.x, dAy = A2.y - A1.y;
  const dBx = B2.x - B1.x, dBy = B2.y - B1.y;
  const denom = dAx * dAx + dAy * dAy || 1;
  const mr = (dBx * dAx + dBy * dAy) / denom; // real part of dB/dA
  const mi = (dBy * dAx - dBx * dAy) / denom; // imag part
  return (p) => {
    const px = p.x - A1.x, py = p.y - A1.y;
    return { x: B1.x + (mr * px - mi * py), y: B1.y + (mi * px + mr * py) };
  };
}

// Calibrated orbit-track positions per track length (percent of card), read off
// the real card art (VIZCARRA/LEANDRA/JORG/SARGUS/GYORE). Index 0 is the START
// arrow (where a ship enters), then spaces 1..N toward the colonize badge.
const ORBIT_POS: Record<number, { x: number; y: number }[]> = {
  1: [{ x: 24, y: 50 }, { x: 45, y: 57 }],
  2: [{ x: 20, y: 40 }, { x: 30, y: 50 }, { x: 46, y: 60 }],
  3: [{ x: 20, y: 20 }, { x: 24, y: 35 }, { x: 29, y: 52 }, { x: 46, y: 62 }],
  4: [{ x: 32, y: 11 }, { x: 22, y: 22 }, { x: 21, y: 38 }, { x: 29, y: 53 }, { x: 44, y: 61 }],
  5: [{ x: 39, y: 10 }, { x: 28, y: 16 }, { x: 18, y: 30 }, { x: 16, y: 46 }, { x: 23, y: 61 }, { x: 38, y: 67 }],
};

/** Position of an orbit-track space on a planet card (percent of card). `level` 0 = start. */
function orbitPos(level: number, trackLength: number): { x: number; y: number } {
  const table = ORBIT_POS[trackLength] ?? ORBIT_POS[5];
  const idx = Math.min(Math.max(level, 0), table.length - 1);
  return table[idx];
}

function rocket(color: string) {
  return `/ships/${color}-rocket.png`;
}

// ---- Galaxy-mat overlay: empire token + home ships ----

export function MatTokens({ p }: { p: PlayerState }) {
  const homeShips = p.ships.filter((s) => s.kind === 'galaxy').length;
  const lockedShips = p.ships.filter((s) => s.kind === 'locked').length;
  const tf = matTransform(p.color);
  const ep = tf(EMPIRE_POS[p.empireLevel] ?? EMPIRE_POS[1]);
  return (
    <div className="token-layer">
      {/* Empire level token on the hexagon track */}
      <img
        className="tok empire-tok"
        src={`/ships/${p.color}-level.png`}
        alt={`empire level ${p.empireLevel}`}
        style={{ left: `${ep.x}%`, top: `${ep.y}%` }}
        title={`Empire level ${p.empireLevel}`}
      />
      {/* Standing ships on the home galaxy */}
      {Array.from({ length: homeShips }).map((_, i) => {
        const q = tf({ x: GALAXY_CENTER.x + (i - (homeShips - 1) / 2) * 7, y: GALAXY_CENTER.y });
        return (
          <img
            key={`h${i}`}
            className="tok ship-tok standing"
            src={rocket(p.color)}
            alt="home ship"
            style={{ left: `${q.x}%`, top: `${q.y}%` }}
            title="Ship on your Galaxy Mat"
          />
        );
      })}
      {/* Locked (not yet unlocked) ships parked dim at the ship track */}
      {Array.from({ length: lockedShips }).map((_, i) => {
        const q = tf({ x: 72 + i * 6, y: 92 });
        return (
          <img
            key={`l${i}`}
            className="tok ship-tok locked"
            src={rocket(p.color)}
            alt="locked ship"
            style={{ left: `${q.x}%`, top: `${q.y}%` }}
            title="Locked — unlock by upgrading your empire"
          />
        );
      })}
    </div>
  );
}

// ---- Planet-card overlay: surface ship + orbiting ships ----

export function PlanetTokens({ planet, state }: { planet: Planet; state: GameState }) {
  const tokens: React.ReactNode[] = [];
  for (const pl of state.players) {
    pl.ships.forEach((s, idx) => {
      if (s.kind === 'surface' && s.planetId === planet.id) {
        tokens.push(
          <img
            key={`${pl.id}-s${idx}`}
            className="tok ship-tok standing on-card"
            src={rocket(pl.color)}
            alt={`${pl.name} on surface`}
            style={{ left: '50%', top: '40%' }}
            title={`${pl.name}: landed on the surface`}
          />,
        );
      }
      if (s.kind === 'orbit' && s.planetId === planet.id) {
        const pos = orbitPos(s.level, planet.orbitTrackLength);
        tokens.push(
          <img
            key={`${pl.id}-o${idx}`}
            className="tok ship-tok orbit on-card"
            src={rocket(pl.color)}
            alt={`${pl.name} orbiting`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={`${pl.name}: ${s.level === 0 ? 'orbit start' : `orbit space ${s.level} / ${planet.orbitTrackLength}`}`}
          />,
        );
      }
    });
  }
  return <div className="token-layer">{tokens}</div>;
}
