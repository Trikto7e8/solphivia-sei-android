/**
 * popupFrameGuards (261027): the main-window rules that keep the startup
 * popup frame on sei.gg/popup/ and send every other link to the default
 * browser. Electron is mocked; the handlers are driven the way Chromium
 * calls them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  opened: [] as string[],
  headersHandler: null as
    | null
    | ((details: Record<string, unknown>, cb: (r: Record<string, unknown>) => void) => void),
  headerPatterns: [] as string[],
}));

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.6.10' },
  net: { request: () => undefined },
  shell: {
    openExternal: async (url: string) => {
      h.opened.push(url);
    },
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: (filter: { urls: string[] }, fn: typeof h.headersHandler) => {
          h.headerPatterns = filter.urls;
          h.headersHandler = fn;
        },
      },
    },
  },
}));

vi.mock('./noticesStore', () => ({
  loadNoticesState: async () => ({
    version: 1,
    notices: [],
    announcedIds: [],
    readIds: [],
    popupShownIds: [],
  }),
  saveNoticesState: async () => undefined,
}));

type Listener = (...args: unknown[]) => void;

function fakeWindow() {
  const listeners = new Map<string, Listener>();
  const sent: string[] = [];
  let openHandler: ((d: { url: string }) => { action: string }) | null = null;
  const mainFrame = { url: 'http://localhost:5173/' };
  const wc = {
    id: 7,
    mainFrame,
    focusedFrame: mainFrame as { url: string } | null,
    on: (ev: string, fn: Listener) => listeners.set(ev, fn),
    send: (ch: string) => sent.push(ch),
    setWindowOpenHandler: (fn: typeof openHandler) => {
      openHandler = fn;
    },
  };
  return {
    win: { webContents: wc } as never,
    wc,
    sent,
    emit: (ev: string, ...args: unknown[]) => listeners.get(ev)?.(...args),
    open: (url: string) => openHandler?.({ url }),
  };
}

async function setup() {
  vi.resetModules();
  const guards = await import('./popupFrameGuards');
  const w = fakeWindow();
  guards.installPopupFrameGuards(w.win);
  return { guards, ...w };
}

const POPUP = 'https://sei.gg/popup/261101-halloween';

beforeEach(() => {
  h.opened = [];
  h.headersHandler = null;
});

describe('window.open and target=_blank', () => {
  it('is denied and the url goes to the default browser', async () => {
    const { open } = await setup();
    expect(open('https://sei.gg/download')).toEqual({ action: 'deny' });
    await Promise.resolve();
    expect(h.opened).toEqual(['https://sei.gg/download']);
  });

  it('drops a non-https url instead of opening it', async () => {
    const { open } = await setup();
    expect(open('file:///etc/passwd')).toEqual({ action: 'deny' });
    expect(open('javascript:alert(1)')).toEqual({ action: 'deny' });
    await Promise.resolve();
    expect(h.opened).toEqual([]);
  });
});

describe('subframe navigation lock', () => {
  const nav = (url: string, isMainFrame = false) => {
    const d = { url, isMainFrame, preventDefault: vi.fn() };
    return d;
  };

  it('lets the frame load a popup page or about:blank', async () => {
    const { emit } = await setup();
    for (const url of [POPUP, 'about:blank']) {
      const d = nav(url);
      emit('will-frame-navigate', d);
      expect(d.preventDefault).not.toHaveBeenCalled();
    }
    expect(h.opened).toEqual([]);
  });

  it('cancels any other subframe navigation and opens it externally', async () => {
    const { emit } = await setup();
    const d = nav('https://sei.gg/pricing');
    emit('will-frame-navigate', d);
    expect(d.preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    expect(h.opened).toEqual(['https://sei.gg/pricing']);
  });

  it('never touches the main frame', async () => {
    const { emit } = await setup();
    const d = nav('https://example.com/', true);
    emit('will-frame-navigate', d);
    expect(d.preventDefault).not.toHaveBeenCalled();
  });

  it('cancels a subframe redirect off the allow-list', async () => {
    const { emit } = await setup();
    const off = nav('https://evil.example/');
    emit('will-redirect', off);
    expect(off.preventDefault).toHaveBeenCalled();
    const on = nav('https://sei.gg/popup/other');
    emit('will-redirect', on);
    expect(on.preventDefault).not.toHaveBeenCalled();
  });
});

describe('framing headers', () => {
  const run = (details: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve) => h.headersHandler?.(details, resolve));

  it('only listens for popup urls on sei.gg in a packaged build', async () => {
    await setup();
    expect(h.headerPatterns).toEqual(['https://sei.gg/popup/*']);
  });

  it('drops X-Frame-Options and frame-ancestors for the popup subframe only', async () => {
    const { wc } = await setup();
    const responseHeaders = {
      'X-Frame-Options': ['SAMEORIGIN'],
      'Content-Security-Policy': ["default-src 'self'; frame-ancestors 'self'"],
      'Content-Type': ['text/html'],
    };
    const out = await run({
      url: POPUP,
      resourceType: 'subFrame',
      webContentsId: wc.id,
      responseHeaders,
    });
    expect(out).toEqual({
      responseHeaders: {
        'Content-Security-Policy': ["default-src 'self'"],
        'Content-Type': ['text/html'],
      },
    });

    // Another webContents, a top-level load, or a non-popup url keeps them.
    for (const d of [
      { url: POPUP, resourceType: 'subFrame', webContentsId: 99, responseHeaders },
      { url: POPUP, resourceType: 'mainFrame', webContentsId: wc.id, responseHeaders },
      { url: 'https://sei.gg/', resourceType: 'subFrame', webContentsId: wc.id, responseHeaders },
    ]) {
      expect(await run(d)).toEqual({});
    }
  });
});

describe('Esc relay', () => {
  const esc = { type: 'keyDown', key: 'Escape' };

  it('relays Esc only while focus is inside the popup page', async () => {
    const { emit, wc, sent } = await setup();
    emit('before-input-event', {}, esc);
    expect(sent).toEqual([]);

    wc.focusedFrame = { url: POPUP };
    emit('before-input-event', {}, { type: 'keyUp', key: 'Escape' });
    emit('before-input-event', {}, { type: 'keyDown', key: 'Enter' });
    expect(sent).toEqual([]);
    emit('before-input-event', {}, esc);
    expect(sent).toEqual(['app:startup-popup-escape']);

    wc.focusedFrame = { url: 'https://example.com/' };
    emit('before-input-event', {}, esc);
    expect(sent).toHaveLength(1);
  });
});

describe('load check', () => {
  it('is ok after a 2xx commit of the popup page, not after a 404', async () => {
    const { emit, guards } = await setup();
    emit('did-start-navigation', { url: POPUP, isMainFrame: false });
    emit('did-frame-navigate', {}, POPUP, 404, 'Not Found', false);
    expect(await guards.popupFrameLoadedOk(0)).toBe(false);

    emit('did-start-navigation', { url: POPUP, isMainFrame: false });
    emit('did-frame-navigate', {}, POPUP, 200, 'OK', false);
    expect(await guards.popupFrameLoadedOk(0)).toBe(true);

    // The main frame's own navigations do not count.
    emit('did-start-navigation', { url: 'http://localhost:5173/', isMainFrame: true });
    expect(await guards.popupFrameLoadedOk(0)).toBe(true);
  });
});
