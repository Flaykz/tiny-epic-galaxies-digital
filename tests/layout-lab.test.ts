import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUTS,
  clampRegion,
  cloneLayout,
  layoutToCss,
  layoutsToCss,
  overlappingRegionIds,
  serializeLayouts,
} from '../src/ui-lab/layoutModel.js';

describe('UI layout lab model', () => {
  it('keeps moved regions inside the 12 by 12 grid', () => {
    const region = { ...DEFAULT_LAYOUTS.desktop[0], column: 20, row: -4 };
    const clamped = clampRegion(region);
    expect(clamped.column + clamped.columnSpan - 1).toBe(12);
    expect(clamped.row).toBe(1);
  });

  it('detects every region involved in an overlap', () => {
    const layout = cloneLayout(DEFAULT_LAYOUTS.desktop);
    layout[1] = { ...layout[1], column: layout[2].column, row: layout[2].row };
    expect(overlappingRegionIds([layout[1], layout[2]])).toEqual(new Set(['players', 'planets']));
  });

  it('keeps every approved viewport collision-free', () => {
    for (const layout of Object.values(DEFAULT_LAYOUTS)) {
      expect(overlappingRegionIds(layout)).toEqual(new Set());
    }
    expect(DEFAULT_LAYOUTS['phone-portrait'].find(({ id }) => id === 'actions')).toMatchObject({
      column: 7,
      row: 8,
      columnSpan: 6,
      rowSpan: 4,
    });
    expect(DEFAULT_LAYOUTS.desktop.find(({ id }) => id === 'planets')).toMatchObject({
      column: 4,
      row: 4,
      columnSpan: 9,
      rowSpan: 7,
    });
  });

  it('exports grid placement as usable CSS', () => {
    const css = layoutToCss([DEFAULT_LAYOUTS.desktop[0]]);
    expect(css).toContain('[data-layout-region="topbar"]');
    expect(css).toContain('grid-column: 1 / span 6');
    expect(css).toContain('grid-row: 11 / span 2');
  });

  it('exports every viewport and its generated CSS in one JSON file', () => {
    const exported = JSON.parse(serializeLayouts(DEFAULT_LAYOUTS));
    const css = layoutsToCss(DEFAULT_LAYOUTS);

    expect(Object.keys(exported.layouts)).toEqual([
      'phone-portrait',
      'phone-landscape',
      'tablet-portrait',
      'desktop',
    ]);
    expect(exported.css).toEqual(css);
    expect(exported.css.desktop).toContain('[data-layout-region="actions"]');
  });
});
