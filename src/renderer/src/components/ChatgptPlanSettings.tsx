/**
 * ChatgptPlanSettings — the ChatGPT plan rows in Settings → AI (261017,
 * issue #46). Two shapes:
 *
 * - `active` (the picked provider is the ChatGPT plan): the account picker
 *   (every saved registration, the active one marked, add another), sign out,
 *   the "Using ChatGPT plan" line with Manage usage, the paused-plan notice,
 *   and the enable path for a sign-in that did not grant plan usage.
 * - otherwise (another local provider, or the cloud backend): the "Use your
 *   ChatGPT plan" card from OpenAI's UI guidelines, with Continue with
 *   ChatGPT as the action when a sign-in is needed. Offered on every Sei
 *   plan, Free included, and worded as separate from Sei's own subscription
 *   and credits (OpenAI: "Distinguish ChatGPT plan usage from your app's own
 *   subscription or charges").
 *
 * Tokens never reach the renderer; this reads account summaries from
 * useChatgptStore only. The model picker below it is SettingsScreen's own.
 */
import React from 'react';
import type { ChatgptSignInFailure } from '@shared/chatgptPlan';
import { CHATGPT_HELP_URL, CHATGPT_USAGE_URL } from '@shared/chatgptPlan';
import { useT } from '../lib/i18n';
import { sei } from '../lib/ipcClient';
import { chatgptReady, useChatgptStore } from '../lib/stores/useChatgptStore';
import { Button } from './Button';
import { ChatgptLogo } from './ChatgptLogo';
import { ContinueWithChatGPTButton } from './ContinueWithChatGPTButton';
import settings from '../screens/SettingsScreen.module.css';
import styles from './ChatgptPlanSettings.module.css';

/** User-facing line for a failed sign-in ('cancelled' says nothing). */
export function signInFailureText(reason: ChatgptSignInFailure, t: (s: string) => string): string | null {
  switch (reason) {
    case 'cancelled':
      return null;
    case 'denied':
      return t('Sign-in was cancelled in ChatGPT.');
    case 'timeout':
      return t('Sign-in timed out. Try again.');
    case 'account_mismatch':
      return t('That is a different ChatGPT account. Sign in with the same account, or add it as a new account.');
    case 'network':
      return t('Could not reach ChatGPT. Check your connection and try again.');
    case 'keychain_unavailable':
      return t('Sei could not save your sign-in securely on this device.');
    case 'browser_failed':
      return t('Could not open your browser. Try again.');
    case 'port_unavailable':
      return t('Sei could not start its sign-in listener. Try again.');
    default:
      return t('Sign-in did not finish. Try again.');
  }
}

export function ChatgptPlanSettings({
  active,
  onUsePlan,
}: {
  active: boolean;
  /** Switch the provider to the ChatGPT plan (after a sign-in, or when one exists). */
  onUsePlan: () => Promise<void> | void;
}): React.ReactElement {
  const t = useT();
  const status = useChatgptStore((s) => s.status);
  const signInError = useChatgptStore((s) => s.signInError);
  const signOutUnconfirmed = useChatgptStore((s) => s.signOutUnconfirmed);
  const signIn = useChatgptStore((s) => s.signIn);
  const cancelSignIn = useChatgptStore((s) => s.cancelSignIn);
  const signOut = useChatgptStore((s) => s.signOut);
  const switchAccount = useChatgptStore((s) => s.switchAccount);
  const clearLimit = useChatgptStore((s) => s.clearLimit);

  const accounts = status?.accounts ?? [];
  const activeAcc = accounts.find((a) => a.id === status?.activeId) ?? null;
  const ready = chatgptReady(status);
  const signingIn = status?.signingIn === true;
  const errorLine = signInError ? signInFailureText(signInError, t) : null;
  const openUsage = (): void => void sei.openExternal(CHATGPT_USAGE_URL);
  const openHelp = (): void => void sei.openExternal(CHATGPT_HELP_URL);

  const startSignIn = async (opts?: { accountId?: string | null; enablePlan?: boolean }): Promise<void> => {
    const r = await signIn(opts);
    if (r?.ok && !active) await onUsePlan();
  };

  const signingInRow = signingIn ? (
    <div className={settings.row}>
      <span className={settings.label}>{t('Finish signing in with ChatGPT in your browser.')}</span>
      <Button kind="quiet" size="sm" onClick={cancelSignIn}>
        {t('Cancel')}
      </Button>
    </div>
  ) : null;

  const notices = (
    <>
      {errorLine ? (
        <p className={`${settings.helper} ${settings.helperError}`} role="alert">
          {errorLine}
        </p>
      ) : null}
      {signOutUnconfirmed ? (
        <p className={settings.helper} role="status">
          {t(
            'Signed out on this device, but Sei could not confirm the sign-out with ChatGPT. To be sure, disconnect Sei in your ChatGPT settings.',
          )}
        </p>
      ) : null}
    </>
  );

  if (!active) {
    // The invite card ("Use your ChatGPT plan"). Local mode only; the caller
    // decides where it shows.
    return (
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <ChatgptLogo size={18} />
          <span className={styles.cardTitle}>{t('Use your ChatGPT plan')}</span>
        </div>
        <p className={styles.cardBody}>
          {t('Complete eligible AI requests in this app with usage included in your ChatGPT plan or credits balance.')}{' '}
          {t("Works on every Sei plan, including Free. Usage counts toward your ChatGPT plan, not Sei's subscription or credits.")}{' '}
          <button type="button" className={settings.creditLink} onClick={openHelp}>
            {t('Learn more')}
          </button>
        </p>
        {ready ? (
          <div>
            <Button kind="primary" size="sm" onClick={() => void onUsePlan()}>
              {t('Use ChatGPT plan')}
            </Button>
          </div>
        ) : (
          <div>
            <ContinueWithChatGPTButton disabled={signingIn} busy={signingIn} onClick={() => void startSignIn()} />
          </div>
        )}
        {signingInRow}
        {notices}
      </div>
    );
  }

  // ── active: the ChatGPT plan is the picked provider ──
  if (!activeAcc || !activeAcc.signedIn) {
    return (
      <>
        <p className={settings.helper}>
          {activeAcc
            ? t('Your ChatGPT sign-in ended. Continue with ChatGPT to sign in again.')
            : t('Sign in with your ChatGPT account to use your plan in Sei. No API key needed.')}
        </p>
        <div className={styles.buttonRow}>
          <ContinueWithChatGPTButton
            disabled={signingIn}
            busy={signingIn}
            onClick={() => void startSignIn(activeAcc ? { accountId: activeAcc.id } : undefined)}
          />
        </div>
        {signingInRow}
        {notices}
        {accounts.length > 1 ? <AccountList /> : null}
      </>
    );
  }

  return (
    <>
      <div className={settings.row}>
        <span className={settings.label}>{t('ChatGPT account')}</span>
        <span className={settings.monoValue}>{activeAcc.label}</span>
        <Button kind="ghost" size="sm" disabled={signingIn} onClick={() => void signOut(activeAcc.id)}>
          {t('Sign out')}
        </Button>
      </div>
      {accounts.length > 1 ? <AccountList /> : null}
      <div className={settings.row}>
        <span className={settings.label}>{t('Other accounts')}</span>
        <Button kind="ghost" size="sm" disabled={signingIn} onClick={() => void startSignIn({ accountId: null })}>
          {t('Add account')}
        </Button>
      </div>
      {activeAcc.planEnabled ? (
        <div className={settings.row}>
          <span className={`${settings.label} ${styles.inUse}`}>
            <ChatgptLogo size={16} />
            {t('Using ChatGPT plan')}
          </span>
          <Button kind="ghost" size="sm" onClick={openUsage}>
            {t('Manage usage')}
          </Button>
        </div>
      ) : (
        <>
          <p className={`${settings.helper} ${settings.helperError}`} role="alert">
            {t('ChatGPT plan use was not turned on when you signed in, so Sei cannot use your plan yet.')}
          </p>
          <div className={styles.buttonRow}>
            <Button
              kind="primary"
              size="sm"
              disabled={signingIn}
              onClick={() => void startSignIn({ accountId: activeAcc.id, enablePlan: true })}
            >
              {t('Turn on ChatGPT plan')}
            </Button>
          </div>
        </>
      )}
      {status?.usageLimited ? (
        <div className={settings.row}>
          <span className={`${settings.label} ${settings.statusWarn}`}>
            {t('Usage limit reached. Requests are paused.')}
          </span>
          <Button kind="ghost" size="sm" onClick={() => void clearLimit()}>
            {t('Try again')}
          </Button>
        </div>
      ) : null}
      {status?.blockedCode ? <BlockedNotice code={status.blockedCode} /> : null}
      {signingInRow}
      {notices}
    </>
  );

  /**
   * A latched plan answer, with the action that lifts it: the dialog that
   * first showed it may be long closed, so this row is how a player gets
   * unstuck. A rejected sign-in needs a new sign-in; everything else gets
   * Try again (one attempt, the latch returns if the answer does).
   */
  function BlockedNotice({ code }: { code: string }): React.ReactElement {
    if (code === 'CHATGPT_AUTH_REJECTED') {
      return (
        <>
          <p className={`${settings.helper} ${settings.helperError}`} role="alert">
            {t("ChatGPT didn't accept Sei's sign-in, even after renewing it. Sign in again to keep using your plan.")}
          </p>
          <div className={styles.buttonRow}>
            <ContinueWithChatGPTButton
              disabled={signingIn}
              busy={signingIn}
              onClick={() => void startSignIn(activeAcc ? { accountId: activeAcc.id } : undefined)}
            />
          </div>
        </>
      );
    }
    const text =
      code === 'CHATGPT_REQUEST_REJECTED'
        ? t("ChatGPT didn't accept Sei's last request, so ChatGPT requests are paused.")
        : code === 'CHATGPT_FORBIDDEN'
          ? t("ChatGPT plan use isn't available here right now. It may be limited in your region or by your plan.")
          : t("This ChatGPT account can't use its plan in Sei right now. Try another account, or pick another provider.");
    return (
      <div className={settings.row}>
        <span className={`${settings.label} ${settings.statusWarn}`} role="alert">
          {text}
        </span>
        <Button kind="ghost" size="sm" onClick={() => void clearLimit()}>
          {t('Try again')}
        </Button>
      </div>
    );
  }

  function AccountList(): React.ReactElement {
    return (
      <div className={styles.accounts} role="list" aria-label={t('ChatGPT accounts')}>
        {accounts.map((a) => (
          <div key={a.id} className={styles.accountRow} role="listitem">
            <span className={settings.monoValue}>{a.label}</span>
            {a.id === status?.activeId ? (
              <span className={styles.activeMark}>{t('active')}</span>
            ) : a.signedIn ? (
              <Button kind="quiet" size="sm" onClick={() => void switchAccount(a.id)}>
                {t('Switch')}
              </Button>
            ) : (
              <Button kind="quiet" size="sm" disabled={signingIn} onClick={() => void startSignIn({ accountId: a.id })}>
                {t('Sign in')}
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  }
}
