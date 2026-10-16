/**
 * ChatgptPlanHost — the app-wide ChatGPT-plan dialogs (261017, issue #46).
 * Mounted once in App.tsx; subscribes the store to main's status push.
 *
 * Two dialogs from OpenAI's UI guidelines:
 * - the one-time welcome, "You're using your ChatGPT plan", shown after the
 *   first successful plan sign-in (welcomeSeen is persisted in main), with a
 *   single "Got it";
 * - "Usage limit reached", opened when a request comes back limited. Manage
 *   usage (chatgpt.com/settings/usage) is the primary action. Main pauses
 *   plan requests while the limit stands (no retry storm); Try again lifts
 *   the pause for one attempt.
 */
import React, { useEffect } from 'react';
import { CHATGPT_USAGE_URL } from '@shared/chatgptPlan';
import { useT } from '../lib/i18n';
import { sei } from '../lib/ipcClient';
import { chatgptReady, useChatgptStore } from '../lib/stores/useChatgptStore';
import { Button } from './Button';
import { ChatgptLogo } from './ChatgptLogo';
import { ModalFooter, ModalShell } from './ModalShell';
import styles from './ChatgptPlanHost.module.css';

export function ChatgptPlanHost(): React.ReactElement | null {
  const t = useT();
  const status = useChatgptStore((s) => s.status);
  const limitDialog = useChatgptStore((s) => s.limitDialog);
  const dismissWelcome = useChatgptStore((s) => s.dismissWelcome);
  const clearLimit = useChatgptStore((s) => s.clearLimit);
  const closeLimitDialog = useChatgptStore((s) => s.closeLimitDialog);

  useEffect(() => {
    const store = useChatgptStore.getState();
    const off = store.subscribe();
    void store.load();
    return off;
  }, []);

  if (limitDialog && status?.usageLimited) {
    return (
      <ModalShell title={t('Usage limit reached')} width={420} onClose={closeLimitDialog} tier="stacked">
        <p className={styles.body}>
          {t(
            "You've used the ChatGPT plan usage available to Sei for now. Check Manage usage to see when it resets. Sei pauses ChatGPT requests until then.",
          )}
        </p>
        <ModalFooter>
          <Button kind="quiet" onClick={() => void clearLimit()}>
            {t('Try again')}
          </Button>
          <Button kind="primary" onClick={() => void sei.openExternal(CHATGPT_USAGE_URL)}>
            {t('Manage usage')}
          </Button>
        </ModalFooter>
      </ModalShell>
    );
  }

  if (status && chatgptReady(status) && !status.welcomeSeen) {
    return (
      <ModalShell title={null} width={400} escClose={false} tier="stacked" aria-label={t("You're using your ChatGPT plan")}>
        <div className={styles.welcomeHead}>
          <ChatgptLogo size={28} />
          <h3 className={styles.welcomeTitle}>{t("You're using your ChatGPT plan")}</h3>
        </div>
        <p className={styles.body}>
          {t(
            'Your companions now run on your ChatGPT plan. Eligible requests count toward your plan usage or credits balance, not Sei credits.',
          )}
        </p>
        <ModalFooter>
          <Button kind="primary" onClick={() => void dismissWelcome()}>
            {t('Got it')}
          </Button>
        </ModalFooter>
      </ModalShell>
    );
  }

  return null;
}
