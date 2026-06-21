import React from 'react';
import type { Color, GameState, Planet, PlayerState } from '../engine/index.js';
import { useAsset } from '../client/assets.js';

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
  green: { p1: { x: 49, y: 71 }, p6: { x: 61, y: 6 } },
  red: { p1: { x: 47, y: 68 }, p6: { x: 57, y: 5 } },
  yellow: { p1: { x: 50, y: 73 }, p6: { x: 60, y: 5 } },
  black: { p1: { x: 49, y: 71 }, p6: { x: 60, y: 5 } },
};

// Empire-token positions per color, measured directly per level (the hex arc
// curves differently on each mat scan, so a single transform can't fit them).
// Index 0..5 = empire levels 1..6.
const EMPIRE_BY_COLOR: Record<Color, Pt[]> = {
  blue: [EMPIRE_POS[1], EMPIRE_POS[2], EMPIRE_POS[3], EMPIRE_POS[4], EMPIRE_POS[5], EMPIRE_POS[6]],
  green: [{ x: 46, y: 68 }, { x: 63, y: 52 }, { x: 65, y: 40 }, { x: 67, y: 28 }, { x: 65, y: 15 }, { x: 59, y: 6 }],
  red: [{ x: 46, y: 68 }, { x: 58, y: 52 }, { x: 64, y: 40 }, { x: 66, y: 28 }, { x: 64, y: 15 }, { x: 60, y: 5 }],
  yellow: [{ x: 48, y: 71 }, { x: 61, y: 54 }, { x: 66, y: 42 }, { x: 68, y: 29 }, { x: 66, y: 16 }, { x: 64, y: 5 }],
  black: [{ x: 47, y: 68 }, { x: 59, y: 52 }, { x: 65, y: 40 }, { x: 67, y: 28 }, { x: 66, y: 15 }, { x: 61, y: 5 }],
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

/** A positioned ship token plus a small number badge (its ship #). */
function Piece({ src, x, y, n, cls, title }: { src: string; x: number; y: number; n: number; cls: string; title: string }) {
  return (
    <>
      <img className={`tok ship-tok ${cls}`} src={src} alt="" style={{ left: `${x}%`, top: `${y}%` }} title={title} />
      <span className={`tok-num ${cls}`} style={{ left: `${x}%`, top: `${y}%` }}>{n}</span>
    </>
  );
}

export function MatTokens({ p }: { p: PlayerState }) {
  const asset = useAsset();
  const tf = matTransform(p.color);
  const galaxyIdx: number[] = [];
  const lockedIdx: number[] = [];
  p.ships.forEach((s, i) => {
    if (s.kind === 'galaxy') galaxyIdx.push(i);
    else if (s.kind === 'locked') lockedIdx.push(i);
  });
  // Empire token uses the directly-measured per-color position (not the transform).
  const empTable = EMPIRE_BY_COLOR[p.color] ?? EMPIRE_BY_COLOR.blue;
  const ep = empTable[Math.min(Math.max(p.empireLevel - 1, 0), empTable.length - 1)];
  return (
    <div className="token-layer">
      {/* Empire level token on the hexagon track */}
      <img
        className="tok empire-tok"
        src={asset(`/ships/${p.color}-level.png`)}
        alt={`empire level ${p.empireLevel}`}
        style={{ left: `${ep.x}%`, top: `${ep.y}%` }}
        title={`Empire level ${p.empireLevel}`}
      />
      {/* Standing ships on the home galaxy, labelled with their ship number */}
      {galaxyIdx.map((shipI, k) => {
        const q = tf({ x: GALAXY_CENTER.x + (k - (galaxyIdx.length - 1) / 2) * 7, y: GALAXY_CENTER.y });
        return <Piece key={`h${shipI}`} src={asset(rocket(p.color))} x={q.x} y={q.y} n={shipI + 1} cls="standing" title={`Ship #${shipI + 1} — on your Galaxy Mat`} />;
      })}
      {/* Locked (not yet unlocked) ships parked dim at the ship track */}
      {lockedIdx.map((shipI, k) => {
        const q = tf({ x: 72 + k * 6, y: 92 });
        return <Piece key={`l${shipI}`} src={asset(rocket(p.color))} x={q.x} y={q.y} n={shipI + 1} cls="locked" title={`Ship #${shipI + 1} — locked (upgrade to unlock)`} />;
      })}
    </div>
  );
}

// ---- Planet-card overlay: surface ship + orbiting ships ----

export function PlanetTokens({ planet, state }: { planet: Planet; state: GameState }) {
  const asset = useAsset();
  const tokens: React.ReactNode[] = [];

  // Different players can share a surface (rulebook p.5), so spread the surface
  // ships horizontally instead of stacking them on the same spot.
  const surfaceShips = state.players.flatMap((pl) =>
    pl.ships.map((s, idx) => ({ pl, s, idx }))
      .filter((x) => x.s.kind === 'surface' && (x.s as { planetId: string }).planetId === planet.id),
  );
  surfaceShips.forEach(({ pl, idx }, k) => {
    const x = 50 + (k - (surfaceShips.length - 1) / 2) * 16;
    tokens.push(
      <span key={`${pl.id}-s${idx}`}>
        <img
          className="tok ship-tok standing on-card"
          src={asset(rocket(pl.color))}
          alt={`${pl.name} ship #${idx + 1} on surface`}
          style={{ left: `${x}%`, top: '40%' }}
          title={`${pl.name} — ship #${idx + 1} landed on the surface`}
        />
        <span className="tok-num standing" style={{ left: `${x}%`, top: '40%' }}>{idx + 1}</span>
      </span>,
    );
  });

  for (const pl of state.players) {
    pl.ships.forEach((s, idx) => {
      if (s.kind === 'orbit' && s.planetId === planet.id) {
        const pos = orbitPos(s.level, planet.orbitTrackLength);
        tokens.push(
          <span key={`${pl.id}-o${idx}`}>
            <img
              className="tok ship-tok orbit on-card"
              src={asset(rocket(pl.color))}
              alt={`${pl.name} ship #${idx + 1} orbiting`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              title={`${pl.name} — ship #${idx + 1}: ${s.level === 0 ? 'orbit start' : `space ${s.level} / ${planet.orbitTrackLength}`}`}
            />
            {/* Ship number so it matches the "ship #N" choice buttons. */}
            <span className="tok-num" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>{idx + 1}</span>
          </span>,
        );
      }
    });
  }
  return <div className="token-layer">{tokens}</div>;
}
