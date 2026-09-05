import { PLANETS_BY_ID, acquireCount, type Action, type PlayerState, type ShipLocation } from '../engine/index.js';

function locLabel(l: ShipLocation): string {
  switch (l.kind) {
    case 'galaxy': return 'home galaxy';
    case 'locked': return 'locked';
    case 'surface': return `${PLANETS_BY_ID[l.planetId]?.name ?? l.planetId} (surface)`;
    case 'orbit': return `${PLANETS_BY_ID[l.planetId]?.name ?? l.planetId} ${l.level === 0 ? 'orbit (start)' : `orbit ${l.level}`}`;
  }
}

/** Short description of where one of the acting player's ships currently sits. */
function shipWhere(ships: ShipLocation[] | undefined, idx: number): string {
  const s = ships?.[idx];
  if (!s) return `#${idx + 1}`;
  switch (s.kind) {
    case 'galaxy': return `#${idx + 1}, home`;
    case 'locked': return `#${idx + 1}, locked`;
    case 'surface': return `#${idx + 1}, on ${PLANETS_BY_ID[s.planetId]?.name ?? s.planetId}`;
    case 'orbit': return `#${idx + 1}, orbiting ${PLANETS_BY_ID[s.planetId]?.name ?? s.planetId}${s.level === 0 ? ' (start)' : ` ${s.level}`}`;
  }
}

/** Human-readable label for a legal action button. `ships` = the acting player's ships. */
export function actionLabel(a: Action, ships?: ShipLocation[], actor?: PlayerState): string {
  const ship = (i: number) => shipWhere(ships, i);
  switch (a.type) {
    case 'activateMove':
      return `Move ship (${ship(a.shipIdx)}) → ${locLabel(a.dest)}`;
    case 'activateAcquire':
      // Show the projected yield so a "+0" (no matching producers) is never a surprise.
      return actor ? `Acquire ${a.resource} (+${acquireCount(actor, a.resource)})` : `Acquire ${a.resource}`;
    case 'activateAdvance':
      return `Advance ship (${ship(a.shipIdx)}) — ${a.advance}`;
    case 'activateColonyGalaxy':
      return `Upgrade empire (pay ${a.pay})`;
    case 'activateColonyPlanet':
      return `Use colony: ${PLANETS_BY_ID[a.planetId]?.name ?? a.planetId}`;
    case 'convert':
      return `Converter → set a die to ${a.face}`;
    case 'reroll':
      return `Reroll ${a.dieIds.length} inactive dice (${a.free ? 'free' : '1 energy'})`;
    case 'follow': {
      // No "Follow — " prefix and no "(pay 1 culture)" suffix: the follow-
      // choices card these render in is already headed and bordered as a
      // follow decision, and its cost is shown once in the header (see
      // Board's FollowHeader) — repeating either on every button is exactly
      // the extra width that was pushing 2-3 short choices onto separate rows.
      if (!a.accept) return 'Decline';
      const p = a.params ?? {};
      // Upgrade-empire follows come in two flavours — pay with energy or with
      // culture; only the affordable one(s) are ever legal (see legalFollows
      // in adapter.ts), so whichever shows up here is a real option.
      if (p.pay) return `Upgrade empire — pay ${p.pay}`;
      if (p.resource) return `Acquire ${p.resource}`;
      if (p.dest != null && p.shipIdx != null) return `Move ship (${ship(p.shipIdx)}) → ${locLabel(p.dest)}`;
      if (p.advance != null && p.shipIdx != null) return `Advance ship (${ship(p.shipIdx)}) — ${p.advance}`;
      // What the colony's power actually does is the decision-relevant part —
      // which planet it happens to be printed on is not, so show the power
      // itself (the planet's name is still in the tooltip, see actionTooltip).
      if (p.planetId) return PLANETS_BY_ID[p.planetId]?.action ?? `Use colony ${p.planetId}`;
      return 'Copy action';
    }
    case 'resolvePlanet':
      return a.label ?? 'Choose this target';
    case 'skipPlanet':
      return 'Skip (take no target)';
    case 'nagatoMove':
      return a.label ?? `Move ship (${ship(a.shipIdx)}) → ${locLabel(a.dest)}`;
    case 'endMoves':
      return 'Done moving';
    case 'rogueResolveDie':
      return 'Rogue acts'; // engine-driven; never shown to a human
    case 'endTurn':
      return 'End turn';
  }
}

/** Tooltip text (the planet's ability) for actions that reference a planet. */
export function actionTooltip(a: Action): string | undefined {
  let pid: string | undefined;
  switch (a.type) {
    case 'activateColonyPlanet': pid = a.planetId; break;
    case 'activateMove': pid = a.dest.kind === 'surface' ? a.dest.planetId : undefined; break;
    case 'resolvePlanet': pid = a.choice.planetId; break;
    case 'follow': pid = a.params?.planetId; break;
  }
  if (!pid) return undefined;
  const p = PLANETS_BY_ID[pid];
  return p ? `${p.name}: ${p.action}` : undefined;
}

/** Which die an action consumes (for grouping under dice), or null. */
export function actionDieId(a: Action): number | null {
  switch (a.type) {
    case 'activateMove':
    case 'activateAcquire':
    case 'activateAdvance':
    case 'activateColonyGalaxy':
    case 'activateColonyPlanet':
      return a.dieId;
    default:
      return null;
  }
}
