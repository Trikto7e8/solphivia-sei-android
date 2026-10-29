/**
 * Startup popup actions, renderer side (261029).
 *
 * A popup page's button is a link to https://sei.gg/popup/_action/<name>.
 * Main intercepts the click (popupFrameGuards.ts), checks the name against
 * POPUP_ACTIONS (src/shared/popupActions.ts) and pushes it here;
 * StartupPopup closes the popup and calls runPopupAction. The name is checked
 * again on this side, and a name without a case below does nothing.
 *
 * Each action reuses the path the app's own button for the same thing takes,
 * so a popup can never do anything the user could not do with one click in
 * the app.
 *
 *   chatgpt-plan  Settings, scrolled to the ChatGPT plan row (view.focus),
 *                 then whatever that row's own button would do right now:
 *                 - not signed in to ChatGPT: start "Continue with ChatGPT"
 *                   (the browser sign-in; Settings shows the "finish in your
 *                   browser" line with Cancel), and once it succeeds run the
 *                   same "Use ChatGPT plan" switch the row runs;
 *                 - signed in, plan not in use: the "Use ChatGPT plan" switch
 *                   (view.useChatgptPlan: the cloud -> local confirm, or just
 *                   the provider pick on the local backend). Nothing switches
 *                   away from Sei credits without that confirm;
 *                 - already using the plan, or a sign-in already running:
 *                   only show the row.
 */
import type { ChatgptStatus } from '@shared/chatgptPlan';
import { isPopupAction } from '@shared/popupActions';
import { chatgptReady, useChatgptStore } from './stores/useChatgptStore';
import { useUiStore } from './stores/useUiStore';

/** What the chatgpt-plan action does, given the plan status and provider. */
export type ChatgptPlanStep =
  /** Already in use, or a sign-in is already running: just show the row. */
  | { kind: 'show' }
  /** Signed in with plan usage: run the "Use ChatGPT plan" switch. */
  | { kind: 'switch' }
  /** Start the sign-in the visible button would start. */
  | { kind: 'sign-in'; opts?: { accountId?: string | null; enablePlan?: boolean } };

/**
 * Pure: mirror what the ChatGPT row in Settings offers for this status (see
 * ChatgptPlanSettings). `provider` is the local provider in use
 * (useUiStore.llmProvider), 'chatgpt' when the plan is already picked.
 */
export function planChatgptPlanAction(status: ChatgptStatus | null, provider: string | null): ChatgptPlanStep {
  if (status?.signingIn) return { kind: 'show' };
  const usingPlan = provider === 'chatgpt';
  if (chatgptReady(status)) return usingPlan ? { kind: 'show' } : { kind: 'switch' };
  if (!usingPlan) return { kind: 'sign-in' };
  // The plan is picked but cannot run: the row's "active" shape.
  const acc = status?.accounts.find((a) => a.id === status.activeId) ?? null;
  if (!acc) return { kind: 'sign-in' };
  if (!acc.signedIn) return { kind: 'sign-in', opts: { accountId: acc.id } };
  return { kind: 'sign-in', opts: { accountId: acc.id, enablePlan: true } };
}

async function runChatgptPlan(): Promise<void> {
  const ui = useUiStore.getState();
  const chatgpt = useChatgptStore.getState();
  // The host loads the status at mount; a popup can beat that load.
  if (!chatgpt.status) await chatgpt.load();
  const step = planChatgptPlanAction(useChatgptStore.getState().status, ui.llmProvider);
  ui.navigate({ kind: 'settings', focus: 'chatgpt-plan', ...(step.kind === 'switch' ? { useChatgptPlan: true } : {}) });
  if (step.kind !== 'sign-in') return;
  const res = await useChatgptStore.getState().signIn(step.opts);
  // Like the row's own button: a sign-in that worked goes on to the switch.
  // Only while the player is still on Settings; one who wandered off during
  // the browser step keeps their place and finds the "Use ChatGPT plan"
  // button on the row.
  const now = useUiStore.getState();
  if (res?.ok && now.view.kind === 'settings' && now.llmProvider !== 'chatgpt') {
    now.navigate({ kind: 'settings', useChatgptPlan: true });
  }
}

/**
 * Run a popup action by name. Returns whether the name was an action this
 * build knows (unknown names do nothing). Never throws.
 */
export async function runPopupAction(name: unknown): Promise<boolean> {
  if (!isPopupAction(name)) return false;
  try {
    switch (name) {
      case 'chatgpt-plan':
        await runChatgptPlan();
        return true;
      default:
        return false;
    }
  } catch {
    // The store calls already swallow their errors; this is a backstop so a
    // popup click can never surface an unhandled rejection.
    return true;
  }
}
