/**
 * ImportLocalProfileModal — offered on a sign-in from the anonymous `local`
 * (own key) profile (260603 per-profile partitioning; 261023 existing accounts).
 *
 * With per-profile partitioning, everything built while signed out stays in
 * the `local` profile when the player signs in. This modal offers to bring it
 * across: their companions (own ones, plus World companions and Sui they had
 * added), the companions' memories, and the name they already entered.
 *
 *   - New account: "Start fresh" declines and goes to onboarding.
 *   - Existing account (261023): the merge adds to the account and replaces
 *     nothing in it. "Not now" leaves the companions on this computer, where
 *     they are offered again on the next sign-in from it.
 *
 * Never offered account→account, so switching between accounts starts fresh.
 *
 * Renders through ModalShell; dismissal is button-only (choice is required).
 */
import React, { useState } from 'react';
import { sei } from '../lib/ipcClient';
import { useT } from '../lib/i18n';
import { Button } from './Button';
import { ModalShell, ModalFooter } from './ModalShell';
import type { PeekLocalProfileResult } from '../../../shared/ipc';
import styles from './confirmModal.module.css';

export interface ImportLocalProfileModalProps {
  peek: PeekLocalProfileResult;
  /** The account already has a profile: merge copy + "Not now". */
  existingAccount?: boolean;
  /** Called after the user chooses. `didImport` = the local data was imported. */
  onDone: (didImport: boolean) => void;
}

export function ImportLocalProfileModal({ peek, existingAccount = false, onDone }: ImportLocalProfileModalProps): React.ReactElement {
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const count = peek.migratableCharacterIds.length;

  async function handleImport(): Promise<void> {
    setSubmitting(true);
    try {
      await sei.profileImportFromLocal();
    } catch {
      // Best-effort — even on partial failure we proceed; the user can still
      // continue into the account (whatever imported is now theirs).
    } finally {
      onDone(true);
    }
  }

  return (
    <ModalShell title={t('Bring your companion to this account?')} escClose={false}>
      <p className={styles.body}>
        {existingAccount
          ? count > 0
            ? count === 1
              ? t(
                  'You have 1 companion on this computer from before you signed in. Add it and its memories to this account? Nothing already in your account is replaced.',
                )
              : t(
                  'You have {count} companions on this computer from before you signed in. Add them and their memories to this account? Nothing already in your account is replaced.',
                  { count },
                )
            : t(
                'You have companion memories on this computer from before you signed in. Add them to this account? Nothing already in your account is replaced.',
              )
          : count > 0
            ? count === 1
              ? t(
                  'You set up 1 companion before signing in. Bring it, along with your memories together, into this account, or start fresh.',
                )
              : t(
                  'You set up {count} companions before signing in. Bring them, along with your memories together, into this account, or start fresh.',
                  { count },
                )
            : t('Bring your existing setup into this account, or start fresh.')}
      </p>
      {submitting ? (
        <p className={styles.status}>{t('Importing…')}</p>
      ) : (
        <ModalFooter>
          <Button kind="ghost" onClick={() => onDone(false)}>
            {existingAccount ? t('Not now') : t('Start fresh')}
          </Button>
          <Button kind="primary" onClick={() => void handleImport()}>
            {t('Bring it over')}
          </Button>
        </ModalFooter>
      )}
    </ModalShell>
  );
}
