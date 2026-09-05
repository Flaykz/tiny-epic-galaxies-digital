import React from 'react';
import { finalScore, type GameState } from '../engine/index.js';
import { downloadText, logText } from '../client/log.js';

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

/** End-of-game popup: who won/lost (from the viewer's seat) + a log download.
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
  onClose,
}: {
  state: GameState;
  viewer: string;
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
        <button type="button" className="sheet-btn primary" onClick={() => downloadText('teg-final-log.txt', logText(state))}>⬇ Download log</button>
        <button type="button" className="sheet-btn ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
