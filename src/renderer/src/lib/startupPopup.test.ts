/**
 * Startup popup renderer rules (261027): when it may open, and its size.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { popupCardSize, popupUiReady, type PopupUi } from './startupPopup';

const calm: PopupUi = { viewKind: 'home', modalOpen: false, tourActive: false, liveSession: false };

describe('popupUiReady', () => {
  it('opens on a calm screen', () => {
    for (const viewKind of ['home', 'character', 'awaken', 'settings', 'credits', 'coming-soon']) {
      expect(popupUiReady({ ...calm, viewKind })).toBe(true);
    }
  });

  it('waits during onboarding, a game route or another surface', () => {
    for (const viewKind of ['onboard', 'draw', 'skin-setup', 'call', 'chat']) {
      expect(popupUiReady({ ...calm, viewKind })).toBe(false);
    }
  });

  it('waits while a modal, a tour or a live session is up', () => {
    expect(popupUiReady({ ...calm, modalOpen: true })).toBe(false);
    expect(popupUiReady({ ...calm, tourActive: true })).toBe(false);
    expect(popupUiReady({ ...calm, liveSession: true })).toBe(false);
  });
});

describe('popupCardSize', () => {
  it('defaults to 70% of the window each way', () => {
    expect(popupCardSize(1400, 900)).toEqual({ width: 980, height: 630 });
  });

  it('keeps a declared size that fits', () => {
    expect(popupCardSize(1400, 900, 800, 450)).toEqual({ width: 800, height: 450 });
  });

  it('scales a too-big page down, keeping its aspect ratio', () => {
    const s = popupCardSize(1280, 800, 1920, 1080);
    // max box: min(0.9*1280, 1280-48)=1152 x min(0.86*800, 800-48)=688
    expect(s.width).toBeLessThanOrEqual(1152);
    expect(s.height).toBeLessThanOrEqual(688);
    expect(s.width / s.height).toBeCloseTo(1920 / 1080, 2);
    expect(s).toEqual({ width: 1152, height: 648 });
  });

  it('never scales a small page up', () => {
    expect(popupCardSize(2560, 1440, 400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('keeps a click-out margin on a tiny window', () => {
    const s = popupCardSize(400, 300);
    expect(s.width).toBeLessThanOrEqual(400 - 48);
    expect(s.height).toBeLessThanOrEqual(300 - 48);
    expect(s.width).toBeGreaterThan(0);
  });

  it('ignores a half or non-positive size', () => {
    expect(popupCardSize(1000, 1000, 800)).toEqual({ width: 700, height: 700 });
    expect(popupCardSize(1000, 1000, 0, 500)).toEqual({ width: 700, height: 700 });
  });
});

describe('StartupPopup frame (source pins)', () => {
  const src = readFileSync(resolve(__dirname, '../components/StartupPopup.tsx'), 'utf-8');

  it('sandboxes the page with links only: no scripts, forms or same-origin', () => {
    expect(src).toContain('sandbox="allow-popups"');
    expect(src).not.toMatch(/allow-scripts|allow-same-origin|allow-forms|allow-top-navigation/);
    expect(src).toContain('referrerPolicy="no-referrer"');
  });

  it('reveals only after main confirms the load, and closes on X, Esc and outside', () => {
    expect(src).toContain('.startupPopupLoaded(popup.id)');
    expect(src).toContain("ok ? { popup, phase: 'shown' } : null");
    expect(src).toContain("e.key === 'Escape'");
    // Esc with focus inside the page arrives from main's relay.
    expect(src).toContain('sei.onStartupPopupEscape(closeUnlessCovered)');
    expect(src).toContain('e.target === e.currentTarget');
    expect(src).toContain("aria-label={t('Close')}");
  });

  it('runs a popup action only while shown, closing first', () => {
    expect(src).toContain('sei.onStartupPopupAction((action) => {');
    expect(src).toMatch(/onStartupPopupAction\(\(action\) => \{\s*close\(\);\s*void runPopupAction\(action\);/);
  });

  it('never looks in a first-run session, and reads the saved tour first', () => {
    expect(src).toContain('!isFirstRunSession() && isCalmRef.current()');
    expect(src).toContain('if (cfg.tutorial_state) markFirstRunSession();');
    expect(src).toContain('if (!owed || !bootChecked || active || tried.current.has(owed.id)) return;');
  });

  it('leaves Esc to a dialog raised over the popup', () => {
    expect(src).toContain("e.key === 'Escape' && !otherModalOpen(scrimRef.current)");
  });
});

describe('StartupPopup styles (source pins)', () => {
  const css = readFileSync(resolve(__dirname, '../components/StartupPopup.module.css'), 'utf-8');
  const block = (sel: string): string => {
    const m = css.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`));
    return m ? m[1] : '';
  };

  it('sits on the base modal tier so later dialogs land above it', () => {
    expect(block('.scrim')).toMatch(/z-index:\s*1000;/);
  });

  it('puts the X inside the page corner, 28-32 px, with no border', () => {
    const close = block('.close');
    expect(close).toMatch(/top:\s*14px;/);
    expect(close).toMatch(/right:\s*14px;/);
    const size = Number(close.match(/width:\s*(\d+)px;/)?.[1]);
    expect(size).toBeGreaterThanOrEqual(28);
    expect(size).toBeLessThanOrEqual(32);
    expect(close).toMatch(/border:\s*none;/);
    expect(css).toContain('.close:hover');
  });
});
