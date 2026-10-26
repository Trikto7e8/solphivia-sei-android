/**
 * Tests for PlanButton, the big buy / upgrade button on the plan surfaces
 * (261023). Grep-style source checks, the project convention (no
 * @testing-library/react installed).
 *
 * Invariants:
 *   P.1 — reduced motion drops the lift, press and shine but keeps the colour
 *         transitions.
 *   P.2 — every checkout entry point renders a PlanButton: the plan cards, the
 *         credit packs and the usage-limit popup.
 *   P.3 — the recommended badge only shows on an upgrade target, so a Party
 *         subscriber's own card never reads "Recommended".
 *   P.4 — new labels have a zh translation.
 *   P.5 — flat and borderless (Shawn, 261027): no top highlight, no gradient
 *         band, no shadow under the primary, no border line on either kind.
 *   P.6 — the primary carries the old Summon glint (ef346069 .deployBtn), on a
 *         3.4s loop scaled by --flux, moved by transform, and not on a
 *         disabled button.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p: string): string => readFileSync(resolve(__dirname, p), 'utf-8');

const CSS = read('PlanButton.module.css');
const CREDITS = read('../screens/CreditsScreen.tsx');
const TOPUP = read('TopUpModal.tsx');
const HARDSTOP = read('HardStopModal.tsx');
const ZH = read('../lib/i18n/zh/screens-b.ts') + read('../lib/i18n/zh/modals.ts');

describe('PlanButton', () => {
  it('P.1 reduced motion removes movement and the shine', () => {
    const idx = CSS.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(idx).toBeGreaterThan(-1);
    const block = CSS.slice(idx);
    expect(block).toMatch(/transform:\s*none/);
    expect(block).toMatch(/\.primary::after\s*\{\s*display:\s*none/);
    expect(block).toMatch(/background-color 180ms/);
  });

  it('P.2 every checkout entry point uses PlanButton', () => {
    expect(CREDITS).toMatch(/<PlanButton[\s\S]*?onClick=\{\(\) => handlePlanSelect\(card\.tier/);
    expect(TOPUP).toMatch(/<PlanButton[\s\S]*?Buy for \{price\}/);
    expect(HARDSTOP).toMatch(/<PlanButton[^>]*onClick=\{handleUpgrade\}/);
    expect(HARDSTOP).toMatch(/<PlanButton[^>]*onClick=\{handleTopUp\}/);
  });

  it('P.3 the recommended badge is gated on an upgrade', () => {
    expect(CREDITS).toMatch(/card\.tier === RECOMMENDED_TIER && isUpgrade/);
  });

  it('P.4 new labels are translated to zh', () => {
    for (const key of ['Get {name}', 'Upgrade to {name}', 'Resume {name}', 'Recommended', 'Buy for {price}']) {
      expect(ZH).toContain(`'${key}':`);
    }
  });

  it('P.5 no top highlight, gradient band, shadow or border line', () => {
    const noReducedMotion = CSS.slice(0, CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(noReducedMotion).not.toMatch(/box-shadow/);
    expect(noReducedMotion).not.toMatch(/border-color/);
    expect(noReducedMotion).not.toMatch(/filter:/);
    // The only gradient left is the glint inside .primary::after.
    const gradients = noReducedMotion.match(/linear-gradient/g) ?? [];
    expect(gradients).toHaveLength(1);
    expect(noReducedMotion).toMatch(/\.primary::after\s*\{[^}]*linear-gradient/);
  });

  it('P.6 the old Summon glint loops on the primary', () => {
    expect(CSS).toMatch(/\.primary::after\s*\{[^}]*animation:\s*plan-glint calc\(3\.4s \/ var\(--flux, 1\)\)/);
    const keyframes = CSS.slice(CSS.indexOf('@keyframes plan-glint'));
    expect(keyframes).toMatch(/0%,\s*60%\s*\{\s*transform: translateX\(-115%\)/);
    expect(keyframes).toMatch(/85%,\s*100%\s*\{\s*transform: translateX\(250%\)/);
    expect(keyframes.slice(0, keyframes.indexOf('}\n}'))).not.toMatch(/left:/);
    expect(CSS).toMatch(/\.primary:disabled::after\s*\{\s*display:\s*none/);
  });
});
