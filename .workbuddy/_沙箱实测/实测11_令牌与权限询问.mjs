/**
 * 第十一轮：查「删不掉」的确切原因 —— 在受限令牌内用 Win32 直接问：
 *   谁是当前用户、进程是否提权、对某个文件拿 DELETE 权限到底报什么错。
 * 同时在沙箱外跑一遍做对照。
 */
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const 真身PY = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
process.env.PYTHONPATH = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\cardforge\\Lib\\site-packages';

const 探针 = String.raw`
import os, sys, json, ctypes, ctypes.wintypes as w

r = {}
r["进程】管理员组状态"] = None
try:
    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    TOKEN_QUERY = 0x0008
    tok = w.HANDLE()
    if adv.OpenProcessToken(k32.GetCurrentProcess(), TOKEN_QUERY, ctypes.byref(tok)):
        class SID_AND_ATTRIBUTES(ctypes.Structure):
            _fields_ = [("Sid", ctypes.c_void_p), ("Attributes", ctypes.c_uint32)]
        class TOKEN_GROUPS(ctypes.Structure):
            _fields_ = [("GroupCount", ctypes.c_uint32), ("Groups", SID_AND_ATTRIBUTES * 1)]
        n = ctypes.c_uint32(0)
        adv.GetTokenInformation(tok, 2, None, 0, ctypes.byref(n))  # TokenGroups
        buf = ctypes.create_string_buffer(n.value)
        if adv.GetTokenInformation(tok, 2, buf, n.value, ctypes.byref(n)):
            cnt = ctypes.cast(buf, ctypes.POINTER(ctypes.c_uint32)).contents.value
            arr = ctypes.cast(ctypes.addressof(buf) + 8,
                              ctypes.POINTER(SID_AND_ATTRIBUTES * cnt)).contents
            out = []
            for i in range(cnt):
                sa = arr[i]
                sidstr = ctypes.c_wchar_p()
                if adv.ConvertSidToStringSidW(sa.Sid, ctypes.byref(sidstr)):
                    out.append((sidstr.value, hex(sa.Attributes)))
            r["进程】令牌里的组"] = out
        # 提权状态
        class TOKEN_ELEVATION(ctypes.Structure):
            _fields_ = [("TokenIsElevated", ctypes.c_uint32)]
        te = TOKEN_ELEVATION(); n2 = ctypes.c_uint32(0)
        if adv.GetTokenInformation(tok, 20, ctypes.byref(te), ctypes.sizeof(te), ctypes.byref(n2)):
            r["进程】是否提权"] = bool(te.TokenIsElevated)
except Exception as e:
    r["进程】查询失败"] = str(e)

# 直接问 Windows：对目标文件拿 DELETE 权限行不行
GENERIC_READ=0x80000000; DELETE=0x00010000; SYNCHRONIZE=0x00100000
FILE_SHARE_ALL=7; OPEN_EXISTING=3
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.CreateFileW.restype = w.HANDLE
k32.CreateFileW.argtypes=[w.LPCWSTR, w.DWORD, w.DWORD, ctypes.c_void_p, w.DWORD, w.DWORD, w.HANDLE]

f = sys.argv[1]     # 已存在的文件
for 名, access in (("读 GENERIC_READ", GENERIC_READ),
                   ("写 FILE_WRITE_DATA", 0x2),
                   ("删 DELETE", DELETE)):
    h = k32.CreateFileW(f, access, FILE_SHARE_ALL, None, OPEN_EXISTING, 0x80, None)
    if h == w.HANDLE(-1).value or h is None or h == -1:
        r["打开】" + 名] = "拒绝，Win32 err=%d" % ctypes.get_last_error()
    else:
        r["打开】" + 名] = "允许"
        k32.CloseHandle(h)

print(json.dumps(r, ensure_ascii=False, indent=1))
`;

const ws = join(HERE, '_现场2');
const tmp = join(HERE, '_现场2临时');
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
for (const d of [ws, tmp]) mkdirSync(d, { recursive: true });
const 目标 = join(ws, '目标.txt');
writeFileSync(目标, 'x');

console.log('########## 沙箱外（普通进程）##########');
{
  const r = await new Promise((res) => {
    import('node:child_process').then(({ spawn }) => {
      const c = spawn(真身PY, ['-c', 探针, 目标], { stdio: ['ignore', 'pipe', 'pipe'] });
      let o = ''; c.stdout.on('data', d => o += d); c.stderr.on('data', d => o += d);
      c.on('close', () => res(o));
    });
  });
  console.log(r);
}

console.log('########## 沙箱内（受限令牌）##########');
const sandbox = new AclSandbox({
  writableDirs: [ws], tempDir: tmp,
  writeSid: workspaceWriteSid(ws), tempWriteSid: tempWriteSid(tmp),
  mode: 'workspace-write',
});
await sandbox.init();
const c = sandbox.spawn({ command: 真身PY, args: ['-c', 探针, 目标], cwd: ws });
const r = await c.wait();
console.log(Buffer.isBuffer(r.stdout) ? r.stdout.toString('utf8') : String(r.stdout));
const e = Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf8') : String(r.stderr);
if (e.trim()) console.log('stderr:', e.slice(0, 400));

sandbox.dispose();
for (const d of [ws, tmp]) rmSync(d, { recursive: true, force: true });
