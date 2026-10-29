/**
 * useUpdateStore: the background half of the in-app updater (261023).
 *
 * App.tsx owns the updater subscriptions and feeds this store; the sidebar
 * "Update Sei" button (UpdateRailButton, mounted at the bottom of IconRail)
 * and the post-update "Updated to vX" toast (UpdatedToast) read it. It
 * replaces the corner UpdatePill, which only App.tsx could see.
 *
 * Modal states (the optional-update offer, the critical apply:"now" restart,
 * the full what's-new) still live in App.tsx's UpdatePopup state: they need
 * a decision now, this store never does.
 *
 *   rail
 *     null         nothing downloaded or downloading
 *     downloading  a background download is running (consented or mandatory)
 *     ready        an update is on disk; it installs on the next quit anyway,
 *                  the button lets the user restart into it now
 *     restarting   the user clicked; main is quitting into the installer.
 *                  On Windows the quit waits WINDOWS_RESTART_NOTE_MS first, so
 *                  the "takes about a minute, Sei reopens by itself" note next
 *                  to the button can be read before the window closes (261030).
 *   toast          one-shot confirmation after an accepted update relaunched
 */

import { create } from 'zustand';
import { sei } from '../ipcClient';

export type UpdateRailState =
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version?: string }
  | { kind: 'restarting'; version?: string };

export interface UpdatedToastState {
  version: string;
  /** Headline of the changelog, may be empty. */
  headline: string;
}

/**
 * If the app is still alive this long after "Update Sei" (install refused,
 * an unpackaged dev build, an installer that failed to spawn), put the button
 * back so the user is not left looking at a spinner forever.
 */
export const RESTART_STUCK_MS = 20_000;

/**
 * Windows only (261030): how long the restarting note stays up before Sei
 * quits into the installer. The Windows install takes about 100 s (the NSIS
 * installer re-unpacks the whole app) against about 12 s on macOS, and the
 * user should know that before the window disappears. The installer then
 * shows its own "Installing, please wait" window (src/main/updateInstall.ts).
 */
export const WINDOWS_RESTART_NOTE_MS = 3_000;

/**
 * The Windows-only expectation line, shown by the restarting rail button, its
 * restart confirm and the forced-restart popup. i18n key = the English copy
 * (zh entry in lib/i18n/zh/modals.ts).
 */
export const WINDOWS_UPDATE_NOTE = 'Updating takes about a minute on Windows. Sei reopens by itself.';

/** Whether this platform shows WINDOWS_UPDATE_NOTE. */
export function showsWindowsUpdateNote(platform: string | undefined): boolean {
  return platform === 'win32';
}

/** Delay between the click and the install call. 0 keeps macOS immediate. */
export function restartNoteDelayMs(platform: string | undefined): number {
  return showsWindowsUpdateNote(platform) ? WINDOWS_RESTART_NOTE_MS : 0;
}

interface UpdateStore {
  rail: UpdateRailState | null;
  toast: UpdatedToastState | null;
  setDownloading: (percent: number) => void;
  setReady: (version?: string) => void;
  clearRail: () => void;
  /** Quit and install now. No-op unless an update is ready. */
  restart: () => void;
  showToast: (t: UpdatedToastState) => void;
  dismissToast: () => void;
}

let stuckTimer: ReturnType<typeof setTimeout> | null = null;
let installTimer: ReturnType<typeof setTimeout> | null = null;

function clearStuckTimer(): void {
  if (stuckTimer) clearTimeout(stuckTimer);
  stuckTimer = null;
}

function clearInstallTimer(): void {
  if (installTimer) clearTimeout(installTimer);
  installTimer = null;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  rail: null,
  toast: null,

  setDownloading: (percent) => {
    // A progress tick never downgrades a finished download (a late tick after
    // update-downloaded, or a second check re-reporting the cached file).
    const cur = get().rail;
    if (cur && cur.kind !== 'downloading') return;
    set({ rail: { kind: 'downloading', percent } });
  },

  setReady: (version) => {
    clearStuckTimer();
    set({ rail: { kind: 'ready', version } });
  },

  clearRail: () => {
    // An error after "ready" (say a later background check failing) must not
    // hide an update that is already on disk.
    const cur = get().rail;
    if (cur && cur.kind !== 'downloading') return;
    set({ rail: null });
  },

  restart: () => {
    const cur = get().rail;
    if (!cur || cur.kind !== 'ready') return;
    set({ rail: { kind: 'restarting', version: cur.version } });
    clearStuckTimer();
    stuckTimer = setTimeout(() => {
      stuckTimer = null;
      const now = get().rail;
      if (now && now.kind === 'restarting') set({ rail: { kind: 'ready', version: now.version } });
    }, RESTART_STUCK_MS);
    const install = (): void => {
      void Promise.resolve()
        .then(() => sei.installUpdate())
        .catch(() => {
          clearStuckTimer();
          set({ rail: { kind: 'ready', version: cur.version } });
        });
    };
    clearInstallTimer();
    const delay = restartNoteDelayMs(sei.platform);
    if (delay > 0) {
      installTimer = setTimeout(() => {
        installTimer = null;
        install();
      }, delay);
    } else {
      install();
    }
  },

  showToast: (toast) => set({ toast }),
  dismissToast: () => set({ toast: null }),
}));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearStuckTimer();
    clearInstallTimer();
  });
}
