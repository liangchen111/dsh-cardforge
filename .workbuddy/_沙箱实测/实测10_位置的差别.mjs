/**
 * 第十轮：决定性对照 —— 把授权根放在「用户目录下」（跟 ElecKoi 的真实工作区同构），
 * 看删/改名/原子替换能不能过。这一条决定 forge.py 能不能在沙箱里干活。
 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const 真身PY = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
process.env.PYTHONPATH = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\cardforge\\Lib\\site-packages';

const 探针 = String.raw`
import os, sys, json
ws = sys.argv[1]
r = {}
def t(n, f):
    try: f(); r[n] = "OK"
    except Exception as e: r[n] = type(e).__name__ + ": " + str(e)[:70]
p1 = os.path.join(ws, "a.txt"); p2 = os.path.join(ws, "a2.txt")
t("1 建文件", lambda: open(p1,"w",encoding="utf-8").write("x"))
t("2 改名", lambda: os.rename(p1, p2))
t("3 删除", lambda: os.remove(p2))
d = os.path.join(ws, "d"); t("4 建目录", lambda: os.makedirs(d, exist_ok=True))
q1 = os.path.join(d, "b.txt"); q2 = os.path.join(d, "b2.txt")
t("5 子目录建文件", lambda: open(q1,"w",encoding="utf-8").write("y"))
t("6 子目录改名", lambda: os.rename(q1, q2))
t("7 子目录删除", lambda: os.remove(q2))
a = os.path.join(ws,"t.txt"); b = os.path.join(ws,"t.tmp")
t("8a 写两个", lambda: (open(a,"w").write("old"), open(b,"w").write("new")))
t("8b os.replace", lambda: os.replace(b, a))
print(json.dumps(r, ensure_ascii=False))
`;

async function 试处(标签, 基目录) {
  const ws = join(基目录, '_forge沙箱试');
  const tmp = join(基目录, '_forge沙箱试-临时');
  for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
  for (const d of [ws, tmp]) mkdirSync(d, { recursive: true });
  writeFileSync(join(ws, '预置.txt'), 'p');

  const sandbox = new AclSandbox({
    writableDirs: [ws], tempDir: tmp,
    writeSid: workspaceWriteSid(ws), tempWriteSid: tempWriteSid(tmp),
    mode: 'workspace-write',
  });
  await sandbox.init();
  const r = await sandbox.spawn({ command: 真身PY, args: ['-c', 探针, ws], cwd: ws }).wait();
  console.log('####', 标签);
  console.log('   路径:', ws);
  console.log('   结果:', (Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8') : String(r.stdout)).trim());
  sandbox.dispose();
  for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
  console.log();
}

const APPDATA = process.env.APPDATA;      // C:\Users\Administrator\AppData\Roaming
await 试处('A. 授权根放在 %APPDATA% 下（与 ElecKoi 真实工作区同构）', APPDATA);
await 试处('B. 授权根放在 E:\\workGZQ 下（上一轮的位置）', 'E:\\workGZQ\\制卡工具\\.workbuddy\\_沙箱实测');
