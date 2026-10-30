import { describe, expect, it } from 'vitest';
import { isInterruptKey, type InterruptKeyEvent } from './interruptKey';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({
  tagName,
  isContentEditable: false,
  getAttribute: () => null,
  ...extra,
});

const key = (over: Partial<InterruptKeyEvent> = {}): InterruptKeyEvent => ({
  code: 'Space',
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  target: el('DIV'),
  ...over,
});

describe('isInterruptKey', () => {
  it('is a bare Space on the page', () => {
    expect(isInterruptKey(key())).toBe(true);
    expect(isInterruptKey(key({ target: el('BODY') }))).toBe(true);
    expect(isInterruptKey(key({ target: null }))).toBe(true);
  });

  it('ignores other keys, repeats, chords and handled events', () => {
    expect(isInterruptKey(key({ code: 'Enter' }))).toBe(false);
    expect(isInterruptKey(key({ repeat: true }))).toBe(false);
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(isInterruptKey(key({ [mod]: true }))).toBe(false);
    }
    expect(isInterruptKey(key({ defaultPrevented: true }))).toBe(false);
  });

  it('never steals Space from a field or a focused control', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'input']) {
      expect(isInterruptKey(key({ target: el(tag) }))).toBe(false);
    }
    expect(isInterruptKey(key({ target: el('DIV', { isContentEditable: true }) }))).toBe(false);
    expect(isInterruptKey(key({ target: el('DIV', { getAttribute: (n: string) => (n === 'role' ? 'button' : null) }) }))).toBe(false);
  });
});
