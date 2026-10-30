/**
 * The call screen's interrupt shortcut (261030): Space, like a push-to-talk
 * key in the other direction. Pure so the gate is testable without a DOM.
 *
 * Never the shortcut: a held key's auto-repeat, any modifier chord, an event a
 * handler already took, and Space typed into a field or pressed on a focused
 * control (which is that control's own activation key, so the mute pill keeps
 * toggling on Space exactly as before).
 */

interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

export interface InterruptKeyEvent {
  code: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | KeyTarget | null;
}

function isTypingTarget(target: InterruptKeyEvent['target']): boolean {
  const el = target as KeyTarget | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/i.test(el.tagName)) return true;
  return el.getAttribute?.('role') === 'button';
}

export function isInterruptKey(e: InterruptKeyEvent): boolean {
  if (e.code !== 'Space' || e.repeat || e.defaultPrevented) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  return !isTypingTarget(e.target);
}
