/**
 * 第四轮：照 ElecKoi 的真实链路跑 —— 宿主 → runner 子进程 → 受限 pwsh。
 *
 * 关键变量：宿主给 runner 用的 spawn 选项。Electron 的 child_process 默认
 * windowsHide: true（= CREATE_NO_WINDOW），而沙箱文档点名「以 CREATE_NO_WINDOW
 * 创建的子进程会在 DLL 初始化期以 0xC0000142 死亡」。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const RUNNER = join(HERE, 'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js');

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const CMD = 'C:\\Windows\\System32\\cmd.exe';

const fmt = (c) => {
  if (c === null || c === undefined) return String(c);
  const u = c >>> 0;
  return `${c} (0x${u.toString(16).toUpperCase().padStart(8, '0')})`
    + (u === 0xC0000142 ? '  ← 0xC0000142 STATUS_DLL_INIT_FAILED' : '');
};

async function run(label, { windowsHide, stdioMode, exe, args }) {
  const ws = join(HERE, '_run_工作区');
  const tmpRoot = join(HERE, '_run_临时根');
  for (const d of [ws, tmpRoot]) rmSync(d, { recursive: true, force: true });
  for (const d of [ws, tmpRoot]) mkdirSync(d, { recursive: true });

  const runnerArgv = [RUNNER, '--workspace', ws, '--temp', tmpRoot, '--mode', 'workspace-write', '--', exe, ...args];

  return await new Promise((res) => {
    const child = spawn(NODE, runnerArgv, {
      cwd: ws,
      windowsHide,
      stdio: stdioMode === 'pipe' ? 'pipe' : 'inherit',
    });
    let buf = '';
    if (child.stdout) child.stdout.on('data', (d) => { buf += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { buf += d.toString(); });
    child.on('error', (e) => {
      console.log(`  ${label} 宿主 spawn 抛错: ${e.message}`);
      res();
    });
    child.on('close', (code) => {
      console.log(`  ${label}`);
      console.log(`      退出码 = ${fmt(code)}`);
      const t = buf.trim();
      console.log(`      捕获输出 = ${t ? JSON.stringify(t.slice(0, 200)) : '(空)'}`);
      for (const d of [ws, tmpRoot]) rmSync(d, { recursive: true, force: true });
      res();
    });
  });
}

console.log('=== A 组：宿主 windowsHide=false，runner 直接继承控制台 ===');
await run('A1 powershell', { windowsHide: false, stdioMode: 'inherit', exe: PS,
  args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output PS-OK'] });
await run('A2 cmd', { windowsHide: false, stdioMode: 'inherit', exe: CMD, args: ['/c', 'echo CMD-OK'] });

console.log('\n=== B 组：宿主 windowsHide=true（= CREATE_NO_WINDOW，Electron 默认）===');
await run('B1 powershell', { windowsHide: true, stdioMode: 'pipe', exe: PS,
  args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output PS-OK'] });
await run('B2 cmd', { windowsHide: true, stdioMode: 'pipe', exe: CMD, args: ['/c', 'echo CMD-OK'] });

console.log('\n=== C 组：宿主 windowsHide=true 且 runner 继承控制台 ===');
await run('C1 powershell', { windowsHide: true, stdioMode: 'inherit', exe: PS,
  args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output PS-OK'] });
