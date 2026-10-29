/**
 * Startup popup actions, renderer side (261029): the chatgpt-plan action
 * mirrors what the ChatGPT row in Settings offers, and an unknown name does
 * nothing at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatgptSignInResult, ChatgptStatus } from '@shared/chatgptPlan';

const h = vi.hoisted(() => ({
  status: null as ChatgptStatus | null,
  signInCalls: [] as unknown[],
  signInResult: null as ChatgptSignInResult | null,
}));

vi.mock('./ipcClient', () => ({
  sei: {
    chatgptStatus: async () => h.status,
    onChatgptStatus: () => () => undefined,
    chatgptSignIn: async (opts: unknown) => {
      h.signInCalls.push(opts);
      return h.signInResult;
    },
  },
}));

const { planChatgptPlanAction, runPopupAction } = await import('./popupActions');
const { useChatgptStore } = await import('./stores/useChatgptStore');
const { useUiStore } = await import('./stores/useUiStore');

const acct = (signedIn: boolean, planEnabled: boolean) => ({
  id: 'a1',
  email: null,
  label: 'ChatGPT account',
  signedIn,
  planEnabled,
});
const status = (over: Partial<ChatgptStatus> = {}): ChatgptStatus => ({
  accounts: [],
  activeId: null,
  signingIn: false,
  usageLimited: false,
  blockedCode: null,
  welcomeSeen: true,
  models: [],
  ...over,
});
const ready = status({ accounts: [acct(true, true)], activeId: 'a1' });

describe('planChatgptPlanAction', () => {
  it('starts the sign-in when no ChatGPT account is connected', () => {
    expect(planChatgptPlanAction(status(), null)).toEqual({ kind: 'sign-in' });
    expect(planChatgptPlanAction(null, 'anthropic')).toEqual({ kind: 'sign-in' });
  });

  it('a signed-in plan not in use runs the switch (with its confirm), never a second sign-in', () => {
    expect(planChatgptPlanAction(ready, null)).toEqual({ kind: 'switch' });
    expect(planChatgptPlanAction(ready, 'anthropic')).toEqual({ kind: 'switch' });
  });

  it('already using the plan: only show the row', () => {
    expect(planChatgptPlanAction(ready, 'chatgpt')).toEqual({ kind: 'show' });
  });

  it('a sign-in already running: only show the row', () => {
    expect(planChatgptPlanAction(status({ signingIn: true }), null)).toEqual({ kind: 'show' });
  });

  it('plan picked but the account cannot run: re-sign that account', () => {
    expect(planChatgptPlanAction(status(), 'chatgpt')).toEqual({ kind: 'sign-in' });
    expect(
      planChatgptPlanAction(status({ accounts: [acct(false, true)], activeId: 'a1' }), 'chatgpt'),
    ).toEqual({ kind: 'sign-in', opts: { accountId: 'a1' } });
    expect(
      planChatgptPlanAction(status({ accounts: [acct(true, false)], activeId: 'a1' }), 'chatgpt'),
    ).toEqual({ kind: 'sign-in', opts: { accountId: 'a1', enablePlan: true } });
  });
});

describe('runPopupAction', () => {
  beforeEach(() => {
    h.status = null;
    h.signInCalls = [];
    h.signInResult = null;
    useChatgptStore.setState({ status: null });
    useUiStore.setState({ view: { kind: 'home' }, llmProvider: null });
  });

  it('ignores an unknown name: no navigation, no sign-in', async () => {
    for (const name of ['nope', '', 'CHATGPT-PLAN', null, 42, { kind: 'chatgpt-plan' }]) {
      expect(await runPopupAction(name)).toBe(false);
    }
    expect(useUiStore.getState().view).toEqual({ kind: 'home' });
    expect(h.signInCalls).toEqual([]);
  });

  it('chatgpt-plan, not connected: Settings at the row, starts the sign-in, then the switch', async () => {
    h.status = status();
    h.signInResult = { ok: true, status: ready, planEnabled: true };
    expect(await runPopupAction('chatgpt-plan')).toBe(true);
    expect(h.signInCalls).toEqual([undefined]);
    expect(useUiStore.getState().view).toEqual({ kind: 'settings', useChatgptPlan: true });
  });

  it('chatgpt-plan, sign-in cancelled: stays on the row, no switch', async () => {
    h.status = status();
    h.signInResult = { ok: false, reason: 'cancelled' };
    await runPopupAction('chatgpt-plan');
    expect(h.signInCalls).toHaveLength(1);
    expect(useUiStore.getState().view).toEqual({ kind: 'settings', focus: 'chatgpt-plan' });
  });

  it('chatgpt-plan, already signed in: the switch, no sign-in', async () => {
    h.status = ready;
    await runPopupAction('chatgpt-plan');
    expect(h.signInCalls).toEqual([]);
    expect(useUiStore.getState().view).toEqual({ kind: 'settings', focus: 'chatgpt-plan', useChatgptPlan: true });
  });

  it('chatgpt-plan, already using it: just shows the row', async () => {
    h.status = ready;
    useUiStore.setState({ llmProvider: 'chatgpt' });
    await runPopupAction('chatgpt-plan');
    expect(h.signInCalls).toEqual([]);
    expect(useUiStore.getState().view).toEqual({ kind: 'settings', focus: 'chatgpt-plan' });
  });

  it('does not switch a player who left Settings during the browser step', async () => {
    h.status = status();
    h.signInResult = { ok: true, status: ready, planEnabled: true };
    const origSignIn = useChatgptStore.getState().signIn;
    useChatgptStore.setState({
      signIn: async (opts) => {
        useUiStore.setState({ view: { kind: 'home' } });
        return origSignIn(opts);
      },
    });
    try {
      await runPopupAction('chatgpt-plan');
    } finally {
      useChatgptStore.setState({ signIn: origSignIn });
    }
    expect(useUiStore.getState().view).toEqual({ kind: 'home' });
  });
});
