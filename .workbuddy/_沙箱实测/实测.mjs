/**
 * 在本地真跑一次 ElecKoi 用的那套 Windows ACL 受限令牌沙箱，
 * 对照三个不同进程（cmd / powershell / node）在同一个受限令牌下的死活。
 *
 * 用的是从 ElecKoi 0.2.8 的 app.asar 里原样抽出的官方实现，一行没改。
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
  writableDirs: [ws],
  tempDir: tmp,
  writeSid: workspaceWriteSid(ws),
  tempWriteSid: tempWriteSid(tmp),
  mode: 'workspace-write',
});

console.log('=== 建受限令牌（init）===');
await sandbox.init();
console.log('init 成功；私有临时目录 =', sandbox.tempDir);

const CASES = [
  ['cmd.exe', 'C:\\Windows\\System32\\cmd.exe', ['/c', 'echo hello-from-cmd']],
  ['powershell.exe (5.1)', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output hello-from-ps']],
  ['node.exe', process.execPath, ['-e', 'console.log("hello-from-node")']],
];

const fmt = (code) => {
  if (code === null || code === undefined) return String(code);
  const u = code >>> 0;
  const hex = '0x' + u.toString(16).toUpperCase().padStart(8, '0');
  const mean = u === 0xC0000142 ? '  ← STATUS_DLL_INIT_FAILED（进程初始化失败）' : '';
  return `${code} (${hex})${mean}`;
};

console.log('');
console.log('=== 同一个受限令牌下，逐个起进程 ===');
for (const [name, exe, args] of CASES) {
  process.stdout.write(`\n--- ${name} ---\n`);
  try {
    const child = sandbox.spawn({ command: exe, args, cwd: ws });
    const r = await child.wait();
    const out = (r.stdout && r.stdout.text) || '';
    const err = (r.stderr && r.stderr.text) || '';
    console.log('  退出码 :', fmt(r.exitCode));
    console.log('  stdout :', JSON.stringify(out.slice(0, 300)));
    console.log('  stderr :', JSON.stringify(err.slice(0, 300)));
  } catch (e) {
    console.log('  spawn 直接抛错:', (e && e.message) || String(e));
  }
}

console.log('');
console.log('=== 收工 ===');
sandbox.dispose();
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
console.log('已清理测试目录');
