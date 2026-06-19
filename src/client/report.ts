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

/** Capture a PNG screenshot of the board as a data URL (best-effort). */
export async function captureScreenshot(): Promise<string | undefined> {
  try {
    const { default: html2canvas } = await import('html2canvas');
    const el = (document.querySelector('.board') as HTMLElement) ?? document.body;
    const canvas = await html2canvas(el, { backgroundColor: '#0a0e1a', scale: 0.6, logging: false, useCORS: true });
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

/** Build a plain-text game log for download/upload. */
export function logText(state: GameState): string {
  const header = `Tiny Epic Galaxies — game log\nturn ${state.turnNumber} · phase ${state.phase}\n` +
    state.players.map((p) => `  ${p.name}: L${p.empireLevel}, ${p.energy}⚡ ${p.culture}🏛, planets ${p.colonized.join(', ') || '—'}`).join('\n');
  return `${header}\n\n${state.log.join('\n')}\n`;
}

/**
 * Submit a standalone bug/feedback report to the server (works for local & solo
 * games — no game id needed). Resolves with the server-issued reportId; throws
 * on any failure so callers never treat a dropped report as success.
 */
export async function submitReport(body: {
  message: string;
  severity?: 'bug' | 'rules-question' | 'feedback';
  state: GameState;
  /** Optional base64 PNG data URL. */
  screenshot?: string;
}): Promise<string> {
  const res = await fetch('/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: body.message,
      severity: body.severity ?? 'bug',
      turn: body.state.turnNumber,
      log: body.state.log,
      state: body.state,
      screenshot: body.screenshot,
      build: typeof __DBF_BUILD_ID__ !== 'undefined' ? __DBF_BUILD_ID__ : 'dev',
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) throw new Error(`report failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.reportId) throw new Error('report failed: no reportId');
  return data.reportId as string;
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
