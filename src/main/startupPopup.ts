/**
 * Startup popup (261027) — pure rules for the operator's one-page popup.
 *
 * Replaces the notices inbox in the UI. The same side-channel feed
 * (https://sei.gg/notices.json) gains an optional top-level `popup` object:
 *
 *   {
 *     "notices": [ ... ],                         // unchanged, old clients only
 *     "popup": {
 *       "id": "261101-halloween",                 // unique, never reused
 *       "url": "https://sei.gg/popup/261101-halloween",
 *       "width": 960, "height": 540,              // optional, CSS px of the page
 *       "minVersion": "0.6.10",                   // optional, inclusive
 *       "maxVersion": "0.7.0",                    // optional, inclusive
 *       "until": "2026-11-08T00:00:00Z"           // optional, hidden after this
 *     }
 *   }
 *
 * Old clients (0.6.9 and earlier) read only `notices` and ignore every other
 * key, so adding `popup` changes nothing for them.
 *
 * The page is shown in a sandboxed iframe in the renderer (see
 * components/StartupPopup.tsx and popupFrameGuards.ts). Only https://sei.gg
 * pages under /popup/ may be shown: the feed is operator-authored, but the
 * allow-list keeps a bad edit (or a compromised feed) from putting an
 * arbitrary site inside the app window.
 *
 * This module is electron-free so the rules are unit-testable.
 */
import semver from 'semver';

/** The one production origin popup pages may come from. */
export const POPUP_ORIGIN = 'https://sei.gg';
/** Popup pages live under this path, and only frames on it are trusted. */
export const POPUP_PATH_PREFIX = '/popup/';

/** Bounds for a page-declared size, in CSS px. Anything outside is ignored. */
const MIN_SIDE = 120;
const MAX_SIDE = 4000;
const MAX_ID_LEN = 200;

/** One popup the renderer may show. */
export interface StartupPopup {
  /** Unique id; a popup is shown at most once per install per id. */
  id: string;
  /** Page URL (already allow-listed). */
  url: string;
  /** The page's intended size in CSS px; the renderer scales it to fit. */
  width?: number;
  height?: number;
}

export interface PopupContext {
  /** app.getVersion(). */
  appVersion: string;
  /** Epoch ms, for `until`. */
  now: number;
  /**
   * Extra origins allowed in DEV only (the SEI_NOTICES_URL override's origin,
   * e.g. http://127.0.0.1:8765). Always empty in a packaged build.
   */
  devOrigins?: readonly string[];
}

/**
 * Whether `url` is a page the app may load in the popup frame: https on
 * exactly sei.gg (no port, no credentials) under /popup/, or the same path on
 * a dev origin. Anything unparseable is rejected.
 */
export function isAllowedPopupUrl(url: string, devOrigins: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (!u.pathname.startsWith(POPUP_PATH_PREFIX)) return false;
  if (u.origin === POPUP_ORIGIN) return true;
  return devOrigins.includes(u.origin);
}

function cleanVersion(raw: string): string | null {
  const v = raw.trim().replace(/^v/i, '');
  return semver.valid(v);
}

function side(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < MIN_SIDE || raw > MAX_SIDE) return null;
  return Math.round(raw);
}

/**
 * Coerce the feed's `popup` value into a StartupPopup for THIS client, or null
 * when there is nothing to show: missing, malformed, a disallowed url, outside
 * the version range, or past `until`. Fails closed: a version or date that
 * does not parse hides the popup rather than showing it everywhere.
 */
export function coerceStartupPopup(raw: unknown, ctx: PopupContext): StartupPopup | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.id !== 'string') return null;
  const id = o.id.trim();
  if (id.length === 0 || id.length > MAX_ID_LEN) return null;

  if (typeof o.url !== 'string' || !isAllowedPopupUrl(o.url, ctx.devOrigins)) return null;

  const app = cleanVersion(ctx.appVersion);
  if (o.minVersion !== undefined || o.maxVersion !== undefined) {
    if (!app) return null;
    if (o.minVersion !== undefined) {
      const min = typeof o.minVersion === 'string' ? cleanVersion(o.minVersion) : null;
      if (!min || semver.lt(app, min)) return null;
    }
    if (o.maxVersion !== undefined) {
      const max = typeof o.maxVersion === 'string' ? cleanVersion(o.maxVersion) : null;
      if (!max || semver.gt(app, max)) return null;
    }
  }

  if (o.until !== undefined) {
    const until = typeof o.until === 'string' ? Date.parse(o.until) : NaN;
    if (Number.isNaN(until) || ctx.now > until) return null;
  }

  const out: StartupPopup = { id, url: new URL(o.url).toString() };
  const w = side(o.width);
  const h = side(o.height);
  // A size is only useful as a pair (it sets the aspect ratio).
  if (w !== null && h !== null) {
    out.width = w;
    out.height = h;
  }
  return out;
}

/** The popup still owed to this install, or null once its id was shown. */
export function popupToShow(
  popup: StartupPopup | null,
  shownIds: readonly string[],
): StartupPopup | null {
  if (!popup) return null;
  return shownIds.includes(popup.id) ? null : popup;
}

/**
 * Tracks whether the popup frame's latest load actually committed a 2xx page.
 *
 * The iframe's `load` event fires for error pages too (offline, a 404 page,
 * a blocked response), and a cross-origin frame cannot be inspected from the
 * renderer, so main watches the frame's navigations and the renderer asks
 * before it reveals anything. That is what keeps a dead page from ever
 * showing as a blank overlay.
 */
export class PopupFrameTracker {
  private state: 'none' | 'pending' | 'ok' | 'failed' = 'none';

  constructor(private readonly isAllowed: (url: string) => boolean) {}

  /** A subframe started navigating. */
  onStart(url: string): void {
    if (this.isAllowed(url)) this.state = 'pending';
  }

  /** A subframe committed a page (did-frame-navigate). */
  onCommit(url: string, httpResponseCode: number): void {
    if (!this.isAllowed(url)) return;
    this.state = httpResponseCode >= 200 && httpResponseCode < 300 ? 'ok' : 'failed';
  }

  /** A subframe navigation failed (did-fail-provisional-load). */
  onFail(url: string): void {
    if (this.isAllowed(url)) this.state = 'failed';
  }

  /** True only when the latest popup-frame load committed a 2xx page. */
  loadedOk(): boolean {
    return this.state === 'ok';
  }
}
