/**
 * 261017 (issue #46): storage for "Continue with ChatGPT".
 *
 * - The credential vault: every saved registration (issued client_id +
 *   verified subject) with its token set, the active account and the
 *   welcome-notice flag, as ONE safeStorage-encrypted blob at
 *   `<profile>/chatgpt_accounts.bin` (tmp + rename, mode 0600). Same
 *   protection as the BYOK key (apiKeyStore.ts); never logged, never sent to
 *   the renderer (it gets ChatgptStatus, which has no tokens).
 * - The host id (`ext_agent_host_id`): a urn:uuid:v4 created once per machine
 *   before the first sign-in, at `<userData>/chatgpt-host-id.json`. Opaque
 *   and not a secret, so plain JSON.
 */
import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../paths';
import type { ChatgptVault, VaultData } from './session';
import { emptyVault, parseVault } from './session';

async function atomicWrite(target: string, data: Buffer | string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp.${process.pid}.${Date.now()}`);
  try {
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, target);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/** Rename an unreadable vault to `<name>.unreadable-<stamp>.bak`; never throws. */
export async function quarantineUnreadable(file: string): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${file}.unreadable-${stamp}.bak`;
  try {
    await rename(file, bak);
    return bak;
  } catch {
    return null;
  }
}

/** The safeStorage-backed vault for the ACTIVE profile (path read per call). */
export const electronVault: ChatgptVault = {
  key: () => paths.chatgptAccountsPath(),
  async load(): Promise<VaultData> {
    let buf: Buffer;
    try {
      buf = await readFile(paths.chatgptAccountsPath());
    } catch {
      return emptyVault();
    }
    try {
      return parseVault(JSON.parse(safeStorage.decryptString(buf)));
    } catch {
      // Undecryptable (keychain reset or locked, other machine's copy):
      // treat as no accounts rather than crashing every LLM call, but move
      // the file aside first so the next save never destroys it. A later
      // keychain fix can still recover the tokens (or at least the
      // registrations) from the .bak.
      await quarantineUnreadable(paths.chatgptAccountsPath());
      return emptyVault();
    }
  },
  async save(data: VaultData): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('KEYCHAIN_UNAVAILABLE');
    await atomicWrite(paths.chatgptAccountsPath(), safeStorage.encryptString(JSON.stringify(data)));
  },
};

const HOST_ID_RE = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let hostIdPromise: Promise<string> | null = null;

/** The stable host id, created and persisted on first use. */
export function getChatgptHostId(): Promise<string> {
  if (!hostIdPromise) {
    hostIdPromise = (async () => {
      const p = paths.chatgptHostIdPath();
      try {
        const raw = JSON.parse(await readFile(p, 'utf8')) as { host_id?: unknown };
        if (typeof raw.host_id === 'string' && HOST_ID_RE.test(raw.host_id)) return raw.host_id;
      } catch { /* missing or junk: create */ }
      const id = `urn:uuid:${randomUUID()}`;
      await atomicWrite(p, JSON.stringify({ host_id: id, created_at: new Date().toISOString() }));
      return id;
    })().catch((err) => {
      hostIdPromise = null;
      throw err;
    });
  }
  return hostIdPromise;
}
