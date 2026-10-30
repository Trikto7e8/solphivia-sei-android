/**
 * NSIS -> Velopack migration on Windows (261030). The plan and every rule are
 * in velopackMigrationPolicy.ts; this file runs them.
 *
 * Side-effect module, the THIRD import of src/main/index.ts (after
 * velopackBoot): `earlyBoot()` below runs before the single-instance lock.
 * Both copies share userData (%APPDATA%\Sei), so they share that lock, and a
 * launch that should not run (Setup starting the copy it just installed, or
 * an old NSIS shortcut after the migration) has to leave before taking it.
 *
 * State lives in <userData>/velopack-migration.json, written by both copies.
 *
 * CI (velopack-update.yml, migrate jobs) drives it with SEI_VELOPACK_CI=1 and
 * SEI_MIGRATION_FEED / SEI_MIGRATION_DELAY_MS / SEI_MIGRATION_CI_ACTION.
 */
import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ciMark, pidAlive, userDataInstallId, velopackInstalled, velopackLog } from './velopackBoot';
import {
  MAX_INSTALL_ATTEMPTS,
  MIGRATION_STATE_FILE,
  cleanupDecision,
  earlyBootAction,
  enoughDiskForMigration,
  installDecision,
  nsisInstallFor,
  parseMigrationRule,
  parseMigrationState,
  parseSetupManifest,
  pinRetargetScript,
  safeToRemoveDir,
  setupUrls,
  uninstallArgs,
  velopackLaunchTarget,
  velopackRootFor,
  type MigrationRule,
  type MigrationState,
  type NsisInstall,
  type SetupManifest,
  type WinEnv,
} from './velopackMigrationPolicy';

const DEFAULT_FEED = 'https://dl.sei.gg/velopack';
const GITHUB_REPO = 'https://github.com/sei-studio/sei';
/** The NSIS copy waits this long after launch before it looks at the feed. */
const START_DELAY_MS = 2 * 60 * 1000;
/** The Velopack copy waits this long before it removes the NSIS copy. */
const CLEANUP_DELAY_MS = 30 * 1000;
const SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const UNINSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;
/** How long a Velopack launch waits for the NSIS process that started it to exit. */
const HANDOFF_WAIT_MS = 30 * 1000;
/**
 * `Setup --silent` does not start the app it installed (measured in the spike),
 * but an interactive or future Setup might. The state stays `installing` this
 * long after it exits, so such a launch sees this copy still installing and
 * leaves instead of knocking on the single-instance lock (which would raise
 * this copy's window).
 */
const SETUP_APP_START_GRACE_MS = 5 * 1000;

const ci = process.env.SEI_VELOPACK_CI === '1';
const active = process.platform === 'win32' && app.isPackaged;

function log(line: string): void {
  velopackLog(`[migration] ${line}`);
}

function winEnv(): WinEnv {
  return process.env as WinEnv;
}

/* -------------------------------------------------------------------------- */
/*  State                                                                      */
/* -------------------------------------------------------------------------- */

function stateFile(): string {
  return path.join(app.getPath('userData'), MIGRATION_STATE_FILE);
}

export function readMigrationState(): MigrationState | null {
  try {
    return parseMigrationState(JSON.parse(readFileSync(stateFile(), 'utf8')));
  } catch {
    return null;
  }
}

function writeState(s: MigrationState): void {
  const file = stateFile();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ ...s, at: Date.now() }, null, 1));
    renameSync(tmp, file);
  } catch (err) {
    log(`state write failed: ${(err as Error).message}`);
  }
}

function patchState(patch: Partial<MigrationState>): MigrationState {
  const prev = readMigrationState() ?? { phase: 'failed' as const, attempts: 0, cleanupAttempts: 0, at: 0 };
  const next = { ...prev, ...patch };
  writeState(next);
  return next;
}

function velopackRoot(): string | null {
  const local = winEnv().LOCALAPPDATA;
  return local ? velopackRootFor(local) : null;
}

function velopackExe(): string | null {
  const root = velopackRoot();
  return root ? velopackLaunchTarget(root, existsSync) : null;
}

/** Synchronous sleep for the early boot, which runs before the event loop matters. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* -------------------------------------------------------------------------- */
/*  Early boot (import time, before the single-instance lock)                  */
/* -------------------------------------------------------------------------- */

function startVelopack(exe: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe), env }).unref();
}

function earlyBoot(): void {
  const velopack = velopackInstalled();
  if (velopack) {
    // A restart from the NSIS copy: let it finish exiting so its
    // single-instance lock is free before this one asks for it.
    const waitPid = Number(process.env.SEI_MIGRATION_WAIT_PID);
    delete process.env.SEI_MIGRATION_WAIT_PID;
    if (waitPid > 0) {
      const end = Date.now() + HANDOFF_WAIT_MS;
      while (pidAlive(waitPid) && Date.now() < end) sleepSync(100);
    }
  }
  const state = readMigrationState();
  const exe = velopackExe();
  const action = earlyBootAction({
    velopack,
    state,
    now: Date.now(),
    pidAlive,
    velopackExists: !!exe && existsSync(exe),
    selfPid: process.pid,
  });
  if (velopack && state && (state.phase === 'installed' || state.phase === 'done')) {
    // Proof for the NSIS copy that its last hand-off came up.
    writeState({ ...state, velopackSeenAt: Date.now() });
  }
  switch (action.kind) {
    case 'none':
      return;
    case 'exit':
      log(`launch exited early: ${action.reason}`);
      ciMark('migration-early-exit', { reason: action.reason });
      process.exit(0);
      return;
    case 'redirect': {
      log(`this NSIS copy was replaced; starting ${exe}`);
      ciMark('migration-redirect', { exe });
      writeState({ ...state!, redirectAt: Date.now() });
      try {
        startVelopack(exe!, process.argv.slice(1));
      } catch (err) {
        log(`redirect failed: ${(err as Error).message}; running this copy`);
        return;
      }
      process.exit(0);
      return;
    }
    case 'redirect-failed':
      // The Velopack copy was started a moment ago and never booted. Keep this
      // copy, put the shortcuts back on it, and stop trying for this epoch.
      log('the Velopack copy did not start after the last hand-off; staying on the NSIS copy');
      ciMark('migration-redirect-failed');
      writeState({
        ...state!,
        phase: 'failed',
        attempts: Math.max(state!.attempts, MAX_INSTALL_ATTEMPTS),
        error: 'velopack copy did not start',
      });
      void app.whenReady().then(() => {
        const root = velopackRoot();
        if (root) void runPowerShell(pinRetargetScript(root, process.execPath), 60_000);
      });
      return;
  }
}

if (active) {
  try {
    earlyBoot();
  } catch (err) {
    log(`early boot failed: ${(err as Error).message}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function powerShellExe(): string | null {
  const root = winEnv().SystemRoot ?? 'C:\\Windows';
  const exe = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(exe) ? exe : null;
}

function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ code: number | null; timedOut: boolean; error?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: { code: number | null; timedOut: boolean; error?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
      finish({ code: null, timedOut: true });
    }, timeoutMs);
    child.once('error', (err) => finish({ code: null, timedOut: false, error: err.message }));
    child.once('exit', (code) => finish({ code, timedOut: false }));
  });
}

async function runPowerShell(script: string, timeoutMs: number): Promise<string | null> {
  const exe = powerShellExe();
  if (!exe) return null;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  const r = await waitForExit(child, timeoutMs);
  return r.code === 0 ? out.trim() : null;
}

function freeBytes(dir: string): number | null {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

async function capture(event: string, props: Record<string, unknown>): Promise<void> {
  if (ci) return;
  try {
    const { loadAnalytics } = await import('./lazyAnalytics');
    (await loadAnalytics()).capture(event, props);
  } catch {
    /* analytics is best effort */
  }
}

function feedBase(): string {
  const override = ci ? process.env.SEI_MIGRATION_FEED : undefined;
  return (override || DEFAULT_FEED).replace(/\/+$/, '');
}

async function fetchJson(url: string): Promise<{ status: number; json: unknown }> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) return { status: res.status, json: null };
  return { status: res.status, json: await res.json() };
}

/** Downloads to `dest`, checking size and sha256. Throws on any mismatch. */
async function download(url: string, dest: string, m: SetupManifest): Promise<void> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const hash = createHash('sha256');
  const out = createWriteStream(dest);
  let size = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > m.size) throw new Error('larger than the manifest says');
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()));
  }
  if (size !== m.size) throw new Error(`size ${size}, expected ${m.size}`);
  const digest = hash.digest('hex');
  if (digest !== m.sha256) throw new Error(`sha256 ${digest.slice(0, 12)}, expected ${m.sha256.slice(0, 12)}`);
}

/* -------------------------------------------------------------------------- */
/*  NSIS side: install the Velopack copy                                       */
/* -------------------------------------------------------------------------- */

export interface MigrationDeps {
  /** An electron-updater (NSIS) update is downloaded and waiting. */
  isUpdateReady: () => boolean;
  /** Stop electron-updater and make the restart button start the Velopack copy. */
  handOff: (restart: () => void, version: string) => void;
}

let running = false;

function restartIntoVelopack(): void {
  const exe = velopackExe();
  if (!exe || !existsSync(exe)) {
    log('restart into Velopack: no Velopack copy, ignoring');
    return;
  }
  log(`restarting into ${exe}`);
  ciMark('migration-restart', { exe });
  startVelopack(exe, [], { ...process.env, SEI_MIGRATION_WAIT_PID: String(process.pid) });
  app.quit();
}

async function readRules(): Promise<{ rule: MigrationRule | null; manifest: SetupManifest | null; channel: string }> {
  let beta = false;
  try {
    const { loadConfig } = await import('./configStore');
    beta = (await loadConfig()).advanced_updates === true;
  } catch {
    /* stable */
  }
  const channel = beta ? 'beta' : 'win';
  const base = feedBase();
  const r = await fetchJson(`${base}/migration.${channel}.json`);
  const rule = r.status === 200 ? parseMigrationRule(r.json) : null;
  if (!rule || rule.percent <= 0) return { rule, manifest: null, channel };
  const s = await fetchJson(`${base}/setup.${channel}.json`);
  return { rule, manifest: s.status === 200 ? parseSetupManifest(s.json) : null, channel };
}

async function installVelopack(nsis: NsisInstall, deps: MigrationDeps): Promise<void> {
  const { rule, manifest, channel } = await readRules();
  const prior = readMigrationState();
  const installId = userDataInstallId();
  const decision = installDecision({
    state: prior,
    rule,
    manifest,
    appVersion: app.getVersion(),
    installId,
    updatePending: deps.isUpdateReady(),
    installingElsewhere: !!prior?.pid && prior.pid !== process.pid && pidAlive(prior.pid),
  });
  ciMark('migration-check', { decision, channel });
  if (!decision.ok) {
    log(`not migrating: ${decision.reason}`);
    return;
  }
  const m = manifest!;
  const local = winEnv().LOCALAPPDATA;
  if (!local) return;
  const tmp = path.join(app.getPath('temp'), `sei-migration-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmp, { recursive: true });
  if (!enoughDiskForMigration(freeBytes(tmp), m.size) || !enoughDiskForMigration(freeBytes(local), m.size)) {
    log('not migrating: low disk');
    ciMark('migration-check', { decision: { ok: false, reason: 'low-disk' } });
    rmSync(tmp, { recursive: true, force: true });
    return;
  }

  const base: MigrationState = {
    phase: 'installing',
    version: m.version,
    nsisDir: nsis.dir,
    perMachine: nsis.perMachine,
    pid: process.pid,
    epoch: decision.epoch,
    attempts: decision.attempt,
    cleanupAttempts: 0,
    at: Date.now(),
  };
  const fail = (error: string) => {
    log(`install failed: ${error}`);
    ciMark('migration-failed', { error });
    writeState({ ...base, phase: 'failed', pid: undefined, error });
    void capture('velopack_migration', { phase: 'failed', attempt: decision.attempt, error: error.slice(0, 80) });
  };

  // The Setup's process name is what CI's kill test looks for.
  const setup = path.join(tmp, 'sei-velopack-setup.exe');
  let fetched = false;
  for (const url of setupUrls(m, feedBase(), GITHUB_REPO)) {
    try {
      await download(url, setup, m);
      fetched = true;
      break;
    } catch (err) {
      log(`download from ${url} failed: ${(err as Error).message}`);
    }
  }
  if (!fetched) {
    fail('download failed');
    rmSync(tmp, { recursive: true, force: true });
    return;
  }

  writeState(base);
  ciMark('migration-installing', { version: m.version, attempt: decision.attempt });
  log(`installing Velopack ${m.version} (attempt ${decision.attempt})`);
  const child = spawn(setup, ['--silent'], { windowsHide: true, stdio: 'ignore', cwd: tmp });
  try {
    if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    /* a normal priority install is fine */
  }
  const r = await waitForExit(child, SETUP_TIMEOUT_MS);
  if (r.code === 0) await new Promise((res) => setTimeout(res, SETUP_APP_START_GRACE_MS));
  rmSync(tmp, { recursive: true, force: true });
  const root = velopackRootFor(local);
  const ok =
    r.code === 0 &&
    existsSync(path.join(root, 'current', 'Sei.exe')) &&
    existsSync(path.join(root, 'current', 'sq.version')) &&
    existsSync(path.join(root, 'Update.exe'));
  if (!ok) {
    fail(r.timedOut ? 'setup timed out' : r.error ? `setup: ${r.error}` : `setup exit ${r.code}`);
    return;
  }

  const target = velopackLaunchTarget(root, existsSync);
  const retargeted = await runPowerShell(pinRetargetScript(nsis.dir, target), 60_000);
  log(`installed; pins: ${retargeted ?? 'not retargeted'}`);
  writeState({ ...base, phase: 'installed', pid: undefined });
  ciMark('migration-installed', { version: m.version, pins: retargeted });
  void capture('velopack_migration', { phase: 'installed', attempt: decision.attempt, version: m.version });
  deps.handOff(restartIntoVelopack, m.version);
  if (ci && process.env.SEI_MIGRATION_CI_ACTION === 'restart') restartIntoVelopack();
}

/* -------------------------------------------------------------------------- */
/*  Velopack side: remove the NSIS copy                                        */
/* -------------------------------------------------------------------------- */

async function removeNsisCopy(): Promise<void> {
  const state = readMigrationState();
  const nsisDir = state?.nsisDir;
  const nsisExe = nsisDir ? path.join(nsisDir, 'Sei.exe') : null;
  const left = !!nsisExe && existsSync(nsisExe);
  const decision = cleanupDecision(state, left);
  ciMark('migration-cleanup-check', { decision });
  if (decision === 'done') {
    writeState({ ...state!, phase: 'done' });
    ciMark('migration-done');
    return;
  }
  if (decision !== 'run') {
    if (decision === 'keep' || decision === 'gave-up') log(`NSIS copy at ${nsisDir} left in place (${decision})`);
    return;
  }
  // Without PowerShell the NSIS uninstaller's running-app check falls back to
  // killing every Sei.exe by name, this one included.
  if (!powerShellExe()) {
    log('no PowerShell; leaving the NSIS copy in place');
    writeState({ ...state!, cleanupAttempts: Number.MAX_SAFE_INTEGER, error: 'no powershell' });
    return;
  }
  const s = patchState({ cleanupAttempts: state!.cleanupAttempts + 1 });
  const dir = nsisDir!;
  const root = velopackRoot();
  if (root) await runPowerShell(pinRetargetScript(dir, velopackLaunchTarget(root, existsSync)), 60_000);

  const uninstaller = path.join(dir, 'Uninstall Sei.exe');
  if (existsSync(uninstaller)) {
    const tmp = path.join(app.getPath('temp'), `sei-uninstall-${randomBytes(4).toString('hex')}`);
    try {
      mkdirSync(tmp, { recursive: true });
      const copy = path.join(tmp, 'Uninstall Sei.exe');
      copyFileSync(uninstaller, copy);
      const child = spawn(copy, uninstallArgs(dir), { windowsHide: true, stdio: 'ignore', cwd: tmp });
      const r = await waitForExit(child, UNINSTALL_TIMEOUT_MS);
      log(`NSIS uninstaller: ${r.timedOut ? 'timed out' : `exit ${r.code}`}${r.error ? ` (${r.error})` : ''}`);
    } catch (err) {
      log(`NSIS uninstaller failed: ${(err as Error).message}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  // The uninstaller leaves the folder behind when anything in it was in use
  // or was not its own; take it once it no longer holds Sei.
  if (existsSync(dir) && !existsSync(path.join(dir, 'Sei.exe')) && safeToRemoveDir(dir, winEnv())) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      log(`could not remove ${dir}: ${(err as Error).message}`);
    }
  }
  if (existsSync(path.join(dir, 'Sei.exe'))) {
    log(`NSIS copy still present after attempt ${s.cleanupAttempts}`);
    ciMark('migration-cleanup-failed', { attempt: s.cleanupAttempts });
    return;
  }
  writeState({ ...readMigrationState()!, phase: 'done', error: undefined });
  ciMark('migration-done', { dirLeft: existsSync(dir) });
  void capture('velopack_migration', { phase: 'cleaned', attempts: s.cleanupAttempts });
}

/* -------------------------------------------------------------------------- */
/*  Entry                                                                      */
/* -------------------------------------------------------------------------- */

function delay(fallback: number): number {
  const v = ci ? Number(process.env.SEI_MIGRATION_DELAY_MS) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Called once from bootstrap, after initUpdater. No-op outside a packaged Windows build. */
export function scheduleVelopackMigration(deps: MigrationDeps): void {
  if (!active) return;
  if (velopackInstalled()) {
    setTimeout(() => {
      void removeNsisCopy().catch((err) => log(`cleanup failed: ${(err as Error).message}`));
    }, delay(CLEANUP_DELAY_MS)).unref?.();
    return;
  }
  const nsis = nsisInstallFor(process.execPath, winEnv(), existsSync);
  if (!nsis) return;
  setTimeout(() => {
    if (running) return;
    running = true;
    void installVelopack(nsis, deps)
      .catch((err) => {
        log(`migration failed: ${(err as Error).message}`);
        ciMark('migration-failed', { error: (err as Error).message });
      })
      .finally(() => {
        running = false;
      });
  }, delay(START_DELAY_MS)).unref?.();
}
