import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeQuota, QuotaClient } from "../src/quota";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { ChildProcessWithoutNullStreams } from "node:child_process";

function fakeServer(reply: (method: string) => any) {
  const proc = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill() {
      this.killed = true;
      return true;
    },
  });
  const calls: string[] = [];
  proc.stdin.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n")) {
      const request = JSON.parse(line);
      calls.push(request.method);
      if (request.id === undefined) continue;
      const result = reply(request.method);
      if (result === undefined) continue;
      setImmediate(() =>
        proc.stdout.write(JSON.stringify({ id: request.id, ...result }) + "\n"),
      );
    }
  });
  return {
    proc,
    calls,
    launch: () => proc as unknown as ChildProcessWithoutNullStreams,
  };
}

test("JSONL transport initializes and reads quota without creating a model turn", async () => {
  const fake = fakeServer((method) => ({
    result:
      method === "account/read"
        ? { account: { type: "chatgpt" } }
        : method === "account/rateLimits/read"
          ? {
              rateLimits: {
                primary: { usedPercent: 25, windowDurationMins: 300 },
              },
            }
          : {},
  }));
  const client = new QuotaClient("mock", fake.launch);
  const quota = await client.read();
  client.close();
  assert.equal(quota.short?.remaining, 75);
  assert.deepEqual(fake.calls, [
    "initialize",
    "initialized",
    "account/read",
    "account/rateLimits/read",
  ]);
  assert.equal(fake.proc.killed, true);
});

test("unlogged transport returns login instruction and never requests quota", async () => {
  const fake = fakeServer((method) => ({
    result: method === "account/read" ? { account: null } : {},
  }));
  const client = new QuotaClient("mock", fake.launch);
  const q = await client.read();
  assert.equal(q.status, "error");
  assert.match(q.message, /登录/);
  assert.equal(fake.calls.includes("account/rateLimits/read"), false);
  assert.equal(fake.proc.killed, true);
});

test("offline response preserves last successful percentages with stale timestamp", async () => {
  let reads = 0;
  const fake = fakeServer((method) => {
    if (method === "account/read")
      return { result: { account: { type: "chatgpt" } } };
    if (method === "account/rateLimits/read")
      return ++reads === 1
        ? {
            result: {
              rateLimits: {
                primary: { usedPercent: 20, windowDurationMins: 300 },
              },
            },
          }
        : { error: { message: "网络不可用" } };
    return { result: {} };
  });
  const client = new QuotaClient("mock", fake.launch);
  const initial = await client.read(),
    offline = await client.read();
  assert.equal(offline.short?.remaining, 80);
  assert.equal(offline.updatedAt, initial.updatedAt);
  assert.equal(offline.stale, true);
  assert.match(offline.message, /网络不可用/);
  assert.equal(fake.proc.killed, true);
});

test("initialization timeout terminates child and reports unknown quota", async () => {
  const fake = fakeServer(() => undefined);
  const client = new QuotaClient("mock", fake.launch, 15);
  const q = await client.read();
  assert.equal(q.short, null);
  assert.match(q.message, /超时/);
  assert.equal(fake.proc.killed, true);
});
test("prefer codex multi bucket and map duration not primary ordering", () => {
  const q = normalizeQuota(
    {
      rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } },
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 100 },
          secondary: { usedPercent: 14, windowDurationMins: 300, resetsAt: 50 },
        },
      },
    },
    123,
  );
  assert.equal(q.short?.remaining, 86);
  assert.equal(q.week?.remaining, 98);
  assert.equal(q.updatedAt, 123);
});
test("unknown and missing windows never become zero remaining", () => {
  const q = normalizeQuota({
    rateLimits: {
      primary: { windowDurationMins: 300, usedPercent: null },
      secondary: { windowDurationMins: 60, usedPercent: 50 },
    },
  });
  assert.equal(q.short, null);
  assert.equal(q.week, null);
  assert.equal(q.status, "unavailable");
});
test("percent clamped; absent reset not a fake date", () => {
  const q = normalizeQuota({
    rateLimits: { primary: { windowDurationMins: 300, usedPercent: 110 } },
  });
  assert.equal(q.short?.remaining, 0);
  assert.equal(q.short?.resetAt, null);
});
test("missing executable returns actionable error with unknown quota", async () => {
  const q = await new QuotaClient(null).read();
  assert.equal(q.status, "error");
  assert.equal(q.short, null);
  assert.equal(q.updatedAt, null);
});
