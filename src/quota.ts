import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
export type WindowQuota = {
  remaining: number;
  resetAt: number | null;
  minutes: number;
};
export type Quota = {
  status: "ok" | "unavailable" | "error";
  short: WindowQuota | null;
  week: WindowQuota | null;
  updatedAt: number | null;
  message: string;
  stale?: boolean;
};
export function normalizeQuota(result: any, now = Date.now()): Quota {
  const buckets = result?.rateLimitsByLimitId;
  const b =
    buckets?.codex ??
    result?.rateLimits ??
    (buckets ? Object.values(buckets)[0] : null);
  const ws = [b?.primary, b?.secondary].filter(Boolean);
  const get = (minutes: number): WindowQuota | null => {
    const w = ws.find((w) => w.windowDurationMins === minutes);
    if (
      !w ||
      typeof w.usedPercent !== "number" ||
      !Number.isFinite(w.usedPercent)
    )
      return null;
    return {
      remaining: Math.max(0, Math.min(100, 100 - w.usedPercent)),
      resetAt: typeof w.resetsAt === "number" ? w.resetsAt : null,
      minutes,
    };
  };
  const short = get(300),
    week = get(10080);
  return {
    status: short || week ? "ok" : "unavailable",
    short,
    week,
    updatedAt: now,
    message: short || week ? "" : "账户暂未返回 5 小时或周额度",
  };
}
export function findCodex(): string | null {
  if (
    process.env.XIAOMI_CODEX_PATH &&
    fs.existsSync(process.env.XIAOMI_CODEX_PATH)
  )
    return process.env.XIAOMI_CODEX_PATH;
  const root = path.join(
    process.env.LOCALAPPDATA ?? "",
    "OpenAI",
    "Codex",
    "bin",
  );
  if (fs.existsSync(root))
    for (const name of fs.readdirSync(root).reverse()) {
      const exe = path.join(root, name, "codex.exe");
      if (fs.existsSync(exe)) return exe;
    }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const exe = path.join(dir, "codex.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}
export class QuotaClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private initialized = false;
  private buffer = "";
  private pending = new Map<
    number,
    {
      resolve: (x: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private cache: Quota | null = null;
  private active: Promise<Quota> | null = null;
  constructor(
    private executable = findCodex(),
    private launch = (executable: string) =>
      spawn(executable, ["app-server", "--stdio"], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    private timeoutMs = 12000,
  ) {}
  private fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.initialized = false;
    this.child = null;
  }
  private async start() {
    if (this.child && this.initialized) return;
    if (!this.executable) throw new Error("未找到 Codex，请先安装并登录 Codex");
    const child = this.launch(this.executable);
    this.child = child;
    this.buffer = "";
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        try {
          const m = JSON.parse(line);
          const p = this.pending.get(m.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(m.id);
            m.error
              ? p.reject(new Error(m.error.message ?? "额度接口错误"))
              : p.resolve(m.result);
          }
        } catch {}
      }
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", (e) => {
      if (this.child === child) this.fail(e);
    });
    child.on("error", (e) => {
      if (this.child === child) this.fail(e);
    });
    child.on("exit", () => {
      if (this.child === child) this.fail(new Error("Codex 额度连接已断开"));
    });
    await this.rpc("initialize", {
      clientInfo: { name: "xiaomi-desktop-pet", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    this.initialized = true;
  }
  private rpc(method: string, params?: any) {
    return new Promise<any>((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("读取额度超时，请检查网络和登录状态"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin.write(
        JSON.stringify({
          id,
          method,
          ...(params === undefined ? {} : { params }),
        }) + "\n",
      );
    });
  }
  read(): Promise<Quota> {
    if (this.active) return this.active;
    this.active = this.readOnce().finally(() => (this.active = null));
    return this.active;
  }
  private async readOnce(): Promise<Quota> {
    try {
      await this.start();
      const account = await this.rpc("account/read", { refreshToken: false });
      if (!account?.account)
        throw new Error("请先在 Codex 中登录 ChatGPT 账户");
      const result = await this.rpc("account/rateLimits/read");
      this.cache = normalizeQuota(result);
      return this.cache;
    } catch (e) {
      this.close();
      return this.cache
        ? { ...this.cache, stale: true, message: (e as Error).message }
        : {
            status: "error",
            short: null,
            week: null,
            updatedAt: null,
            message: (e as Error).message,
          };
    }
  }
  close() {
    const c = this.child;
    this.fail(new Error("额度连接已关闭"));
    c?.kill();
  }
}
