import React, { useState } from 'react';
import { finalScore, type GameState } from '../engine/index.js';
import { submitReport, captureScreenshot, downloadText, logText, problemReport } from '../client/report.js';

type Severity = 'bug' | 'rules-question' | 'feedback';

/**
 * Rich problem-report dialog: a description, a severity, and an auto-attached
 * screenshot + full game log/state. Submits to the server; falls back to a local
 * download if the server can't be reached (a report is never silently dropped).
 *
 * A dismissible bottom {@link Sheet}, like every other popup in the app: the
 * submit/cancel pair and the on-screen keyboard both live at the bottom of a
 * phone, so a centered card put the form as far from the thumb as possible.
 * Sheet is a dumb container, so the two-step form → submitted state stays here
 * as conditional children.
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
    <Sheet open onClose={onClose} title={title}>
      {done ? (
        <>
          <p>✅ Thanks! Submitted to the server.</p>
          <p className="muted small">Report id <code>{done}</code></p>
          <div className="sheet-actions">
            <button type="button" className="sheet-btn primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <>
          <label className="sheet-field">
            <span>{fieldLabel}</span>
            <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus
              placeholder={placeholder} />
          </label>
          <label className="sheet-field">
            <span>Type</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              <option value="bug">Bug</option>
              <option value="rules-question">Rules question</option>
              <option value="feedback">Feedback</option>
            </select>
          </label>
          <label className="sheet-check">
            <input type="checkbox" checked={attachShot} onChange={(e) => setAttachShot(e.target.checked)} />
            <span>Attach a screenshot</span>
          </label>
          <p className="muted small">The current game log and state are attached automatically.</p>
          {error && <p className="error">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="sheet-btn primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit report'}</button>
            <button type="button" className="sheet-btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/**
 * Generic bottom-anchored sheet/drawer — the shared visual language for every
 * "escape the clipped panel" popup in the board redesign (opponent detail,
 * on-demand log, contextual action lists). Slides up from the bottom, rounded
 * top corners, safe-area bottom padding.
 *
 * Pass `onClose` for an optional/dismissible sheet (tap-outside or the ✕
 * closes it) — used for read-only drawers like the opponent detail sheet and
 * the log. Omit it for a *mandatory* decision sheet (e.g. a required target
 * choice): no close affordance is rendered and tapping the scrim is a no-op,
 * matching the existing Follow-window popup, which is similarly non-optional.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="sheet-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div className="sheet-card">
        <div className="sheet-handle" aria-hidden="true" />
        {(title || onClose) && (
          <div className="sheet-head">
            {title && <h2 className="sheet-title">{title}</h2>}
            {onClose && (
              <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">×</button>
            )}
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * Non-blocking, auto-dismissing banner. The board resolves exactly one decision
 * without asking (a follow window whose only legal answer is "decline" — see
 * Board's auto-decline effect), and this is how the player is told it happened:
 * no scrim, no buttons, `pointer-events: none`, gone after `duration`.
 *
 * Mount it with a fresh `key` per message so a second toast restarts the timer
 * instead of inheriting the first one's.
 */
export function Toast({ message, duration = 3200, onDismiss }: {
  message: string;
  duration?: number;
  onDismiss: () => void;
}) {
  // Keep the callback in a ref: callers pass an inline arrow, so depending on it
  // directly would restart the timer on every parent render — and the toast
  // would then never auto-hide.
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;
  React.useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(t);
  }, [message, duration]);
  return (
    <div className="toast-banner" role="status" aria-live="polite">
      <span>{message}</span>
    </div>
  );
}

/**
 * Bottom-sheet confirm/cancel prompt — replaces window.confirm() for the two
 * destructive confirmations on the board (reset game, abandon orbit). Two
 * full-width ≥48px stacked buttons (thumb zone at the bottom of the screen).
 */
export function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sheet-card">
        <div className="sheet-handle" aria-hidden="true" />
        <h2 className="sheet-title">{title}</h2>
        {description && <p className="sheet-desc">{description}</p>}
        <div className="sheet-actions">
          <button type="button" className={`sheet-btn ${destructive ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
          <button type="button" className="sheet-btn ghost" onClick={onCancel}>{cancelLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** End-of-game popup: who won/lost (from the viewer's seat) + submit/download log.
 *
 * A *mandatory* bottom {@link Sheet} (no `onClose`, so no ✕ and no
 * tap-outside): the explicit Close button below is the only way out, exactly as
 * the centered modal this replaced behaved — dismissing it is one-way (see
 * Board's `gameOverDismissed`), so it must not be losable to a stray tap. The
 * headline is a child rather than Sheet's `title` because it carries its own
 * clamp()ed display size. */
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
    <Sheet open>
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
      <div className="sheet-actions">
        <button type="button" className="sheet-btn primary" onClick={onSubmitLog}>⬆ Submit game log</button>
        <button type="button" className="sheet-btn" onClick={() => downloadText('teg-final-log.txt', logText(state))}>⬇ Download log</button>
        <button type="button" className="sheet-btn ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
