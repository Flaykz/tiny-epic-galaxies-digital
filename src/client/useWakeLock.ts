import { useEffect } from 'react';

/**
 * Keeps the screen from locking/dimming while `active` (a game in progress —
 * see LocalGame in App.tsx). Uses the Screen Wake Lock API, supported on
 * recent Chrome/Edge/Safari (incl. iOS 16.4+); on an unsupported browser this
 * is a silent no-op, not a crash.
 *
 * The OS releases the lock whenever the tab is hidden (backgrounded, screen
 * off) even if `active` stays true, so it's re-acquired on `visibilitychange`
 * once the tab is visible again — otherwise switching apps and back would
 * leave the screen unprotected for the rest of the game.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) {
          // `active` flipped false (or the effect re-ran) while the request
          // was in flight — release immediately instead of leaking a lock.
          void l.release();
          return;
        }
        lock = l;
      } catch {
        // Request refused (e.g. low battery, no user activation yet) — the
        // screen just won't be held awake; nothing else to do about it.
      }
    };
    void acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !lock) void acquire();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void lock?.release();
    };
  }, [active]);
}
