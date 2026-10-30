// CI-only diagnostic (261030): which node spawn options let powershell.exe run
// a script on a Windows runner. Each variant runs a tiny script that writes a
// marker file and sleeps 3 s; we report the exit code, how long it lived, and
// whether the script body ran at all. Usage: node spawn-diag.cjs
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ps = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sei-spawn-diag-'));
const script = path.join(dir, 't.ps1');
fs.writeFileSync(script, "param([string]$Out)\r\n[IO.File]::WriteAllText($Out, 'ran')\r\nStart-Sleep -Seconds 3\r\n", 'ascii');

const base = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA'];
const variants = [
  { name: 'detached+ignore+hide (shipped)', args: [...base, '-NonInteractive'], opts: { detached: true, stdio: 'ignore', windowsHide: true } },
  { name: 'detached+ignore', args: [...base, '-NonInteractive'], opts: { detached: true, stdio: 'ignore' } },
  { name: 'detached+ignore+hide, no -NonInteractive', args: base, opts: { detached: true, stdio: 'ignore', windowsHide: true } },
  { name: 'attached+ignore+hide', args: [...base, '-NonInteractive'], opts: { stdio: 'ignore', windowsHide: true } },
  { name: 'detached+pipe+hide', args: [...base, '-NonInteractive'], opts: { detached: true, stdio: 'pipe', windowsHide: true } },
  { name: 'attached+pipe+hide', args: [...base, '-NonInteractive'], opts: { stdio: 'pipe', windowsHide: true } },
];

function run(v, i) {
  return new Promise((resolve) => {
    const out = path.join(dir, `ran-${i}.txt`);
    const t0 = Date.now();
    let err = '';
    let stdout = '';
    const child = spawn(ps, [...v.args, '-File', script, '-Out', out], { cwd: dir, ...v.opts });
    if (child.stderr) child.stderr.on('data', (d) => (err += d));
    if (child.stdout) child.stdout.on('data', (d) => (stdout += d));
    const timer = setTimeout(() => {
      resolve({ name: v.name, result: 'still running after 6 s', ran: fs.existsSync(out) });
      try { child.kill(); } catch { /* gone */ }
    }, 6000);
    child.once('error', (e) => { clearTimeout(timer); resolve({ name: v.name, result: `spawn error ${e.message}` }); });
    child.once('exit', (code, sig) => {
      clearTimeout(timer);
      resolve({ name: v.name, result: `exit ${code}${sig ? ' ' + sig : ''} after ${Date.now() - t0} ms`, ran: fs.existsSync(out), stderr: err.trim().slice(0, 600), stdout: stdout.trim().slice(0, 300) });
    });
  });
}

(async () => {
  console.log(`powershell: ${ps} exists=${fs.existsSync(ps)}`);
  for (let i = 0; i < variants.length; i++) console.log(JSON.stringify(await run(variants[i], i)));
})();
