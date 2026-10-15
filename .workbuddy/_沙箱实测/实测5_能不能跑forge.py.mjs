/**
 * 第五轮：回答 C 轨的核心问题 —— ElecKoi 里的 AI 真跑起来之后，
 * 能不能跑 forge.py？能读哪？能写哪？
 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const 项目 = 'E:\\workGZQ\\制卡工具';
const PY = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\cardforge\\Scripts\\python.exe';

const ws = join(HERE, '_工作区');
const tmp = join(HERE, '_私有临时');
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
for (const d of [ws, tmp]) mkdirSync(d, { recursive: true });

const sandbox = new AclSandbox({
  writableDirs: [ws], tempDir: tmp,
  writeSid: workspaceWriteSid(ws), tempWriteSid: tempWriteSid(tmp),
  mode: 'workspace-write',
});
await sandbox.init();

const fmt = (c) => {
  const u = (c ?? 0) >>> 0;
  return `${c} (0x${u.toString(16).toUpperCase().padStart(8, '0')})`
    + (u === 0xC0000142 ? '  ← STATUS_DLL_INIT_FAILED' : '');
};

async function 跑(说明, exe, args, cwd = ws) {
  console.log('----------', 说明);
  console.log('   $', exe.split('\\').pop(), args.join(' ').slice(0, 150));
  try {
    const child = sandbox.spawn({ command: exe, args, cwd });
    const r = await child.wait();
    const out = Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8') : String(r.stdout);
    const err = Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf8') : String(r.stderr);
    console.log('   退出码', fmt(r.exitCode));
    if (out.trim()) console.log('   stdout:', JSON.stringify(out.trim().slice(0, 260)));
    if (err.trim()) console.log('   stderr:', JSON.stringify(err.trim().slice(0, 260)));
  } catch (e) {
    console.log('   spawn 抛错:', (e && e.message) || e);
  }
  console.log();
}

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const psq = (cmd) => [ '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', cmd ];

console.log('######## 1. python 本身能不能在受限令牌下起 ########');
await 跑('python -V', PY, ['-V']);

console.log('######## 2. 能不能跑 forge.py（读操作：--help）########');
await 跑('forge.py --help', PY, [join(项目, 'forge.py'), '--help'], 项目);

console.log('######## 3. 能不能读项目目录里的文件 ########');
await 跑('Get-Content 论文件头 40 行', PS,
  psq(`Get-Content -LiteralPath "${join(项目, 'README.md')}" -TotalCount 5`));

console.log('######## 4. 能不能往项目目录里写（预期：被拒）########');
const 越界文件 = join(项目, '.workbuddy', '_越界写测试.txt');
if (existsSync(越界文件)) rmSync(越界文件, { force: true });
await 跑('往项目目录写文件', PS,
  psq(`New-Item -ItemType File -Path "${越界文件}" -Force | Out-Null; Write-Output WROTE`));
console.log('   写出来了吗 :', existsSync(越界文件) ? '❌ 写出来了（未被拦住！）' : '✅ 没写出来（被沙箱拦住）');
console.log();

console.log('######## 5. 能不能往工作区里写（预期：可以）########');
await 跑('往工作区写文件', PS,
  psq('New-Item -ItemType File -Path "ws-写测试.txt" -Force | Out-Null; Get-Content "ws-写测试.txt" -Raw; Write-Output "WROTE-IN-WS"'));
console.log('   工作区里有没有 :', existsSync(join(ws, 'ws-写测试.txt')) ? '✅ 有' : '❌ 没有');
console.log();

console.log('######## 6. 能不能跑一个「真的会写盘」的 forge 命令（预期：写不进去）########');
const 试工程 = join(ws, '试卡');
await 跑('forge.py new 试卡（会建目录、写 spec）', PY,
  [join(项目, 'forge.py'), 'new', 试卡, '--模块', ''], ws);
console.log('   工程建出来了吗 :', existsSync(join(ws, '试卡', 'source')) ? '✅ 建出来了' : '❌ 没建出来');
if (existsSync(join(ws, '试卡'))) {
  try {
    console.log('   产出 :', JSON.stringify(require('node:fs').readdirSync(join(ws, '试卡'))));
  } catch {}
}
console.log();

sandbox.dispose();
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
console.log('已清理测试目录');
