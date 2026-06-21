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
      if (!a.accept) return 'Decline follow';
      const p = a.params ?? {};
      let what = 'copy action';
      if (p.resource) what = `acquire ${p.resource}`;
      else if (p.dest != null && p.shipIdx != null) what = `move ship (${ship(p.shipIdx)}) → ${locLabel(p.dest)}`;
      else if (p.advance != null && p.shipIdx != null) what = `advance ship (${ship(p.shipIdx)}) — ${p.advance}`;
      else if (p.pay) what = `upgrade empire (pay ${p.pay})`;
      else if (p.planetId) what = `use colony ${PLANETS_BY_ID[p.planetId]?.name ?? p.planetId}`;
      return `Follow — ${what} (pay 1 culture)`;
    }
    case 'resolvePlanet':
      return a.label ?? 'Choose this target';
    case 'skipPlanet':
      return 'Skip (take no target)';
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
