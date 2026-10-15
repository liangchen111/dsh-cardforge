/**
 * 第二轮：不靠管道，让子进程往工作区里写文件 —— 文件落地即证明「真的跑起来了」。
 * 同时对照 stdio:'inherit'（直接透传到我们的控制台）看有没有输出。
 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
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
console.log('init OK\n');

const CASES = [
  ['cmd.exe', 'C:\\Windows\\System32\\cmd.exe',
    ['/c', 'echo from-cmd>cmd.txt & ver>cmd-ver.txt'], 'cmd.txt'],
  ['powershell.exe (5.1)', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
     'Set-Content -Path ps.txt -Value "from-powershell"; $PSVersionTable.PSVersion.ToString() | Set-Content ps-ver.txt'],
    'ps.txt'],
  ['node.exe', process.execPath,
    ['-e', "require('fs').writeFileSync('node.txt','from-node');console.log('NODE-STDOUT-OK')"],
    'node.txt'],
];

const fmt = (c) => c === null || c === undefined ? String(c)
  : `${c} (0x${(c >>> 0).toString(16).toUpperCase().padStart(8, '0')})`;

for (const [name, exe, args, proof] of CASES) {
  console.log('========', name, '========');
  console.log('  命令行 :', args.join(' ').slice(0, 120));

  // A. 管道采集
  try {
    const child = sandbox.spawn({ command: exe, args, cwd: ws });
    const r = await child.wait();
    console.log('  [管道] 退出码 :', fmt(r.exitCode));
    console.log('  [管道] stdout :', JSON.stringify(((r.stdout || {}).text || '').slice(0, 200)));
    console.log('  [管道] stderr :', JSON.stringify(((r.stderr || {}).text || '').slice(0, 200)));
  } catch (e) { console.log('  [管道] 抛错 :', (e && e.message) || e); }

  // B. 落证：文件到底写没写出来
  const pf = join(ws, proof);
  if (existsSync(pf)) {
    console.log('  ✅ 文件已写出 :', proof, '=', JSON.stringify(readFileSync(pf, 'utf8').trim().slice(0, 80)));
  } else {
    console.log('  ❌ 文件没写出 :', proof);
  }
  console.log();
}

// C. stdio:'inherit' 对照组
console.log('======== 对照组：stdio 直接继承 ========');
try {
  const c = sandbox.spawn({ command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/c', 'echo INHERIT-MODE-OUTPUT'], cwd: ws, stdio: 'inherit' });
  const r = await c.wait();
  console.log('  退出码 :', fmt(r.exitCode));
} catch (e) { console.log('  抛错 :', (e && e.message) || e); }

console.log('\n工作区最终内容 :', JSON.stringify(readdirSync(ws)));
sandbox.dispose();
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
console.log('已清理');
