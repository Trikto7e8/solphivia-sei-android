/**
 * Velopack startup hook for Windows (261030).
 *
 * Side-effect module. MUST be the second import of src/main/index.ts, right
 * after remoteDebugGuard: Velopack runs install/update/uninstall hooks by
 * launching Sei.exe with `--veloapp-*` arguments and expects the process to
 * handle them and exit within 15-30 s. ES module bodies evaluate in import
 * order, so `VelopackApp.run()` here exits a hook launch before the rest of
 * the main graph evaluates.
 *
 * Only active in a packaged win32 build. When the app was NOT installed by
 * Velopack (an NSIS install, or dev), `run()` logs "Error loading
 * manager/locator" and returns, and `velopackInstalled()` stays false, so the
 * same build keeps working under electron-updater. The NSIS -> Velopack
 * migration relies on that.
 *
 * Velopack's own apply-on-startup is OFF (it shows a stock progress dialog);
 * velopackUpdater.ts applies a pending update itself with Sei's update screen.
 *
 * Launch during an apply: when Update.exe is applying (packages\SeiStaged\
 * applying.pid names a live process) and this launch was not started by it,
 * Sei leaves a relaunch request and exits at once, so it neither blocks the
 * folder swap nor gets killed by it. The apply starts Sei when it is done.
 */
import { app } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { bundleRequire } from './bundleRequire';
import { applyInProgress, velopackPathsFor, type VelopackPaths } from './velopackFastApply';

/** Wall-clock time this module evaluated: the earliest JS point of a launch. */
export const velopackBootAt = Date.now();

/** Minimal structural types for the parts of the `velopack` package we use. */
export interface VelopackAsset {
  PackageId: string;
  Version: string;
  Type: string;
  FileName: string;
  Size: number;
  NotesMarkdown: string;
}
export interface VelopackUpdateInfo {
  TargetFullRelease: VelopackAsset;
  BaseRelease?: VelopackAsset;
  DeltasToTarget: VelopackAsset[];
  IsDowngrade: boolean;
}
export interface VelopackUpdateManager {
  getCurrentVersion(): string;
  getAppId(): string;
  isPortable(): boolean;
  getUpdatePendingRestart(): VelopackAsset | null;
  checkForUpdatesAsync(): Promise<VelopackUpdateInfo | null>;
  downloadUpdateAsync(update: VelopackUpdateInfo, progress?: (perc: number) => void): Promise<void>;
  waitExitThenApplyUpdate(
    update: VelopackUpdateInfo | VelopackAsset,
    silent?: boolean,
    restart?: boolean,
    restartArgs?: string[],
  ): void;
}
export interface VelopackModule {
  VelopackApp: {
    build(): {
      setLogger(cb: (level: string, msg: string) => void): unknown;
      onRestarted(cb: (v: string) => void): unknown;
      onFirstRun(cb: (v: string) => void): unknown;
      setAutoApplyOnStartup(autoApply: boolean): unknown;
      run(): void;
    };
  };
  UpdateManager: new (
    source: unknown,
    options?: { AllowVersionDowngrade?: boolean; ExplicitChannel?: string; MaximumDeltasBeforeFallback?: number },
  ) => VelopackUpdateManager;
  HttpSource: new (url: string) => unknown;
  FileSource: new (path: string) => unknown;
  GithubSource: new (repoUrl: string, accessToken?: string, prerelease?: boolean) => unknown;
}

let mod: VelopackModule | null = null;
let installed = false;
let restartedVersion: string | null = null;
let firstRunVersion: string | null = null;
let paths: VelopackPaths | null = null;

/** Append one line to <userData>/logs/velopack.log. Never throws. */
const VELOPACK_LOG_MAX_BYTES = 1024 * 1024;

export function velopackLog(line: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'velopack.log');
    try {
      // One update check is ~10 lines; keep the last ~1 MB plus one older file.
      if (statSync(file).size > VELOPACK_LOG_MAX_BYTES) renameSync(file, path.join(dir, 'velopack.old.log'));
    } catch {
      /* no file yet */
    }
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* best effort */
  }
}

/**
 * Timing marks for the Windows update CI harness (velopack-update.yml), one
 * JSON object per line in <userData>/velopack-ci.jsonl. Only written when
 * SEI_VELOPACK_CI=1, which nothing sets outside CI.
 */
export function ciMark(ev: string, extra: Record<string, unknown> = {}): void {
  if (process.env.SEI_VELOPACK_CI !== '1') return;
  try {
    const file = path.join(app.getPath('userData'), 'velopack-ci.jsonl');
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(
      file,
      JSON.stringify({ ev, t: Date.now(), pid: process.pid, version: app.getVersion(), ...extra }) + '\n',
    );
  } catch {
    /* best effort */
  }
}

if (process.env.SEI_VELOPACK_CI === '1') {
  // CI harness: time each window to its first paint-ready moment. Registered
  // at import time, before index.ts creates the main window.
  let n = 0;
  app.on('browser-window-created', (_e, win) => {
    const idx = n++;
    ciMark('window-created', { idx });
    win.once('ready-to-show', () => ciMark('window-ready-to-show', { idx }));
    win.once('show', () => ciMark('window-shown', { idx, w: win.getBounds().width }));
    win.webContents.once('did-finish-load', () =>
      ciMark('window-loaded', { idx, url: win.webContents.getURL().slice(0, 80) }),
    );
  });
}

/**
 * A random id for this install, kept in <userData>/update-install-id. userData
 * is shared by the NSIS and the Velopack copy, so both read the same id: the
 * migration and rollout buckets do not re-roll when the copy changes.
 */
export function userDataInstallId(): string {
  const file = path.join(app.getPath('userData'), 'update-install-id');
  try {
    const id = readFileSync(file, 'utf8').trim();
    if (id) return id;
  } catch {
    /* fall through */
  }
  const id = randomUUID();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, id);
  } catch {
    /* a fresh id per launch only makes the gates re-roll */
  }
  return id;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else (an elevated Update.exe)
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Exits this launch when Update.exe is applying right now (see the header). */
function leaveIfApplying(p: VelopackPaths): void {
  const marker = path.join(p.stageDir, 'applying.pid');
  let text: string | null = null;
  let mtime = 0;
  try {
    mtime = statSync(marker).mtimeMs;
    text = readFileSync(marker, 'utf8');
  } catch {
    return; // no apply running
  }
  if (!applyInProgress(text, mtime, Date.now(), pidAlive)) return;
  try {
    writeFileSync(path.join(p.stageDir, 'relaunch'), String(process.pid));
  } catch {
    /* the apply restarts Sei anyway when it was an in-app restart */
  }
  velopackLog(`launched during an update (Update.exe pid ${text.trim()}), leaving a relaunch request and exiting`);
  ciMark('left-during-apply', { updatePid: text.trim() });
  process.exit(0);
}

if (process.platform === 'win32' && app.isPackaged) {
  try {
    mod = bundleRequire()('velopack') as VelopackModule;
    const builder = mod.VelopackApp.build();
    // trace and debug carry hex dumps of every HTTP exchange.
    builder.setLogger((level, msg) => {
      if (level !== 'trace' && level !== 'debug') velopackLog(`[${level}] ${msg}`);
    });
    builder.onRestarted((v) => {
      restartedVersion = v;
    });
    builder.onFirstRun((v) => {
      firstRunVersion = v;
    });
    builder.setAutoApplyOnStartup(false);
    builder.run();
    // run() returned, so this is a normal launch (hooks exit inside run()).
    // An UpdateManager only constructs when a Velopack locator exists, i.e.
    // this copy was installed by Velopack's Setup.exe.
    try {
      new mod.UpdateManager(new mod.FileSource(app.getPath('temp')));
      installed = true;
    } catch {
      installed = false;
    }
    paths = installed ? velopackPathsFor(process.execPath) : null;
    ciMark('boot', { velopackInstalled: installed, restartedVersion, firstRunVersion, argv: process.argv.slice(1) });
    if (paths && restartedVersion === null) leaveIfApplying(paths);
  } catch (err) {
    velopackLog(`velopack boot failed: ${(err as Error).message}`);
    mod = null;
  }
}

/** The install layout (root, packages, Update.exe), when this is a Velopack install. */
export function velopackPaths(): VelopackPaths | null {
  return paths;
}

export function velopackModule(): VelopackModule | null {
  return mod;
}

/** True when this process runs from a Velopack install (not NSIS, not dev). */
export function velopackInstalled(): boolean {
  return installed;
}

export function velopackRestartedVersion(): string | null {
  return restartedVersion;
}
