export const GRID_COLUMNS = 12;
export const GRID_ROWS = 12;

export type RegionId = 'topbar' | 'players' | 'planets' | 'dice' | 'actions' | 'footer';
export type PresetId = 'phone-portrait' | 'phone-landscape' | 'tablet-portrait' | 'desktop';

export interface LayoutRegion {
  id: RegionId;
  label: string;
  hint: string;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
  minColumns: number;
  minRows: number;
}

export interface ViewportPreset {
  id: PresetId;
  label: string;
  width: number;
  height: number;
}

export type LayoutsByPreset = Record<PresetId, LayoutRegion[]>;
export type CssByPreset = Record<PresetId, string>;

export interface LayoutExport {
  version?: number;
  layouts: LayoutsByPreset;
  css?: CssByPreset;
}

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: 'phone-portrait', label: 'Phone · portrait', width: 390, height: 844 },
  { id: 'phone-landscape', label: 'Phone · landscape', width: 844, height: 390 },
  { id: 'tablet-portrait', label: 'Tablet · portrait', width: 820, height: 1180 },
  { id: 'desktop', label: 'Desktop', width: 1180, height: 820 },
];

const PHONE_PORTRAIT_LAYOUT: LayoutRegion[] = [
  region('topbar', 'Turn & tools', 'Current turn, fullscreen and reset', 1, 12, 6, 1, 4, 1),
  region('players', 'Players', 'Your galaxy and opponent status', 1, 1, 12, 2, 5, 1),
  region('planets', 'Discovered planets', 'All legal destinations stay visible', 1, 3, 12, 5, 6, 2),
  region('dice', 'Command dice', 'Rolled dice and conversion controls', 1, 8, 6, 4, 5, 1),
  region('actions', 'Actions', 'Contextual choices for the selected die', 7, 8, 6, 4, 5, 1),
  region('footer', 'Game utilities', 'Log and problem report', 7, 12, 6, 1, 4, 1),
];

const PHONE_LANDSCAPE_LAYOUT: LayoutRegion[] = [
  region('topbar', 'Turn & tools', 'Current turn, fullscreen and reset', 7, 12, 6, 1, 4, 1),
  region('players', 'Players', 'Your galaxy and opponent status', 1, 1, 3, 11, 2, 3),
  region('planets', 'Discovered planets', 'All legal destinations stay visible', 4, 1, 5, 11, 5, 3),
  region('dice', 'Command dice', 'Rolled dice and conversion controls', 9, 1, 4, 4, 3, 2),
  region('actions', 'Actions', 'Contextual choices for the selected die', 9, 5, 4, 7, 3, 2),
  region('footer', 'Game utilities', 'Log and problem report', 1, 12, 6, 1, 4, 1),
];

const TABLET_PORTRAIT_LAYOUT: LayoutRegion[] = [
  region('topbar', 'Turn & tools', 'Current turn, fullscreen and reset', 7, 12, 6, 1, 4, 1),
  region('players', 'Players', 'Your galaxy and opponent status', 1, 1, 6, 2, 5, 1),
  region('planets', 'Discovered planets', 'All legal destinations stay visible', 1, 3, 12, 6, 6, 2),
  region('dice', 'Command dice', 'Rolled dice and conversion controls', 7, 1, 6, 2, 5, 1),
  region('actions', 'Actions', 'Contextual choices for the selected die', 1, 9, 12, 3, 5, 1),
  region('footer', 'Game utilities', 'Log and problem report', 1, 12, 6, 1, 4, 1),
];

const DESKTOP_LAYOUT: LayoutRegion[] = [
  region('topbar', 'Turn & tools', 'Current turn, fullscreen and reset', 1, 11, 6, 2, 4, 1),
  region('players', 'Players', 'Your galaxy and opponent status', 1, 4, 3, 7, 2, 3),
  region('planets', 'Discovered planets', 'All legal destinations stay visible', 4, 4, 9, 7, 5, 3),
  region('dice', 'Command dice', 'Rolled dice and conversion controls', 1, 1, 6, 3, 3, 2),
  region('actions', 'Actions', 'Contextual choices for the selected die', 7, 1, 6, 3, 3, 2),
  region('footer', 'Game utilities', 'Log and problem report', 7, 11, 6, 2, 4, 1),
];

export const DEFAULT_LAYOUTS: LayoutsByPreset = {
  'phone-portrait': cloneLayout(PHONE_PORTRAIT_LAYOUT),
  'phone-landscape': cloneLayout(PHONE_LANDSCAPE_LAYOUT),
  'tablet-portrait': cloneLayout(TABLET_PORTRAIT_LAYOUT),
  desktop: cloneLayout(DESKTOP_LAYOUT),
};

function region(
  id: RegionId,
  label: string,
  hint: string,
  column: number,
  row: number,
  columnSpan: number,
  rowSpan: number,
  minColumns: number,
  minRows: number,
): LayoutRegion {
  return { id, label, hint, column, row, columnSpan, rowSpan, minColumns, minRows };
}

export function cloneLayout(layout: LayoutRegion[]): LayoutRegion[] {
  return layout.map((item) => ({ ...item }));
}

export function cloneLayouts(layouts: LayoutsByPreset): LayoutsByPreset {
  return {
    'phone-portrait': cloneLayout(layouts['phone-portrait']),
    'phone-landscape': cloneLayout(layouts['phone-landscape']),
    'tablet-portrait': cloneLayout(layouts['tablet-portrait']),
    desktop: cloneLayout(layouts.desktop),
  };
}

export function clampRegion(region: LayoutRegion): LayoutRegion {
  const columnSpan = clamp(region.columnSpan, region.minColumns, GRID_COLUMNS);
  const rowSpan = clamp(region.rowSpan, region.minRows, GRID_ROWS);
  const column = clamp(region.column, 1, GRID_COLUMNS - columnSpan + 1);
  const row = clamp(region.row, 1, GRID_ROWS - rowSpan + 1);
  return { ...region, column, row, columnSpan, rowSpan };
}

export function overlappingRegionIds(layout: LayoutRegion[]): Set<RegionId> {
  const result = new Set<RegionId>();
  for (let left = 0; left < layout.length; left += 1) {
    for (let right = left + 1; right < layout.length; right += 1) {
      if (regionsOverlap(layout[left], layout[right])) {
        result.add(layout[left].id);
        result.add(layout[right].id);
      }
    }
  }
  return result;
}

export function regionsOverlap(left: LayoutRegion, right: LayoutRegion): boolean {
  return !(
    left.column + left.columnSpan <= right.column
    || right.column + right.columnSpan <= left.column
    || left.row + left.rowSpan <= right.row
    || right.row + right.rowSpan <= left.row
  );
}

export function layoutToCss(layout: LayoutRegion[], selector = '.board-layout'): string {
  return layout
    .map((item) => [
      `${selector} > [data-layout-region="${item.id}"] {`,
      `  grid-column: ${item.column} / span ${item.columnSpan};`,
      `  grid-row: ${item.row} / span ${item.rowSpan};`,
      '}',
    ].join('\n'))
    .join('\n\n');
}

export function layoutsToCss(layouts: LayoutsByPreset): CssByPreset {
  return {
    'phone-portrait': layoutToCss(layouts['phone-portrait']),
    'phone-landscape': layoutToCss(layouts['phone-landscape']),
    'tablet-portrait': layoutToCss(layouts['tablet-portrait']),
    desktop: layoutToCss(layouts.desktop),
  };
}

export function serializeLayouts(layouts: LayoutsByPreset): string {
  return JSON.stringify({
    version: 1,
    grid: { columns: GRID_COLUMNS, rows: GRID_ROWS },
    presets: VIEWPORT_PRESETS,
    layouts,
    css: layoutsToCss(layouts),
  }, null, 2);
}

export function isLayoutsByPreset(value: unknown): value is LayoutExport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { layouts?: Record<string, unknown> };
  const layouts = candidate.layouts;
  if (!layouts || typeof layouts !== 'object') return false;
  return VIEWPORT_PRESETS.every(({ id }) => {
    const layout = layouts[id];
    return Array.isArray(layout) && layout.every(isLayoutRegion);
  });
}

function isLayoutRegion(value: unknown): value is LayoutRegion {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LayoutRegion>;
  return typeof item.id === 'string'
    && typeof item.label === 'string'
    && typeof item.column === 'number'
    && typeof item.row === 'number'
    && typeof item.columnSpan === 'number'
    && typeof item.rowSpan === 'number'
    && typeof item.minColumns === 'number'
    && typeof item.minRows === 'number';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
