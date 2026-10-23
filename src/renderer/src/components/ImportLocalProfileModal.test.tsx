/**
 * 261023: the own-key import offer has an existing-account variant (merge
 * copy, "Not now"), and every string it shows has a Chinese translation.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { window: unknown }).window = {
  sei: {},
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

const { ImportLocalProfileModal } = await import('./ImportLocalProfileModal');
const { ZH } = await import('../lib/i18n/zh');

const peek = (n: number) => ({
  migratableCharacterIds: Array.from({ length: n }, (_, i) => `id-${i}`),
  memoryOnlyCharacterIds: n === 0 ? ['m'] : [],
  mcUsername: null,
  preferredName: 'Boss',
  hasData: true,
  hasCompanionData: true,
});

function render(n: number, existingAccount: boolean): string {
  return renderToStaticMarkup(
    React.createElement(ImportLocalProfileModal, { peek: peek(n), existingAccount, onDone: () => undefined }),
  );
}

describe('ImportLocalProfileModal', () => {
  it('existing account: says nothing is replaced and offers "Not now"', () => {
    const html = render(2, true);
    expect(html).toContain('You have 2 companions on this computer from before you signed in.');
    expect(html).toContain('Nothing already in your account is replaced.');
    expect(html).toContain('Not now');
    expect(html).not.toContain('Start fresh');
  });

  it('new account keeps the original copy', () => {
    const html = render(1, false);
    expect(html).toContain('You set up 1 companion before signing in.');
    expect(html).toContain('Start fresh');
  });

  it('every existing-account string has a zh translation', () => {
    for (const key of [
      'You have 1 companion on this computer from before you signed in. Add it and its memories to this account? Nothing already in your account is replaced.',
      'You have {count} companions on this computer from before you signed in. Add them and their memories to this account? Nothing already in your account is replaced.',
      'You have companion memories on this computer from before you signed in. Add them to this account? Nothing already in your account is replaced.',
      'Not now',
    ]) {
      expect(ZH[key], key).toBeTruthy();
    }
  });
});
