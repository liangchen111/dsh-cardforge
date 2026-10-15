/** 第九轮：只做「建授权根 + 受限进程里建/写/删」，然后留下现场供外部查 ACL。 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const 真身PY = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
process.env.PYTHONPATH = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\cardforge\\Lib\\site-packages';

const ws = join(HERE, '_现场');
const tmp = join(HERE, '_现场临时');
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
for (const d of [ws, tmp]) mkdirSync(d, { recursive: true });
writeFileSync(join(ws, '先有的文件.txt'), 'pre');

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
    except Exception as e: r[n] = str(e)[:60]
t("建文件", lambda: open(os.path.join(ws,"受限建的.txt"),"w",encoding="utf-8").write("a"))
t("删先有的文件", lambda: os.remove(os.path.join(ws,"先有的文件.txt")))
t("删受限建的", lambda: os.remove(os.path.join(ws,"受限建的.txt")))
print(json.dumps(r, ensure_ascii=False))
`;
const child = sandbox.spawn({ command: 真身PY, args: ['-c', 探针, ws], cwd: ws });
const r = await child.wait();
console.log('受限进程内:', Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8').trim() : String(r.stdout));
sandbox.dispose();
console.log('现场已留:', ws);
console.log('                ', tmp);
