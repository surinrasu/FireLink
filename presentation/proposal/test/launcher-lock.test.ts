import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { acquireLauncherLock } from "../launcher-lock.ts";

function lockFile(t: TestContext): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "firelink-lock-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "launcher.lock");
}

test("a live launcher keeps exclusive ownership until release", (t) => {
  const file = lockFile(t);
  const release = acquireLauncherLock(file);
  assert.equal(readFileSync(file, "utf8"), String(process.pid));
  assert.throws(() => acquireLauncherLock(file), /演示已在运行/);
  assert.equal(readFileSync(file, "utf8"), String(process.pid));
  release();
  assert.equal(existsSync(file), false);
  const nextRelease = acquireLauncherLock(file);
  release();
  assert.equal(existsSync(file), true);
  nextRelease();
});

test(
  "a launcher killed without cleanup leaves a recoverable lock",
  { timeout: 10000 },
  async (t) => {
    const file = lockFile(t);
    const module = new URL("../launcher-lock.ts", import.meta.url).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
    import { acquireLauncherLock } from ${JSON.stringify(module)};
    acquireLauncherLock(${JSON.stringify(file)});
    process.send("locked");
    setInterval(() => {}, 1000);
  `,
      ],
      { stdio: ["ignore", "ignore", "inherit", "ipc"] },
    );
    t.after(() => child.kill("SIGKILL"));
    await once(child, "message");
    assert.equal(readFileSync(file, "utf8"), String(child.pid));
    assert.throws(() => acquireLauncherLock(file), /演示已在运行/);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const release = acquireLauncherLock(file);
    assert.equal(readFileSync(file, "utf8"), String(process.pid));
    release();
    assert.equal(existsSync(file), false);
  },
);

test("invalid owner records are preserved without probing process groups", (t) => {
  const file = lockFile(t);
  const probe = t.mock.method(process, "kill", () => {
    throw new Error("must not probe an invalid PID");
  });
  for (const contents of ["", "0", "-1", "garbage", "12junk", "2147483648"]) {
    writeFileSync(file, contents);
    assert.throws(() => acquireLauncherLock(file), /锁文件无效/);
    assert.equal(readFileSync(file, "utf8"), contents);
  }
  assert.equal(probe.mock.callCount(), 0);
});

test("permission failures never count as evidence that an owner exited", (t) => {
  const file = lockFile(t);
  writeFileSync(file, "123");
  t.mock.method(process, "kill", () => {
    throw Object.assign(new Error("denied"), { code: "EPERM" });
  });
  assert.throws(() => acquireLauncherLock(file), /无法确认演示进程 PID 123/);
  assert.equal(readFileSync(file, "utf8"), "123");
});

test("releasing a replaced lock preserves the replacement", (t) => {
  const file = lockFile(t);
  const release = acquireLauncherLock(file);
  renameSync(file, `${file}.old`);
  writeFileSync(file, String(process.pid));
  release();
  assert.equal(readFileSync(file, "utf8"), String(process.pid));
});

test("filesystem failures retain their actual error instead of reporting a running demo", (t) => {
  const file = lockFile(t);
  assert.throws(() => acquireLauncherLock(path.join(file, "missing")), {
    code: "ENOENT",
  });
});
