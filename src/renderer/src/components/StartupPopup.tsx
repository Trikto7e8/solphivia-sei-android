/**
 * StartupPopup — the operator's one-page popup (261027, replaced the notices
 * inbox).
 *
 * Main tells us which popup this install still owes (push + race-proof pull).
 * Once the screen is calm (`isCalm`, the same "nothing else going on" test the
 * boot import offer uses) the page loads in a HIDDEN sandboxed iframe; only
 * when main confirms the frame committed a 2xx page does the overlay appear,
 * and main records the id as shown at that moment. So a page that is offline,
 * 404s or never loads shows nothing, and is tried again next launch.
 *
 * The frame: `sandbox="allow-popups"` and nothing else, so the page runs no
 * scripts, gets an opaque origin (no cookies, no storage, no access to this
 * window), cannot submit forms or navigate the app. Links still work: main's
 * popupFrameGuards send every link and target=_blank to the default browser.
 *
 * Closing: the X (always visible, focused on open), Esc, or a click anywhere
 * outside the page.
 *
 * z 1100 (ModalShell's stacked tier): it only ever opens over a calm screen,
 * so nothing modal is under it, and anything raised later sits above base.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StartupPopupInfo } from '@shared/ipc';
import { sei } from '../lib/ipcClient';
import { useT } from '../lib/i18n';
import {
  POPUP_FIRST_LOOK_MS,
  POPUP_LOAD_TIMEOUT_MS,
  POPUP_POLL_MS,
  popupCardSize,
} from '../lib/startupPopup';
import { CloseIcon } from './icons';
import styles from './StartupPopup.module.css';

interface StartupPopupProps {
  /** True when nothing else is on screen (no modal, tour, game, call, share). */
  isCalm: () => boolean;
}

type Phase = 'loading' | 'shown';

function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = (): void => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

export function StartupPopup({ isCalm }: StartupPopupProps): React.ReactElement | null {
  const t = useT();
  const vp = useViewport();
  /** What main says this install still owes. */
  const [owed, setOwed] = useState<StartupPopupInfo | null>(null);
  /** The popup being loaded or shown, and how far it got. */
  const [active, setActive] = useState<{ popup: StartupPopupInfo; phase: Phase } | null>(null);
  /** Ids tried this app session (shown, failed or timed out): never retried until relaunch. */
  const tried = useRef(new Set<string>());
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const isCalmRef = useRef(isCalm);
  isCalmRef.current = isCalm;

  // Subscribe + race-proof pull.
  useEffect(() => {
    const unsub = sei.onStartupPopup((p) => setOwed(p));
    void sei
      .getStartupPopup()
      .then((p) => setOwed((cur) => cur ?? p))
      .catch(() => undefined);
    return unsub;
  }, []);

  // A popup taken down (or replaced) before it appeared stops loading.
  useEffect(() => {
    if (active && active.phase === 'loading' && owed?.id !== active.popup.id) setActive(null);
  }, [owed, active]);

  // Wait for a calm screen, then start loading the owed popup.
  useEffect(() => {
    if (!owed || active || tried.current.has(owed.id)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = (): void => {
      if (isCalmRef.current()) {
        tried.current.add(owed.id);
        setActive({ popup: owed, phase: 'loading' });
        return;
      }
      timer = setTimeout(look, POPUP_POLL_MS);
    };
    timer = setTimeout(look, POPUP_FIRST_LOOK_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [owed, active]);

  // A page that never loads is dropped silently.
  useEffect(() => {
    if (!active || active.phase !== 'loading') return;
    const timer = setTimeout(() => setActive(null), POPUP_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [active]);

  const onFrameLoad = useCallback(() => {
    if (!active || active.phase !== 'loading') return;
    const { popup } = active;
    // The screen may have got busy while the page loaded: then this popup is
    // not shown (and not recorded), and the next launch tries again.
    if (!isCalmRef.current()) {
      setActive(null);
      return;
    }
    void sei
      .startupPopupLoaded(popup.id)
      .then((ok) => {
        setActive((cur) => {
          if (!cur || cur.popup.id !== popup.id) return cur;
          return ok ? { popup, phase: 'shown' } : null;
        });
      })
      .catch(() => setActive(null));
  }, [active]);

  const close = useCallback(() => setActive(null), []);

  const shown = active?.phase === 'shown';

  useEffect(() => {
    if (!shown) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, close]);

  if (!active) return null;
  const size = popupCardSize(vp.w, vp.h, active.popup.width, active.popup.height);

  return (
    <div
      className={shown ? `${styles.scrim} ${styles.shown}` : styles.scrim}
      role={shown ? 'dialog' : undefined}
      aria-modal={shown ? 'true' : undefined}
      aria-label={shown ? t('Announcement') : undefined}
      aria-hidden={shown ? undefined : true}
      data-startup-popup={active.phase}
      onMouseDown={(e) => {
        if (shown && e.target === e.currentTarget) close();
      }}
    >
      <div className={styles.card} style={{ width: size.width, height: size.height }}>
        <iframe
          className={styles.frame}
          src={active.popup.url}
          title={t('Announcement')}
          sandbox="allow-popups"
          referrerPolicy="no-referrer"
          tabIndex={shown ? 0 : -1}
          onLoad={onFrameLoad}
        />
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          onClick={close}
          aria-label={t('Close')}
          tabIndex={shown ? 0 : -1}
        >
          <CloseIcon size={18} />
        </button>
      </div>
    </div>
  );
}
