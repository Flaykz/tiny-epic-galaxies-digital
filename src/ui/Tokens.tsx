import React from 'react';
import type { GameState, Planet, PlayerState } from '../engine/index.js';

// ---- Calibrated overlay positions (percentages of the underlying image) ----

// Empire-upgrade track: the hexagon arc on the FAR RIGHT of the Galaxy Mat
// (★ at the bottom climbing up). Levels 1..7. The left spiral is the resource
// track and is not where the empire token belongs.
const EMPIRE_POS: Record<number, { x: number; y: number }> = {
  1: { x: 54, y: 73 }, // ★ start
  2: { x: 60, y: 60 },
  3: { x: 63, y: 46 },
  4: { x: 65, y: 32 },
  5: { x: 64, y: 19 },
  6: { x: 60, y: 8 }, // max level
};
// Centre of the galaxy swirl on the mat — where standing (home) ships sit.
const GALAXY_CENTER = { x: 21, y: 37 };

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
  const ep = EMPIRE_POS[p.empireLevel] ?? EMPIRE_POS[1];
  return (
    <div className="token-layer">
      {/* Empire level token on the spiral */}
      <img
        className="tok empire-tok"
        src={`/ships/${p.color}-level.png`}
        alt={`empire level ${p.empireLevel}`}
        style={{ left: `${ep.x}%`, top: `${ep.y}%` }}
        title={`Empire level ${p.empireLevel}`}
      />
      {/* Standing ships on the home galaxy */}
      {Array.from({ length: homeShips }).map((_, i) => (
        <img
          key={`h${i}`}
          className="tok ship-tok standing"
          src={rocket(p.color)}
          alt="home ship"
          style={{ left: `${GALAXY_CENTER.x + (i - (homeShips - 1) / 2) * 7}%`, top: `${GALAXY_CENTER.y}%` }}
          title="Ship on your Galaxy Mat"
        />
      ))}
      {/* Locked (not yet unlocked) ships parked dim at the ship track */}
      {Array.from({ length: lockedShips }).map((_, i) => (
        <img
          key={`l${i}`}
          className="tok ship-tok locked"
          src={rocket(p.color)}
          alt="locked ship"
          style={{ left: `${72 + i * 6}%`, top: `92%` }}
          title="Locked — unlock by upgrading your empire"
        />
      ))}
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
