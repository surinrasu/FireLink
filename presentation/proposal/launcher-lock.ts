import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";

function sameFile(file: string, expected: Stats): boolean {
  try {
    const current = statSync(file);
    return current.dev === expected.dev && current.ino === expected.ino;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// Keep acquisition synchronous so a signal cannot interrupt ownership tracking.
export function acquireLauncherLock(file: string): () => void {
  for (let attempt = 0; attempt < 3; attempt++) {
    let descriptor: number;
    try {
      descriptor = openSync(file, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let previous: Stats;
      let contents: string;
      try {
        const existing = openSync(file, "r");
        try {
          previous = fstatSync(existing);
          contents = readFileSync(existing, "utf8").trim();
        } finally {
          closeSync(existing);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const pid = Number(contents);
      if (
        !/^[1-9]\d*$/.test(contents) ||
        !Number.isSafeInteger(pid) ||
        pid > 2147483647
      )
        throw new Error(
          `演示锁文件无效：${file}。确认旧演示已停止后，删除该文件再启动。`,
        );
      try {
        process.kill(pid, 0);
      } catch (error) {
        // EPERM also means the process may be alive. Only ESRCH proves it exited.
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          throw new Error(
            `无法确认演示进程 PID ${pid} 是否已退出，保留锁文件：${file}`,
            { cause: error },
          );
        if (sameFile(file, previous)) {
          try {
            unlinkSync(file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        continue;
      }
      throw new Error(`演示已在运行（PID ${pid}）。请先停止该进程再启动。`);
    }
    const owned = fstatSync(descriptor);
    try {
      writeFileSync(descriptor, String(process.pid));
    } catch (error) {
      if (sameFile(file, owned)) unlinkSync(file);
      throw error;
    } finally {
      closeSync(descriptor);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (sameFile(file, owned)) unlinkSync(file);
    };
  }
  throw new Error("演示锁文件正在变化，请稍后重试。");
}
