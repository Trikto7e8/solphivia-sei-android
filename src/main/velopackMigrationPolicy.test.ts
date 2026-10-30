import { describe, expect, it } from 'vitest';
import {
  cleanupDecision,
  earlyBootAction,
  enoughDiskForMigration,
  installDecision,
  isWithin,
  MAX_CLEANUP_ATTEMPTS,
  MAX_INSTALL_ATTEMPTS,
  migrationAllowed,
  migrationBucket,
  nsisInstallFor,
  parseMigrationRule,
  parseMigrationState,
  parseSetupManifest,
  pinRetargetScript,
  REDIRECT_BOOT_GRACE_MS,
  safeToRemoveDir,
  setupUrls,
  uninstallArgs,
  velopackLaunchTarget,
  type MigrationState,
  type SetupManifest,
} from './velopackMigrationPolicy';

const env = {
  LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local',
  APPDATA: 'C:\\Users\\a\\AppData\\Roaming',
  USERPROFILE: 'C:\\Users\\a',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  SystemRoot: 'C:\\Windows',
};

const manifest: SetupManifest = {
  version: '0.7.0',
  tag: 'v0.7.0',
  file: 'Sei-win-Setup.exe',
  sha256: 'a'.repeat(64),
  size: 200_000_000,
};

function state(over: Partial<MigrationState>): MigrationState {
  return { phase: 'installed', attempts: 1, cleanupAttempts: 0, at: 1, ...over };
}

describe('parseMigrationRule / migrationAllowed', () => {
  it('needs a numeric percent, clamps it, defaults the epoch', () => {
    expect(parseMigrationRule({ percent: 150 })).toEqual({ percent: 100, epoch: 0 });
    expect(parseMigrationRule({ percent: 20, epoch: 2.7 })).toEqual({ percent: 20, epoch: 2 });
    expect(parseMigrationRule({})).toBeNull();
    expect(parseMigrationRule('x')).toBeNull();
  });

  it('is off without a rule or at 0%, on for everyone at 100%', () => {
    expect(migrationAllowed(null, 'id')).toBe(false);
    expect(migrationAllowed({ percent: 0, epoch: 0 }, 'id')).toBe(false);
    expect(migrationAllowed({ percent: 100, epoch: 0 }, 'id')).toBe(true);
  });

  it('samples about percent of installs, stably per install', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `install-${i}`);
    const allowed = ids.filter((id) => migrationAllowed({ percent: 25, epoch: 0 }, id)).length;
    expect(allowed).toBeGreaterThan(400);
    expect(allowed).toBeLessThan(600);
    expect(migrationBucket('x')).toBe(migrationBucket('x'));
  });
});

describe('parseSetupManifest / setupUrls', () => {
  it('accepts the release shape', () => {
    expect(parseSetupManifest({ ...manifest, sha256: 'A'.repeat(64) })).toEqual(manifest);
  });

  it('rejects paths, bad hashes and odd versions', () => {
    expect(parseSetupManifest({ ...manifest, file: '..\\evil.exe' })).toBeNull();
    expect(parseSetupManifest({ ...manifest, file: 'Sei.zip' })).toBeNull();
    expect(parseSetupManifest({ ...manifest, sha256: 'abc' })).toBeNull();
    expect(parseSetupManifest({ ...manifest, version: 'latest' })).toBeNull();
    expect(parseSetupManifest({ ...manifest, tag: '0.7.0' })).toBeNull();
    expect(parseSetupManifest({ ...manifest, size: 0 })).toBeNull();
  });

  it('tries the mirror first, then the GitHub release', () => {
    expect(setupUrls(manifest, 'https://dl.sei.gg/velopack/', 'https://github.com/sei-studio/sei')).toEqual([
      'https://dl.sei.gg/velopack/setup/v0.7.0/Sei-win-Setup.exe',
      'https://github.com/sei-studio/sei/releases/download/v0.7.0/Sei-win-Setup.exe',
    ]);
  });

  it('wants room for the download and the extracted app', () => {
    expect(enoughDiskForMigration(null, 1)).toBe(true);
    expect(enoughDiskForMigration(1024 ** 3, 200_000_000)).toBe(false);
    expect(enoughDiskForMigration(5 * 1024 ** 3, 200_000_000)).toBe(true);
  });
});

describe('nsisInstallFor', () => {
  const has = (files: string[]) => (p: string) => files.map((f) => f.toLowerCase()).includes(p.toLowerCase());

  it('finds a per-user NSIS install by its uninstaller', () => {
    const exe = 'C:\\Users\\a\\AppData\\Local\\Programs\\sei\\Sei.exe';
    expect(nsisInstallFor(exe, env, has(['C:\\Users\\a\\AppData\\Local\\Programs\\sei\\Uninstall Sei.exe']))).toEqual({
      dir: 'C:\\Users\\a\\AppData\\Local\\Programs\\sei',
      exe,
      uninstaller: 'C:\\Users\\a\\AppData\\Local\\Programs\\sei\\Uninstall Sei.exe',
      perMachine: false,
    });
  });

  it('marks a Program Files install per-machine', () => {
    const exe = 'C:\\Program Files\\Sei\\Sei.exe';
    expect(nsisInstallFor(exe, env, has(['C:\\Program Files\\Sei\\Uninstall Sei.exe']))?.perMachine).toBe(true);
  });

  it('ignores Velopack, portable and odd layouts', () => {
    expect(nsisInstallFor('C:\\Users\\a\\AppData\\Local\\Sei\\current\\Sei.exe', env, () => true)).toBeNull();
    expect(nsisInstallFor('D:\\Sei\\Sei.exe', env, () => false)).toBeNull();
    expect(nsisInstallFor('C:\\Users\\a\\AppData\\Local\\Sei\\x\\Sei.exe', env, () => true)).toBeNull();
  });
});

describe('paths', () => {
  it('compares Windows paths without case or trailing slashes', () => {
    expect(isWithin('C:\\A\\b\\', 'c:\\a')).toBe(true);
    expect(isWithin('C:\\A-b', 'C:\\A')).toBe(false);
  });

  it('prefers the launcher stub', () => {
    expect(velopackLaunchTarget('C:\\L\\Sei', () => true)).toBe('C:\\L\\Sei\\Sei.exe');
    expect(velopackLaunchTarget('C:\\L\\Sei', () => false)).toBe('C:\\L\\Sei\\current\\Sei.exe');
  });

  it('only deletes a folder named for Sei, never a root or a shell folder', () => {
    expect(safeToRemoveDir('C:\\Users\\a\\AppData\\Local\\Programs\\sei', env)).toBe(true);
    expect(safeToRemoveDir('C:\\Games\\My Sei', env)).toBe(true);
    expect(safeToRemoveDir('D:\\', env)).toBe(false);
    expect(safeToRemoveDir('D:\\Games', env)).toBe(false);
    expect(safeToRemoveDir('C:\\Users\\a\\AppData\\Local', env)).toBe(false);
    expect(safeToRemoveDir('C:\\Users\\a\\AppData\\Local\\Sei', env)).toBe(false);
    expect(safeToRemoveDir('C:\\Users\\a\\AppData\\Roaming\\Sei', env)).toBe(false);
    expect(safeToRemoveDir('C:\\Users\\sei', { ...env, USERPROFILE: 'C:\\Users\\sei' })).toBe(false);
  });
});

describe('uninstallArgs / pinRetargetScript', () => {
  it('keeps app data and the shortcuts', () => {
    expect(uninstallArgs('C:\\P\\sei')).toEqual(['/S', '--updated', '/KEEP_APP_DATA', '--keep-shortcuts', '_?=C:\\P\\sei']);
  });

  it('quotes paths for PowerShell and matches the folder, not a prefix of its name', () => {
    const s = pinRetargetScript("C:\\Games\\Bob's Sei\\", 'C:\\L\\Sei\\Sei.exe');
    expect(s).toContain("$old = 'C:\\Games\\Bob''s Sei\\'");
    expect(s).toContain("$new = 'C:\\L\\Sei\\Sei.exe'");
  });
});

describe('installDecision', () => {
  const base = {
    state: null,
    rule: { percent: 100, epoch: 0 },
    manifest,
    appVersion: '0.7.0',
    installId: 'id',
    updatePending: false,
    installingElsewhere: false,
  };

  it('installs a same or newer version when the server allows it', () => {
    expect(installDecision(base)).toEqual({ ok: true, attempt: 1, epoch: 0 });
    expect(installDecision({ ...base, appVersion: '0.7.0-beta.3' }).ok).toBe(true);
  });

  it('does nothing without a rule, a Setup, or with an older Setup', () => {
    expect(installDecision({ ...base, rule: null })).toEqual({ ok: false, reason: 'disabled' });
    expect(installDecision({ ...base, manifest: null })).toEqual({ ok: false, reason: 'no-setup' });
    expect(installDecision({ ...base, appVersion: '0.7.1' })).toEqual({ ok: false, reason: 'setup-older' });
  });

  it('waits for a downloaded NSIS update and for another running install', () => {
    expect(installDecision({ ...base, updatePending: true })).toEqual({ ok: false, reason: 'update-pending' });
    expect(installDecision({ ...base, state: state({ phase: 'installing' }), installingElsewhere: true })).toEqual({
      ok: false,
      reason: 'in-progress',
    });
  });

  it('retries a failed install up to the limit, and again after an epoch bump', () => {
    expect(installDecision({ ...base, state: state({ phase: 'failed', attempts: 1, epoch: 0 }) })).toEqual({ ok: true, attempt: 2, epoch: 0 });
    const spent = state({ phase: 'failed', attempts: MAX_INSTALL_ATTEMPTS, epoch: 0 });
    expect(installDecision({ ...base, state: spent })).toEqual({ ok: false, reason: 'gave-up' });
    expect(installDecision({ ...base, state: spent, rule: { percent: 100, epoch: 1 } })).toEqual({ ok: true, attempt: 1, epoch: 1 });
  });

  it('does not reinstall', () => {
    expect(installDecision({ ...base, state: state({ phase: 'installed' }) })).toEqual({ ok: false, reason: 'already' });
    expect(installDecision({ ...base, state: state({ phase: 'done' }) })).toEqual({ ok: false, reason: 'already' });
  });
});

describe('earlyBootAction', () => {
  const base = { now: 1_000_000, pidAlive: () => true, velopackExists: true, selfPid: 5 };

  it('a Velopack launch Setup started while the NSIS copy installs exits', () => {
    expect(earlyBootAction({ ...base, velopack: true, state: state({ phase: 'installing', pid: 9 }) }).kind).toBe('exit');
    expect(earlyBootAction({ ...base, velopack: true, pidAlive: () => false, state: state({ phase: 'installing', pid: 9 }) }).kind).toBe('none');
    expect(earlyBootAction({ ...base, velopack: true, state: state({ phase: 'installed' }) }).kind).toBe('none');
  });

  it('an NSIS launch after the migration hands off to Velopack', () => {
    expect(earlyBootAction({ ...base, velopack: false, state: state({ phase: 'installed' }) }).kind).toBe('redirect');
    expect(earlyBootAction({ ...base, velopack: false, state: state({ phase: 'done' }) }).kind).toBe('redirect');
    expect(earlyBootAction({ ...base, velopack: false, state: state({ phase: 'failed' }) }).kind).toBe('none');
    expect(earlyBootAction({ ...base, velopack: false, velopackExists: false, state: state({ phase: 'installed' }) }).kind).toBe('none');
  });

  it('stops handing off when the last hand-off never booted', () => {
    const recent = state({ phase: 'installed', redirectAt: base.now - 10_000 });
    expect(earlyBootAction({ ...base, velopack: false, state: recent }).kind).toBe('redirect-failed');
    expect(earlyBootAction({ ...base, velopack: false, state: { ...recent, velopackSeenAt: base.now - 5_000 } }).kind).toBe('redirect');
    const old = state({ phase: 'installed', redirectAt: base.now - REDIRECT_BOOT_GRACE_MS - 1 });
    expect(earlyBootAction({ ...base, velopack: false, state: old }).kind).toBe('redirect');
  });
});

describe('cleanupDecision', () => {
  it('runs the uninstaller a few times and keeps a per-machine copy', () => {
    expect(cleanupDecision(state({ nsisDir: 'C:\\P\\sei' }), true)).toBe('run');
    expect(cleanupDecision(state({ nsisDir: 'C:\\P\\sei', cleanupAttempts: MAX_CLEANUP_ATTEMPTS }), true)).toBe('gave-up');
    expect(cleanupDecision(state({ nsisDir: 'C:\\Program Files\\Sei', perMachine: true }), true)).toBe('keep');
  });

  it('is done when the NSIS copy is gone and skips anything not installed', () => {
    expect(cleanupDecision(state({ nsisDir: 'C:\\P\\sei' }), false)).toBe('done');
    expect(cleanupDecision(state({ phase: 'failed', nsisDir: 'C:\\P\\sei' }), true)).toBe('skip');
    expect(cleanupDecision(null, true)).toBe('skip');
  });
});

describe('parseMigrationState', () => {
  it('round-trips and drops junk', () => {
    const s = state({ nsisDir: 'C:\\P\\sei', pid: 3, epoch: 1, error: 'x' });
    expect(parseMigrationState(JSON.parse(JSON.stringify(s)))).toEqual({ ...s, perMachine: false, version: undefined, redirectAt: undefined, velopackSeenAt: undefined });
    expect(parseMigrationState({ phase: 'weird' })).toBeNull();
  });
});
