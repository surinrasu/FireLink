import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { Server } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  findSdk,
  imageArchitecture,
  sdkManager,
  selectImage,
  provisionAvd,
  emulatorPort,
  portFree,
} from "./platform.ts";
import { createDemoServer } from "./server.ts";
import { createBridge } from "./adb.ts";
const directory = fileURLToPath(new URL(".", import.meta.url));
const android = path.resolve(directory, "../android");
const artifacts = path.join(directory, ".artifacts");
const avdRoot = path.join(artifacts, "avd");
const suffix = process.platform === "win32" ? ".exe" : "";
const port = Number(process.env.DEMO_PORT || 4173);
let emulator: ChildProcess | undefined;
let server: Server | undefined;
let serial = "";
let adb = "";
let restoreProperties: (() => Promise<void>) | null = null;
let lockOwned = false;
let stopping = false;
const children = new Set<ChildProcess>();
function run(
  command: string,
  args: string[],
  { capture = false, ...options }: SpawnOptions & { capture?: boolean } = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const batch = process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
    // cmd.exe needs explicit quoting for SDK/JDK paths containing spaces.
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const child = spawn(
      batch ? quote(command) : command,
      batch ? args.map(quote) : args,
      {
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
        shell: batch,
        ...options,
      },
    );
    children.add(child);
    let output = "";
    child.stdout?.on("data", (c) => {
      output += c;
    });
    child.stderr?.on("data", (c) => {
      output += c;
    });
    child.once("error", (e) => {
      children.delete(child);
      reject(e);
    });
    child.once("exit", (code) => {
      children.delete(child);
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `${path.basename(command)} 执行失败 (${code})\n${output}`,
            ),
          );
    });
  });
}
async function cleanup(code = 0) {
  if (stopping) return;
  stopping = true;
  if (server) {
    server.closeAllConnections();
    server.close();
  }
  if (emulator && serial && adb)
    await run(adb, ["-s", serial, "emu", "kill"], { capture: true }).catch(
      () => {},
    );
  for (const child of children) child.kill();
  emulator?.kill();
  if (restoreProperties) await restoreProperties();
  if (lockOwned)
    await rm(path.join(artifacts, "launcher.lock"), { force: true });
  process.exit(code);
}
process.on("SIGINT", () => cleanup());
process.on("SIGTERM", () => cleanup());
try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("DEMO_PORT 必须是 1024–65535 之间的端口");
  const sdk = findSdk(),
    abi = imageArchitecture(),
    image = selectImage(sdk, abi);
  adb = path.join(sdk, "platform-tools", `adb${suffix}`);
  const emulatorPath = path.join(sdk, "emulator", `emulator${suffix}`);
  const env = {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    ANDROID_AVD_HOME: avdRoot,
  };
  const mise = await run("mise", ["--version"], { capture: true }).then(
    () => true,
    () => false,
  );
  const packages = [
    [adb, "platform-tools"],
    [emulatorPath, "emulator"],
    [path.join(sdk, image.relative, "system.img"), image.package],
    [
      path.join(sdk, "platforms/android-35/android.jar"),
      "platforms;android-35",
    ],
    [path.join(sdk, "build-tools/35.0.0/aapt2" + suffix), "build-tools;35.0.0"],
  ]
    .filter(([file]) => !existsSync(file))
    .map(([, name]) => name);
  console.log(
    `平台：${process.platform}/${process.arch} → ${abi}\nAndroid SDK：${sdk}\n系统镜像：${image.package}`,
  );
  if (process.argv.includes("--check")) {
    console.log(
      packages.length
        ? `待安装：${packages.join(", ")}`
        : "Android 工具与镜像齐全",
    );
    console.log(
      mise
        ? "构建：mise 管理的 Java / Gradle"
        : "构建：Gradle Wrapper（需要 JDK 17–23）",
    );
    process.exit(0);
  }
  if (!(await portFree(port)))
    throw new Error(`端口 ${port} 已被使用。请停止旧演示，或设置 DEMO_PORT。`);
  if (
    !existsSync(
      path.join(directory, "node_modules/beercss/dist/cdn/beer.min.css"),
    )
  )
    throw new Error("请先在 presentation 目录执行 npm ci。");
  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(artifacts, "launcher.lock"), String(process.pid), {
    flag: "wx",
  }).catch(() => {
    throw new Error(
      "演示已在运行，或上次启动意外退出。确认旧演示已停止后，删除 presentation/.artifacts/launcher.lock 再启动。",
    );
  });
  lockOwned = true;
  if (packages.length) {
    const manager = await sdkManager(sdk);
    if (!manager)
      throw new Error(
        "需要 Android SDK Command-line Tools (latest)。请在 Android Studio → SDK Manager → SDK Tools 中安装，再重试。",
      );
    console.log(
      "正在安装缺少的 Android 组件；若出现 SDK 许可提示，请在终端确认。",
    );
    await run(manager, [`--sdk_root=${sdk}`, ...packages], { env });
  }
  console.log("构建独立演示 APK…");
  const gradleArgs = ["--console=plain", ":app:assembleDemo"];
  // Temporarily resolve the SDK for this machine, preserving other local settings.
  const properties = path.join(android, "local.properties");
  const { readFile } = await import("node:fs/promises");
  const original = await readFile(properties, "utf8").catch(() => "");
  const sdkProperty = sdk.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  const configured =
    original.replace(/^sdk\.dir=.*\r?\n?/m, "") + `\nsdk.dir=${sdkProperty}\n`;
  restoreProperties = async () => {
    if (original) await writeFile(properties, original);
    else await rm(properties, { force: true });
  };
  try {
    await writeFile(properties, configured);
    if (mise)
      await run(
        "mise",
        ["-C", android, "exec", "--", "gradle", ...gradleArgs],
        { env },
      );
    else
      await run(
        path.join(
          android,
          process.platform === "win32" ? "gradlew.bat" : "gradlew",
        ),
        gradleArgs,
        { cwd: android, env },
      );
  } finally {
    await restoreProperties();
    restoreProperties = null;
  }
  const name = await provisionAvd(avdRoot, image, abi);
  const emuPort = await emulatorPort();
  serial = `emulator-${emuPort}`;
  console.log(`启动专用 AVD：${name}（${serial}）…`);
  const log = openSync(path.join(artifacts, "emulator.log"), "a");
  emulator = spawn(
    emulatorPath,
    [
      "-avd",
      name,
      "-port",
      String(emuPort),
      "-no-snapshot",
      "-no-audio",
      "-no-boot-anim",
      ...(process.env.CI ? ["-gpu", "swiftshader"] : []),
      "-camera-back",
      "none",
      "-camera-front",
      "none",
      ...(process.argv.includes("--window") ? [] : ["-no-window"]),
    ],
    { env, stdio: ["ignore", log, log] },
  );
  closeSync(log);
  let emulatorError: Error | undefined;
  emulator.on("error", (e) => {
    emulatorError = e;
  });
  const deadline = Date.now() + 180000;
  let booted = false;
  for (let count = 0; Date.now() < deadline; count++) {
    if (emulatorError || emulator.exitCode !== null)
      throw new Error(
        `AVD 启动失败，请查看 presentation/.artifacts/emulator.log。${emulatorError?.message || ""}`,
      );
    booted = await run(
      adb,
      ["-s", serial, "shell", "getprop", "sys.boot_completed"],
      { capture: true, timeout: 5000 },
    ).then(
      (s) => s.trim() === "1",
      () => false,
    );
    if (booted) break;
    if (count % 5 === 0) console.log("等待 Android 启动…");
    await sleep(2000);
  }
  if (!booted)
    throw new Error("AVD 启动超时。请检查系统虚拟化支持及 emulator.log。");
  const shell = (...args: string[]) =>
    run(adb, ["-s", serial, "shell", ...args], { capture: true });
  await run(
    adb,
    [
      "-s",
      serial,
      "install",
      "-r",
      path.join(android, "app/build/outputs/apk/demo/app-demo.apk"),
    ],
    { capture: true },
  );
  for (const animation of [
    "window_animation_scale",
    "transition_animation_scale",
    "animator_duration_scale",
  ])
    await shell("settings", "put", "global", animation, "0");
  await shell("settings", "put", "system", "accelerometer_rotation", "0");
  await shell("settings", "put", "system", "user_rotation", "0");
  await shell("settings", "put", "system", "screen_off_timeout", "2147483647");
  await shell("settings", "put", "system", "font_scale", "1.0");
  await shell("wm", "size", "1080x1920");
  await shell("wm", "density", "420");
  await shell("settings", "put", "global", "sysui_demo_allowed", "1");
  await shell(
    "am",
    "broadcast",
    "-a",
    "com.android.systemui.demo",
    "--es",
    "command",
    "clock",
    "--es",
    "hhmm",
    "0900",
  );
  await shell(
    "am",
    "broadcast",
    "-a",
    "com.android.systemui.demo",
    "--es",
    "command",
    "battery",
    "--es",
    "level",
    "100",
    "--es",
    "plugged",
    "false",
  );
  await shell(
    "am",
    "broadcast",
    "-a",
    "com.android.systemui.demo",
    "--es",
    "command",
    "notifications",
    "--es",
    "visible",
    "false",
  );
  await shell("input", "keyevent", "82");
  await shell("svc", "power", "stayon", "true");
  // Android itself also stays offline. adb reverse supplies the only app endpoint.
  await shell("cmd", "connectivity", "airplane-mode", "enable");
  await shell("svc", "wifi", "disable");
  const bridge = createBridge({ adb, serial });
  server = createDemoServer({ bridge, port });
  server.on("error", (e) => {
    console.error(e.message);
    cleanup(1);
  });
  await new Promise<void>((resolve) =>
    server!.listen(port, "127.0.0.1", resolve),
  );
  console.log(
    `\nFireLink 演示已就绪：http://127.0.0.1:${port}\n浏览器打开即可。← → 翻页，R 重置。深浅主题跟随系统。\nCtrl+C 同时停止服务和本项目启动的 AVD。`,
  );
  emulator.once("exit", () => {
    if (!stopping) {
      console.error("AVD 已退出");
      cleanup(1);
    }
  });
  if (process.argv.includes("--screenshots")) {
    const { captureScreenshots } = await import("./screenshots.ts");
    await captureScreenshots(port);
    await cleanup(0);
  }
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  await cleanup(1);
}
