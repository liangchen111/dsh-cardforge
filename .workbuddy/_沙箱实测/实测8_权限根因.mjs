/**
 * 第八轮：查根因 —— 受限进程在授权根里新建的文件，到底拿到什么 DACL？
 * 顺带对照：预存在的文件（不是受限进程建的）能不能删/改名。
 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const 真身PY = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
process.env.PYTHONPATH = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\cardforge\\Lib\\site-packages';

const ws = join(HERE, '_工作区');
const tmp = join(HERE, '_私有临时');
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
for (const d of [ws, tmp]) mkdirSync(d, { recursive: true });

// 预置一个「普通进程建的」文件与子目录
writeFileSync(join(ws, '预存在-文件.txt'), 'pre');
mkdirSync(join(ws, '预存在-目录'));
writeFileSync(join(ws, '预存在-目录', '里面.txt'), 'pre');

const sandbox = new AclSandbox({
  writableDirs: [ws], tempDir: tmp,
  writeSid: workspaceWriteSid(ws), tempWriteSid: tempWriteSid(tmp),
  mode: 'workspace-write',
});
await sandbox.init();

const 探针 = String.raw`
import os, sys, json
ws = sys.argv[1]
r = {}
def t(n, f):
    try: f(); r[n] = "OK"
    except Exception as e: r[n] = "%s" % e
t("受限进程建文件", lambda: open(os.path.join(ws,"新建-文件.txt"),"w",encoding="utf-8").write("a"))
t("受限进程建目录", lambda: os.makedirs(os.path.join(ws,"新建-目录"), exist_ok=True))
t("删「预存在-文件」", lambda: os.remove(os.path.join(ws,"预存在-文件.txt")))
t("删「预存在-目录/里面.txt」", lambda: os.remove(os.path.join(ws,"预存在-目录","里面.txt")))
t("删「新建-文件」", lambda: os.remove(os.path.join(ws,"新建-文件.txt")))
t("改名「新建-目录」", lambda: os.rename(os.path.join(ws,"新建-目录"), os.path.join(ws,"新建-目录-改")))
print(json.dumps(r, ensure_ascii=False))
`;
const child = sandbox.spawn({ command: 真身PY, args: ['-c', 探针, ws], cwd: ws });
const r = await child.wait();
console.log('=== 受限进程内的操作 ===');
console.log(Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8') : String(r.stdout));

sandbox.dispose();

console.log('\n=== 授权根自己的 ACL ===');
console.log(execFileSync('icacls', [ws], { encoding: 'utf8' }));
console.log('=== 受限进程新建的文件 DACL ===');

console.log('=== 普通进程建的文件 DACL ===');

console.log('=== 目录里的东西 ===');
console.log(readdirSync(ws));

console.log("（保留目录以便外部查看 ACL）");
