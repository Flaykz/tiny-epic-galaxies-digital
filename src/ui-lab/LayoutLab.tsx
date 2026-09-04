import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DEFAULT_LAYOUTS,
  GRID_COLUMNS,
  GRID_ROWS,
  VIEWPORT_PRESETS,
  clampRegion,
  cloneLayouts,
  isLayoutsByPreset,
  overlappingRegionIds,
  serializeLayouts,
  type LayoutRegion,
  type LayoutsByPreset,
  type PresetId,
  type RegionId,
} from './layoutModel.js';
import './layoutLab.css';

type ScenarioId = 'two-players' | 'five-players' | 'solo-rogue' | 'follow-action';
type InteractionMode = 'move' | 'resize';

interface Interaction {
  mode: InteractionMode;
  id: RegionId;
  pointerId: number;
  originX: number;
  originY: number;
  before: LayoutsByPreset;
  startingRegion: LayoutRegion;
}

const STORAGE_KEY = 'teg-ui-layout-lab-v1';
const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'two-players', label: '2 players' },
  { id: 'five-players', label: '5 players' },
  { id: 'solo-rogue', label: 'Solo Rogue' },
  { id: 'follow-action', label: 'Follow action' },
];

export function LayoutLab() {
  const [layouts, setLayouts] = useState<LayoutsByPreset>(() => loadStoredLayouts());
  const [presetId, setPresetId] = useState<PresetId>('desktop');
  const [scenario, setScenario] = useState<ScenarioId>('two-players');
  const [selectedId, setSelectedId] = useState<RegionId>('planets');
  const [zoom, setZoom] = useState(72);
  const [past, setPast] = useState<LayoutsByPreset[]>([]);
  const [future, setFuture] = useState<LayoutsByPreset[]>([]);
  const [notice, setNotice] = useState('Layouts save automatically in this browser.');
  const [, setInteraction] = useState<Interaction | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const preset = VIEWPORT_PRESETS.find((candidate) => candidate.id === presetId)!;
  const layout = layouts[presetId];
  const selected = layout.find((item) => item.id === selectedId) ?? layout[0];
  const collisions = useMemo(() => overlappingRegionIds(layout), [layout]);
  const scale = zoom / 100;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, serializeLayouts(layouts));
  }, [layouts]);

  function updateSelected(patch: Partial<LayoutRegion>, remember = true) {
    const nextLayouts = cloneLayouts(layouts);
    nextLayouts[presetId] = nextLayouts[presetId].map((item) => (
      item.id === selectedId ? clampRegion({ ...item, ...patch }) : item
    ));
    applyLayouts(nextLayouts, remember);
  }

  function applyLayouts(next: LayoutsByPreset, remember = true) {
    if (remember) {
      setPast((items) => [...items.slice(-39), cloneLayouts(layouts)]);
      setFuture([]);
    }
    setLayouts(next);
  }

  function beginInteraction(event: ReactPointerEvent<HTMLButtonElement>, item: LayoutRegion, mode: InteractionMode) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(item.id);
    const nextInteraction: Interaction = {
      mode,
      id: item.id,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      before: cloneLayouts(layouts),
      startingRegion: { ...item },
    };
    interactionRef.current = nextInteraction;
    setInteraction(nextInteraction);
  }

  function moveInteraction(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeInteraction = interactionRef.current;
    if (!activeInteraction || event.pointerId !== activeInteraction.pointerId || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const deltaColumns = Math.round((event.clientX - activeInteraction.originX) / (bounds.width / GRID_COLUMNS));
    const deltaRows = Math.round((event.clientY - activeInteraction.originY) / (bounds.height / GRID_ROWS));
    const nextLayouts = cloneLayouts(layouts);
    nextLayouts[presetId] = nextLayouts[presetId].map((item) => {
      if (item.id !== activeInteraction.id) return item;
      const next = activeInteraction.mode === 'move'
        ? {
          ...activeInteraction.startingRegion,
          column: activeInteraction.startingRegion.column + deltaColumns,
          row: activeInteraction.startingRegion.row + deltaRows,
        }
        : {
          ...activeInteraction.startingRegion,
          columnSpan: activeInteraction.startingRegion.columnSpan + deltaColumns,
          rowSpan: activeInteraction.startingRegion.rowSpan + deltaRows,
        };
      return clampRegion(next);
    });
    setLayouts(nextLayouts);
  }

  function endInteraction(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeInteraction = interactionRef.current;
    if (!activeInteraction || event.pointerId !== activeInteraction.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setPast((items) => [...items.slice(-39), activeInteraction.before]);
    setFuture([]);
    interactionRef.current = null;
    setInteraction(null);
  }

  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((items) => [cloneLayouts(layouts), ...items].slice(0, 40));
    setPast((items) => items.slice(0, -1));
    setLayouts(cloneLayouts(previous));
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setPast((items) => [...items.slice(-39), cloneLayouts(layouts)]);
    setFuture((items) => items.slice(1));
    setLayouts(cloneLayouts(next));
  }

  function resetCurrent() {
    const next = cloneLayouts(layouts);
    next[presetId] = DEFAULT_LAYOUTS[presetId].map((item) => ({ ...item }));
    applyLayouts(next);
    setNotice(`${preset.label} restored to its starting layout.`);
  }

  function downloadJson() {
    const blob = new Blob([serializeLayouts(layouts)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'teg-board-layouts.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('All layouts and generated CSS exported.');
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isLayoutsByPreset(parsed)) throw new Error('Invalid layout file');
      const next = cloneLayouts(parsed.layouts);
      for (const viewport of VIEWPORT_PRESETS) {
        next[viewport.id] = next[viewport.id].map(clampRegion);
      }
      applyLayouts(next);
      setNotice('All layouts imported; CSS was regenerated.');
    } catch {
      setNotice('This file is not a valid UI Layout Lab export.');
    }
  }

  return (
    <main className="layout-lab">
      <header className="layout-lab__header">
        <div>
          <p className="layout-lab__kicker">Tiny Epic Galaxies</p>
          <h1>Board layout lab</h1>
          <p>Move the real interface regions, test crowded states, then export the layout you approve.</p>
        </div>
        <div className={`layout-lab__validation ${collisions.size ? 'is-invalid' : 'is-valid'}`} role="status">
          <span aria-hidden="true">{collisions.size ? '!' : '✓'}</span>
          <div>
            <strong>{collisions.size ? 'Regions overlap' : 'Layout is valid'}</strong>
            <small>{collisions.size ? 'Move or resize the highlighted zones.' : 'Everything fits inside the viewport.'}</small>
          </div>
        </div>
      </header>

      <div className="layout-lab__workspace">
        <aside className="layout-lab__rail" aria-label="Layout tools">
          <ToolSection title="Viewport">
            <div className="layout-lab__choices">
              {VIEWPORT_PRESETS.map((candidate) => (
                <button
                  type="button"
                  className={candidate.id === presetId ? 'is-active' : ''}
                  key={candidate.id}
                  onClick={() => setPresetId(candidate.id)}
                >
                  <span>{candidate.label}</span>
                  <small>{candidate.width} × {candidate.height}</small>
                </button>
              ))}
            </div>
          </ToolSection>

          <ToolSection title="Game state">
            <select value={scenario} onChange={(event) => setScenario(event.target.value as ScenarioId)}>
              {SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </ToolSection>

          <ToolSection title="Layers">
            <div className="layout-lab__layers">
              {layout.map((item) => (
                <button
                  type="button"
                  className={`${selectedId === item.id ? 'is-active' : ''} ${collisions.has(item.id) ? 'has-error' : ''}`}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className={`layout-lab__layer-dot is-${item.id}`} />
                  {item.label}
                </button>
              ))}
            </div>
          </ToolSection>
        </aside>

        <section className="layout-lab__stage" aria-label="Editable board layout">
          <div className="layout-lab__stagebar">
            <div className="layout-lab__history">
              <button type="button" onClick={undo} disabled={!past.length} aria-label="Undo">↶</button>
              <button type="button" onClick={redo} disabled={!future.length} aria-label="Redo">↷</button>
              <button type="button" onClick={resetCurrent}>Reset</button>
            </div>
            <label>
              Zoom
              <input type="range" min="35" max="100" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <span>{zoom}%</span>
            </label>
          </div>

          <div className="layout-lab__viewport-scroll">
            <div className="layout-lab__viewport-space" style={{ width: preset.width * scale, height: preset.height * scale }}>
              <div
                ref={canvasRef}
                className="layout-lab__canvas"
                style={{
                  width: preset.width,
                  height: preset.height,
                  transform: `scale(${scale})`,
                }}
              >
                <div className="layout-lab__grid" aria-hidden="true" />
                {layout.map((item) => (
                  <LayoutZone
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    colliding={collisions.has(item.id)}
                    scenario={scenario}
                    onSelect={() => setSelectedId(item.id)}
                    onBegin={beginInteraction}
                    onMove={moveInteraction}
                    onEnd={endInteraction}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="layout-lab__inspector" aria-label="Selected region inspector">
          <div className="layout-lab__selection-title">
            <span className={`layout-lab__layer-dot is-${selected.id}`} />
            <div>
              <h2>{selected.label}</h2>
              <p>{selected.hint}</p>
            </div>
          </div>

          <div className="layout-lab__fields">
            <NumberField label="Column" value={selected.column} min={1} max={GRID_COLUMNS - selected.columnSpan + 1} onChange={(column) => updateSelected({ column })} />
            <NumberField label="Row" value={selected.row} min={1} max={GRID_ROWS - selected.rowSpan + 1} onChange={(row) => updateSelected({ row })} />
            <NumberField label="Width" value={selected.columnSpan} min={selected.minColumns} max={GRID_COLUMNS} suffix="cols" onChange={(columnSpan) => updateSelected({ columnSpan })} />
            <NumberField label="Height" value={selected.rowSpan} min={selected.minRows} max={GRID_ROWS} suffix="rows" onChange={(rowSpan) => updateSelected({ rowSpan })} />
          </div>

          <div className="layout-lab__coordinates">
            <span>Grid position</span>
            <code>{selected.column}:{selected.row} / {selected.columnSpan}×{selected.rowSpan}</code>
          </div>

          <div className="layout-lab__export">
            <button type="button" onClick={downloadJson}>Export JSON</button>
            <label className="layout-lab__import">
              Import JSON
              <input type="file" accept="application/json,.json" onChange={importJson} />
            </label>
          </div>
          <p className="layout-lab__notice" aria-live="polite">{notice}</p>

          <div className="layout-lab__rules">
            <h3>Validation rules</h3>
            <ul>
              <li className={!collisions.size ? 'is-passing' : ''}>No region overlap</li>
              <li className="is-passing">Inside the viewport</li>
              <li className="is-passing">Snapped to a 12 × 12 grid</li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LayoutZone({
  item,
  selected,
  colliding,
  scenario,
  onSelect,
  onBegin,
  onMove,
  onEnd,
}: {
  item: LayoutRegion;
  selected: boolean;
  colliding: boolean;
  scenario: ScenarioId;
  onSelect: () => void;
  onBegin: (event: ReactPointerEvent<HTMLButtonElement>, item: LayoutRegion, mode: InteractionMode) => void;
  onMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <article
      className={`layout-zone is-${item.id} ${selected ? 'is-selected' : ''} ${colliding ? 'is-colliding' : ''}`}
      data-layout-region={item.id}
      style={{
        gridColumn: `${item.column} / span ${item.columnSpan}`,
        gridRow: `${item.row} / span ${item.rowSpan}`,
      }}
      onClick={onSelect}
    >
      <button
        type="button"
        className="layout-zone__drag"
        aria-label={`Move ${item.label}`}
        onPointerDown={(event) => onBegin(event, item, 'move')}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
      >
        <span>⠿</span>
        {item.label}
      </button>
      <ZonePreview id={item.id} scenario={scenario} />
      <button
        type="button"
        className="layout-zone__resize"
        aria-label={`Resize ${item.label}`}
        onPointerDown={(event) => onBegin(event, item, 'resize')}
        onPointerMove={onMove}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
      />
    </article>
  );
}

function ZonePreview({ id, scenario }: { id: RegionId; scenario: ScenarioId }) {
  if (id === 'topbar') {
    return (
      <div className="lab-preview lab-preview--topbar">
        <span className="lab-turn">Nova's turn</span>
        <span className="lab-tool-icons">□ ↻</span>
      </div>
    );
  }
  if (id === 'players') {
    const opponents = scenario === 'five-players' ? ['Red', 'Gold', 'Green', 'Violet'] : scenario === 'solo-rogue' ? ['Rogue'] : ['Red'];
    return (
      <div className="lab-preview lab-preview--players">
        <div className="lab-player-main">
          <span><strong>Nova</strong><b>11 VP</b></span>
          <div><i style={{ width: '72%' }} /><i style={{ width: '46%' }} /></div>
        </div>
        <div className="lab-opponents">
          {opponents.map((name) => <span key={name}>{name}<b>{name === 'Rogue' ? '16' : '8'} VP</b></span>)}
        </div>
      </div>
    );
  }
  if (id === 'planets') {
    const planets = scenario === 'five-players'
      ? ['Arcturus', 'Bisschop', 'Canopus', 'Delphinus', 'Elon', 'Forza', 'Gamelyn']
      : ['Arcturus', 'Bisschop', 'Canopus', 'Delphinus'];
    return (
      <div className="lab-preview lab-preview--planets">
        {planets.map((planet, index) => (
          <div className="lab-planet" key={planet}>
            <span className="lab-planet__orb">{index % 2 ? '◉' : '◎'}</span>
            <strong>{planet}</strong>
            <small>{index % 2 ? 'Diplomacy' : 'Economy'} · {index + 2} VP</small>
          </div>
        ))}
      </div>
    );
  }
  if (id === 'dice') {
    return (
      <div className="lab-preview lab-preview--dice" aria-label="Command dice preview">
        {['🚀', '⚡', '🏛', '🕊', '📈', '⚡'].map((face, index) => <span key={`${face}-${index}`}>{face}</span>)}
      </div>
    );
  }
  if (id === 'actions') {
    return (
      <div className="lab-preview lab-preview--actions">
        {scenario === 'follow-action' && (
          <div className="lab-follow-action">
            <span>Blue may follow</span>
            <strong>Move one ship</strong>
            <div>
              <button type="button">Follow</button>
              <button type="button" className="is-pass">Pass</button>
            </div>
          </div>
        )}
        <button type="button">Activate die</button>
        <button type="button">Reroll</button>
        <button type="button" className="is-end">End turn</button>
      </div>
    );
  }
  return (
    <div className="lab-preview lab-preview--footer">
      <span>Turn log</span><span>Report a problem</span>
    </div>
  );
}

function ToolSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="layout-lab__tool-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <div>
        <input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}

function loadStoredLayouts(): LayoutsByPreset {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return cloneLayouts(DEFAULT_LAYOUTS);
    const parsed: unknown = JSON.parse(stored);
    return isLayoutsByPreset(parsed) ? cloneLayouts(parsed.layouts) : cloneLayouts(DEFAULT_LAYOUTS);
  } catch {
    return cloneLayouts(DEFAULT_LAYOUTS);
  }
}
