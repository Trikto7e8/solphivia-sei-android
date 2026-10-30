/**
 * Small helpers for running Windows PowerShell and child processes from main
 * (shared by the Velopack migration and the Velopack updater). Windows only in
 * practice: powerShellExe() is null anywhere else.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function powerShellExe(): string | null {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  const exe = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(exe) ? exe : null;
}

export interface ExitResult {
  code: number | null;
  timedOut: boolean;
  error?: string;
}

export function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<ExitResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: ExitResult): void => {
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

/**
 * Runs a script with -EncodedCommand (so nothing in it needs quoting) and
 * returns its stdout, or null when PowerShell is missing, failed to start,
 * timed out or exited non-zero. `env` is added to this process's environment:
 * pass paths through it rather than pasting them into the script.
 */
export async function runPowerShell(
  script: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<string | null> {
  const exe = powerShellExe();
  if (!exe) return null;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: env ? { ...process.env, ...env } : process.env,
    });
  } catch {
    return null;
  }
  let out = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (d: string) => (out += d));
  const r = await waitForExit(child, timeoutMs);
  return r.code === 0 ? out.trim() : null;
}
