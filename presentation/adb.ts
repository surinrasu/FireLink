import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import type { DemoInput, Scene, Theme } from "./types.ts";
import { PACKAGE } from "./scenes.ts";

export interface Bridge {
  serial: string;
  activate(
    scene: Scene,
    theme: Theme,
    port: number,
    reset: () => void,
  ): Promise<void>;
  frame(): Promise<Buffer>;
  input(input: DemoInput): Promise<void>;
}

const exec = promisify(execFile);
export function createBridge({
  adb = process.env.DEMO_ADB || "adb",
  serial = process.env.DEMO_SERIAL,
}: { adb?: string; serial?: string } = {}): Bridge & {
  hierarchy(): Promise<string>;
} {
  if (!serial || !/^emulator-\d+$/.test(serial))
    throw new Error("请通过 npm start 启动专用 AVD，或设置 DEMO_SERIAL。");
  const run = async (...args: string[]) =>
    (
      await exec(adb, ["-s", serial, ...args], {
        timeout: 20000,
        maxBuffer: 12 * 1024 * 1024,
        encoding: "buffer",
      })
    ).stdout;
  return {
    serial,
    async activate(scene, theme, port, reset) {
      await run("get-state");
      await run("reverse", "tcp:4173", `tcp:${port}`);
      await run("shell", "am", "force-stop", PACKAGE);
      // The dedicated package has no user data. Clear forms, scroll, auth, and saved preferences.
      const clear = (await run("shell", "pm", "clear", PACKAGE)).toString();
      if (!clear.includes("Success"))
        throw new Error("演示 APK 未安装，请重新运行 npm start。");
      reset();
      await run(
        "shell",
        "cmd",
        "uimode",
        "night",
        theme === "dark" ? "yes" : "no",
      );
      await run(
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        `${PACKAGE}/cn.firelink.app.MainActivity`,
        "--es",
        "demoRoute",
        scene.route,
      );
      const deadline = Date.now() + 25000;
      let last = "";
      while (Date.now() < deadline) {
        last = await this.hierarchy();
        if (scene.expected.every((s) => last.includes(s))) return;
        await sleep(250);
      }
      throw new Error(
        `应用尚未到达「${scene.label}」：未找到 ${scene.expected.filter((s) => !last.includes(s)).join("、")}`,
      );
    },
    async hierarchy() {
      return (
        await run(
          "shell",
          "uiautomator dump /data/local/tmp/firelink-demo.xml >/dev/null && cat /data/local/tmp/firelink-demo.xml",
        )
      ).toString();
    },
    async frame() {
      const png = await run("exec-out", "screencap", "-p");
      if (png.readUInt32BE(0) !== 0x89504e47)
        throw new Error("AVD 未返回有效画面");
      return png;
    },
    async input(input) {
      const point = (x: number, y: number) =>
        [Math.round(x * 1079), Math.round(y * 1919)].map(String);
      if (input.type === "tap")
        await run("shell", "input", "tap", ...point(input.x, input.y));
      else if (input.type === "swipe")
        await run(
          "shell",
          "input",
          "swipe",
          ...point(input.x, input.y),
          ...point(input.endX, input.endY),
          "350",
        );
      else if (input.type === "back")
        await run("shell", "input", "keyevent", "4");
    },
  };
}
