/**
 * 第三轮：判死因。
 * 基线 = 官方原样（creationFlags = 0）；
 * 实验 = 把 creationFlags 改成 CREATE_NO_WINDOW (0x08000000)，
 *        也就是官方文档点名的「会让子进程在 DLL 初始化期以 0xC0000142 死亡」的那个标志。
 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const ws = join(ROOT, '_工作区');
const tmp = join(ROOT, '_私有临时');
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
for (const d of [ws, tmp]) mkdirSync(d, { recursive: true });

const sandbox = new AclSandbox({
  writableDirs: [ws], tempDir: tmp,
  writeSid: workspaceWriteSid(ws), tempWriteSid: tempWriteSid(tmp),
  mode: 'workspace-write',
});
await sandbox.init();

const fmt = (c) => {
  if (c === null || c === undefined) return String(c);
  const u = c >>> 0;
  return `${c} (0x${u.toString(16).toUpperCase().padStart(8, '0')})`
    + (u === 0xC0000142 ? '  ← 0xC0000142 STATUS_DLL_INIT_FAILED' : '');
};

const CASES = [
  ['cmd.exe', 'C:\\Windows\\System32\\cmd.exe', ['/c', 'echo CMD-OK']],
  ['powershell.exe (5.1)', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output PS-OK']],
  ['node.exe', process.execPath, ['-e', 'console.log("NODE-OK")']],
];

console.log('=== 逐进程：管道采集 ===');
for (const [name, exe, args] of CASES) {
  try {
    const child = sandbox.spawn({ command: exe, args, cwd: ws });
    const r = await child.wait();
    const out = Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8') : String(r.stdout);
    const err = Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf8') : String(r.stderr);
    console.log(`  ${name.padEnd(22)} 退出码=${fmt(r.exitCode)}`);
    console.log(`  ${''.padEnd(22)} stdout=${JSON.stringify(out.trim().slice(0, 120))}`);
    if (err.trim()) console.log(`  ${''.padEnd(22)} stderr=${JSON.stringify(err.trim().slice(0, 200))}`);
  } catch (e) {
    console.log(`  ${name.padEnd(22)} spawn 抛错: ${(e && e.message) || e}`);
  }
}

sandbox.dispose();
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
