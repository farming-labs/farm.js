const assert = require("node:assert/strict");
const { test } = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");

async function loadLock() {
  const { withPrismaGenerateLock } = await import("./run-prisma-generate.mjs");
  return withPrismaGenerateLock;
}

test("serializes concurrent critical sections", async () => {
  const withPrismaGenerateLock = await loadLock();
  const lockKey = `serialize-${process.pid}-${Date.now()}`;
  let active = 0;
  let maxActive = 0;
  const order = [];

  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      withPrismaGenerateLock(lockKey, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(index);
        await delay(20);
        active -= 1;
      }),
    ),
  );

  assert.equal(maxActive, 1, "critical sections must never overlap");
  assert.equal(order.length, 5, "every waiter must eventually run");
});

test("releases the lock when the critical section throws", async () => {
  const withPrismaGenerateLock = await loadLock();
  const lockKey = `release-${process.pid}-${Date.now()}`;

  await assert.rejects(
    withPrismaGenerateLock(lockKey, async () => {
      throw new Error("generate exploded");
    }),
    /generate exploded/,
  );

  let ran = false;
  await withPrismaGenerateLock(lockKey, async () => {
    ran = true;
  });
  assert.equal(ran, true, "a failed holder must not leave the lock held");
});

test("breaks a stale lock left by a crashed holder", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createHash } = require("node:crypto");
  const withPrismaGenerateLock = await loadLock();

  const lockKey = `stale-${process.pid}-${Date.now()}`;
  const digest = createHash("sha256").update(lockKey).digest("hex").slice(0, 16);
  const lockDirectory = path.join(os.tmpdir(), `farm-prisma-generate-${digest}.lock`);
  fs.mkdirSync(lockDirectory);
  const staleTime = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lockDirectory, staleTime, staleTime);

  let ran = false;
  await withPrismaGenerateLock(lockKey, async () => {
    ran = true;
  });
  assert.equal(ran, true, "a stale lock must be reclaimed instead of waiting forever");
});
