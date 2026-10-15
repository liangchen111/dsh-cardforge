/**
 * 第七轮：把「工作区里的写/删/改名」这条边界钉死。
 * forge.py 的每一次落盘都是「写临时文件 → 改名覆盖」(os.replace)，
 * 如果改名被沙箱挡住，整套「AI 直接在 ElecKoi 里跑 forge.py」就不成立。
 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const 真身PY = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
const 库 = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\cardforge\\Lib\\site-packages';
process.env.PYTHONPATH = 库;

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

const 探针 = String.raw`
import os, sys, json
ws = sys.argv[1]
r = {}
def t(name, fn):
    try:
        fn(); r[name] = "OK"
    except Exception as e:
        r[name] = "%s: %s" % (type(e).__name__, e)

p1 = os.path.join(ws, "根.txt")
p2 = os.path.join(ws, "根-改后.txt")
t("1 建文件", lambda: open(p1, "w", encoding="utf-8").write("x"))
t("2 同名改名(根目录内)", lambda: os.rename(p1, p2))
t("3 删文件(根目录内)", lambda: os.remove(p2))

d = os.path.join(ws, "子目录")
t("4 建子目录", lambda: os.makedirs(d, exist_ok=True))
q1 = os.path.join(d, "子.txt")
q2 = os.path.join(d, "子-改后.txt")
t("5 子目录里建文件", lambda: open(q1, "w", encoding="utf-8").write("y"))
t("6 子目录里改名", lambda: os.rename(q1, q2))
t("7 子目录里删文件", lambda: os.remove(q2))

# 8 原子替换：临时文件 -> 覆盖目标（content.commit 的写法）
a = os.path.join(ws, "目标.txt"); b = os.path.join(ws, "临时.txt")
t("8a 写目标与临时", lambda: (open(a,"w",encoding="utf-8").write("old"),
                              open(b,"w",encoding="utf-8").write("new")))
t("8b os.replace(临时->目标)", lambda: os.replace(b, a))

# 9 同样四步，但在子目录里
a2 = os.path.join(d, "目标.txt"); b2 = os.path.join(d, "临时.txt")
t("9a 子目录写目标与临时", lambda: (open(a2,"w",encoding="utf-8").write("old"),
                                    open(b2,"w",encoding="utf-8").write("new")))
t("9b 子目录 os.replace", lambda: os.replace(b2, a2))

# 10 建目录后立刻改名该目录
d2 = os.path.join(ws, "待改名目录")
t("10 建目录再改名", lambda: (os.makedirs(d2, exist_ok=True), os.rename(d2, os.path.join(ws, "改名后目录"))))

print(json.dumps(r, ensure_ascii=False, indent=2))
`;

const child = sandbox.spawn({ command: 真身PY, args: ['-c', 探针, ws], cwd: ws });
const r = await child.wait();
console.log('退出码:', r.exitCode);
console.log(Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8') : String(r.stdout));
const err = Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf8') : String(r.stderr);
if (err.trim()) console.log('stderr:', err.slice(0, 800));

sandbox.dispose();
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
