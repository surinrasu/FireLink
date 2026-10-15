import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
export function imageArchitecture(
  platform: string = process.platform,
  arch: string = process.arch,
) {
  if (platform === "darwin" && arch === "arm64") return "arm64-v8a";
  if (["darwin", "linux", "win32"].includes(platform) && arch === "x64")
    return "x86_64";
  throw new Error(
    `此平台尚无受支持的 AVD 自动配置：${platform}/${arch}。请使用 macOS（Apple Silicon / Intel）、Linux x64 或 Windows x64。`,
  );
}
export function sdkCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  home = os.homedir(),
) {
  const join = platform === "win32" ? path.win32.join : path.join;
  return [
    ...new Set(
      [
        env.ANDROID_HOME,
        env.ANDROID_SDK_ROOT,
        platform === "darwin" ? join(home, "Library", "Android", "sdk") : null,
        platform === "linux" ? join(home, "Android", "Sdk") : null,
        platform === "win32"
          ? join(
              env.LOCALAPPDATA || join(home, "AppData", "Local"),
              "Android",
              "Sdk",
            )
          : null,
      ].filter((value): value is string => !!value),
    ),
  ];
}
export function findSdk() {
  const sdk = sdkCandidates().find((p) => existsSync(p));
  if (!sdk)
    throw new Error(
      "未找到 Android SDK。请安装 Android Studio 的 Android SDK，并设置 ANDROID_HOME。无需手动创建 AVD。",
    );
  return path.resolve(sdk);
}
export async function sdkManager(sdk: string) {
  const extension = process.platform === "win32" ? ".bat" : "";
  const directory = path.join(sdk, "cmdline-tools");
  const versions = await readdir(directory).catch(() => []);
  return ["latest", ...versions.sort().reverse()]
    .map((v) => path.join(directory, v, "bin", `sdkmanager${extension}`))
    .find(existsSync);
}
export function selectImage(sdk: string, abi: string) {
  const variant =
    ["google_apis", "google_apis_playstore"].find((tag) =>
      existsSync(
        path.join(sdk, "system-images", "android-35", tag, abi, "system.img"),
      ),
    ) || "google_apis";
  return {
    package: `system-images;android-35;${variant};${abi}`,
    relative: `system-images/android-35/${variant}/${abi}/`,
    variant,
  };
}
export async function provisionAvd(
  root: string,
  image: { relative: string; variant: string },
  abi: string,
) {
  const name = `FireLink_Demo_${abi.replaceAll("-", "_")}`;
  const directory = path.join(root, `${name}.avd`);
  await mkdir(directory, { recursive: true });
  // AVD configuration is generated from this machine's architecture; no existing user AVD is read.
  await writeFile(
    path.join(root, `${name}.ini`),
    `avd.ini.encoding=UTF-8\npath=${directory}\ntarget=android-35\n`,
  );
  await writeFile(
    path.join(directory, "config.ini"),
    Object.entries({
      AvdId: name,
      "avd.ini.displayname": "FireLink Demo",
      "abi.type": abi,
      "hw.cpu.arch": abi === "arm64-v8a" ? "arm64" : "x86_64",
      "hw.cpu.ncore": 4,
      "hw.ramSize": 2048,
      "hw.lcd.width": 1080,
      "hw.lcd.height": 1920,
      "hw.lcd.density": 420,
      "hw.gpu.enabled": "yes",
      "hw.gpu.mode": "auto",
      "hw.keyboard": "yes",
      "hw.mainKeys": "no",
      "hw.battery": "yes",
      "hw.audioInput": "no",
      "hw.camera.back": "none",
      "hw.camera.front": "none",
      "hw.initialOrientation": "portrait",
      "hw.sdCard": "no",
      "disk.dataPartition.size": "2G",
      "fastboot.forceColdBoot": "yes",
      "image.sysdir.1": image.relative,
      "tag.id": image.variant,
      "PlayStore.enabled": image.variant === "google_apis_playstore",
      showDeviceFrame: "no",
    })
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  return name;
}
export const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
export async function emulatorPort() {
  for (let port = 5580; port <= 5680; port += 2)
    if ((await portFree(port)) && (await portFree(port + 1))) return port;
  throw new Error("没有空闲的模拟器端口");
}
