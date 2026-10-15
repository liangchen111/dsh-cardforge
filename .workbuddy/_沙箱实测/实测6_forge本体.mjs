/**
 * 第六轮（修正版）：用「真身 python + PYTHONPATH」在受限令牌下跑 forge.py 本体。
 * 上一轮 venv 的 python.exe 起不来（它是重定向器，还要再起一次子进程）。
 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const 项目 = 'E:\\workGZQ\\制卡工具';
const 真身PY = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
const 库 = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\cardforge\\Lib\\site-packages';

// 子进程继承本进程的环境，所以在这儿设 PYTHONPATH
process.env.PYTHONPATH = 库;
process.env.PYTHONHOME = '';

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
  console.log('   $', exe.split('\\').pop(), args.map(a => /[\\ ]/.test(a) ? `"${a}"` : a).join(' ').slice(0, 160));
  try {
    const child = sandbox.spawn({ command: exe, args, cwd });
    const r = await child.wait();
    const out = Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8') : String(r.stdout);
    const err = Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf8') : String(r.stderr);
    console.log('   退出码', fmt(r.exitCode));
    if (out.trim()) console.log('   stdout:', JSON.stringify(out.trim().slice(0, 400)));
    if (err.trim()) console.log('   stderr:', JSON.stringify(err.trim().slice(0, 400)));
  } catch (e) {
    console.log('   spawn 抛错:', (e && e.message) || e);
  }
  console.log();
}

console.log('######## 1. 真身 python 能不能起 ########');
await 跑('真身 python -V', 真身PY, ['-V']);

console.log('######## 2. 能不能 import yaml（PYTHONPATH 生效了吗）########');
await 跑('python -c import yaml', 真身PY, ['-c', 'import yaml;print("yaml", yaml.__version__)']);

console.log('######## 3. 跑 forge.py --help（纯读）########');
await 跑('forge.py --help', 真身PY, [join(项目, 'forge.py'), '--help'], 项目);

console.log('######## 4. 跑 forge.py new（会往工作区写工程）########');
await 跑('forge.py new 试卡', 真身PY, [join(项目, 'forge.py'), 'new', '试卡'], ws);
const 工程 = join(ws, '试卡');
console.log('   工程建出来了吗 :', existsSync(工程) ? '✅ 建出来了' : '❌ 没建出来');
if (existsSync(工程)) {
  try { console.log('   里面 :', JSON.stringify(readdirSync(工程))); } catch {}
  const spec = join(工程, 'source', '试卡.spec.yaml');
  console.log('   spec 在吗 :', existsSync(spec) ? '✅' : '❌');
}
console.log();

console.log('######## 5. 跑 forge.py check（读工程、算结论）########');
await 跑('forge.py check', 真身PY, [join(项目, 'forge.py'), 'check', join('source', '试卡.spec.yaml')], 工程);

console.log('######## 6. 跑 forge.py build（写成品卡进工作区）########');
await 跑('forge.py build', 真身PY, [join(项目, 'forge.py'), 'build',
  join('source', '试卡.spec.yaml'), join('成品', '试卡.card.json')], 工程);
console.log('   成品卡在吗 :', existsSync(join(工程, '成品', '试卡.card.json')) ? '✅ 有' : '❌ 没有');
console.log();

sandbox.dispose();
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
console.log('已清理测试目录');
