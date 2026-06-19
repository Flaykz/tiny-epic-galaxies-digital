import type { GameState } from '../engine/index.js';

/** Trigger a browser download of a text file. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Build a plain-text game log for download/upload. */
export function logText(state: GameState): string {
  const header = `Tiny Epic Galaxies — game log\nturn ${state.turnNumber} · phase ${state.phase}\n` +
    state.players.map((p) => `  ${p.name}: L${p.empireLevel}, ${p.energy}⚡ ${p.culture}🏛, planets ${p.colonized.join(', ') || '—'}`).join('\n');
  return `${header}\n\n${state.log.join('\n')}\n`;
}

/** Build a JSON problem report bundling the message, log, and current state. */
export function problemReport(state: GameState, message: string): string {
  return JSON.stringify(
    {
      message,
      when: new Date().toISOString(),
      userAgent: navigator.userAgent,
      turn: state.turnNumber,
      phase: state.phase,
      log: state.log,
      state,
    },
    null,
    2,
  );
}
