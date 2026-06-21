import React, { useState } from 'react';
import { finalScore, type GameState } from '../engine/index.js';
import { submitReport, captureScreenshot, downloadText, logText, problemReport } from '../client/report.js';

type Severity = 'bug' | 'rules-question' | 'feedback';

/**
 * Rich problem-report dialog: a description, a severity, and an auto-attached
 * screenshot + full game log/state. Submits to the server; falls back to a local
 * download if the server can't be reached (a report is never silently dropped).
 */
export function ReportDialog({
  state,
  defaultSeverity = 'bug',
  title = 'Report a problem',
  category,
  onClose,
}: {
  state: GameState;
  defaultSeverity?: Severity;
  title?: string;
  /** Triage bucket; 'game-log' keeps post-victory uploads out of the problem queue. */
  category?: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<Severity>(defaultSeverity);
  const [attachShot, setAttachShot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const screenshot = attachShot ? await captureScreenshot() : undefined;
      const id = await submitReport({ message: message || '(no description)', severity, category, state, screenshot });
      setDone(id);
    } catch (e: any) {
      // Don't lose the report — download it locally.
      downloadText(`teg-report-turn${state.turnNumber}.json`, problemReport(state, message), 'application/json');
      setError(`Couldn't reach the server, so a report file was downloaded instead — please attach it. (${e?.message ?? e})`);
    } finally {
      setBusy(false);
    }
  };

  const fieldLabel = severity === 'feedback' ? 'Notes (optional)'
    : severity === 'rules-question' ? 'Your rules question'
    : 'What happened? (and what you expected)';
  const placeholder = severity === 'feedback' ? 'Anything to add about this game? (optional)'
    : severity === 'rules-question' ? 'Which rule seems wrong, and what did you expect?'
    : 'Describe the problem and what you expected…';

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        <h2>{title}</h2>
        {done ? (
          <>
            <p>✅ Thanks! Submitted to the server.</p>
            <p className="muted small">Report id <code>{done}</code></p>
            <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <label className="field">
              <span>{fieldLabel}</span>
              <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus
                placeholder={placeholder} />
            </label>
            <label className="field">
              <span>Type</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                <option value="bug">Bug</option>
                <option value="rules-question">Rules question</option>
                <option value="feedback">Feedback</option>
              </select>
            </label>
            <label className="field-check">
              <input type="checkbox" checked={attachShot} onChange={(e) => setAttachShot(e.target.checked)} />
              <span>Attach a screenshot</span>
            </label>
            <p className="muted small">The current game log and state are attached automatically.</p>
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit report'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** End-of-game popup: who won/lost (from the viewer's seat) + submit/download log. */
export function GameOverDialog({
  state,
  viewer,
  onSubmitLog,
  onClose,
}: {
  state: GameState;
  viewer: string;
  onSubmitLog: () => void;
  onClose: () => void;
}) {
  const winners = state.winners ?? [];
  const youWon = winners.includes(viewer);
  const shared = youWon && winners.length > 1;
  const headline = state.rogueId
    ? (youWon ? '🏆 You defeated the Rogue Galaxy!' : '☠ The Rogue Galaxy wins — you lost.')
    : shared ? '🤝 Shared victory!'
    : youWon ? '🏆 You win!'
    : '😞 You lost.';

  const ranked = state.players
    .filter((p) => !p.isRogue)
    .map((p) => ({ p, score: finalScore(state, p), won: winners.includes(p.id) }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2 className="gameover-headline">{headline}</h2>
        <ul className="gameover-scores">
          {ranked.map(({ p, score, won }) => (
            <li key={p.id} className={won ? 'won' : ''}>
              <span>{won ? '🏆 ' : ''}{p.name}{p.id === viewer ? ' (you)' : ''}</span>
              <strong>{score} VP</strong>
              {p.mission && p.mission.id !== 'hidden' && <span className="muted small"> · {p.mission.name}</span>}
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={() => downloadText('teg-final-log.txt', logText(state))}>⬇ Download log</button>
          <button className="primary" onClick={onSubmitLog}>⬆ Submit game log</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
