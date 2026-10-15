import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { transform } from "esbuild";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bridge } from "./adb.ts";
import type { DemoInput, DemoStatus, Theme } from "./types.ts";
import { createState, api } from "./state.ts";
import { SCENES, TOKEN } from "./scenes.ts";
import { createBridge } from "./adb.ts";
const directory = fileURLToPath(new URL(".", import.meta.url));
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const json = (res: ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024)
      throw Object.assign(new Error("请求内容过大"), { status: 413 });
    parts.push(chunk);
  }
  try {
    const body: unknown = parts.length
      ? JSON.parse(Buffer.concat(parts).toString())
      : {};
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Expected a JSON object");
    return body as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("请求内容格式错误"), { status: 400 });
  }
}
function validInput(
  input: Record<string, unknown>,
): input is Record<string, unknown> & DemoInput {
  const valid = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  return (
    input.type === "back" ||
    ((input.type === "tap" || input.type === "swipe") &&
      valid(input.x) &&
      valid(input.y) &&
      (input.type === "tap" || (valid(input.endX) && valid(input.endY))))
  );
}
export function createDemoServer({
  bridge,
  port = 4173,
}: {
  bridge: Bridge;
  port?: number;
}) {
  let state = createState();
  let current: string | null = null;
  let revision = 0;
  let theme: Theme = "light";
  let busy = false;
  let error: string | null = null;
  let frame: Buffer | null = null;
  let capturedAt: string | null = null;
  let firstFrame = false;
  let pendingReady: {
    token: string;
    route: string;
    theme: Theme;
    resolve(): void;
  } | null = null;
  let queue = Promise.resolve();
  const session = randomUUID();
  const exclusive = (fn: () => Promise<void>) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const status = (): DemoStatus => ({
    session,
    scene: current,
    revision,
    theme,
    busy,
    error,
    capturedAt,
    device: bridge.serial,
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      // Loopback only, with host/origin checks. No browser on an unrelated site may drive ADB.
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(
          new URL(`http://${req.headers.host}`).hostname,
        )
      )
        return json(res, 403, { error: "仅允许本机访问" });
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`
      )
        return json(res, 403, { error: "不允许跨站控制演示" });
      if (req.method === "OPTIONS")
        return json(res, 405, { error: "不支持此请求" });
      const method = req.method || "GET",
        pathname = url.pathname;
      if (pathname.startsWith("/v1/")) {
        const result = api(
          state,
          method,
          pathname,
          ["POST", "PATCH"].includes(method) ? await readBody(req) : {},
          req.headers.authorization,
        );
        return json(res, result.status, result.body);
      }
      if (pathname === "/api/demo/scenes" && method === "GET")
        return json(res, 200, SCENES);
      if (pathname === "/api/demo/status" && method === "GET")
        return json(res, 200, status());
      if (pathname === "/api/demo/ready" && method === "POST") {
        if (req.headers.authorization !== `Bearer ${TOKEN}`)
          return json(res, 401, { error: "需要演示应用认证" });
        const body = await readBody(req);
        if (
          !pendingReady ||
          body.token !== pendingReady.token ||
          body.route !== pendingReady.route ||
          body.theme !== pendingReady.theme
        )
          return json(res, 409, { error: "场景已切换" });
        pendingReady.resolve();
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/demo/scene" && method === "POST") {
        const body = await readBody(req);
        const nextTheme = body.theme;
        const scene = SCENES.find((s) => s.id === body.id);
        if (!scene || (nextTheme !== "light" && nextTheme !== "dark"))
          return json(res, 400, { error: "场景或主题无效" });
        if (busy) return json(res, 409, { error: "正在切换，请稍候" });
        busy = true;
        error = null;
        frame = null;
        firstFrame = false;
        capturedAt = null;
        revision++;
        try {
          await exclusive(async () => {
            theme = nextTheme;
            const token = randomUUID();
            const ready = new Promise<void>((resolve) => {
              pendingReady = { token, route: scene.route, theme, resolve };
            });
            await bridge.activate(
              scene,
              theme,
              port,
              () => {
                state = createState(scene.id);
              },
              {
                token,
                async wait() {
                  const timeout = new AbortController();
                  try {
                    return await Promise.race([
                      ready.then(() => true),
                      sleep(1500, false, { signal: timeout.signal }),
                    ]);
                  } finally {
                    timeout.abort();
                  }
                },
              },
            );
            frame = await bridge.frame();
            firstFrame = true;
            capturedAt = new Date().toISOString();
            current = scene.id;
          });
          return json(res, 200, { ...status(), busy: false });
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          current = null;
          frame = null;
          throw e;
        } finally {
          pendingReady = null;
          busy = false;
        }
      }
      if (pathname === "/api/demo/frame" && method === "GET") {
        const requested = Number(url.searchParams.get("revision"));
        if (busy || !current || requested !== revision)
          return json(res, 409, { error: "画面正在准备" });
        await exclusive(async () => {
          if (busy || requested !== revision) return;
          // Activation already captured a verified frame. Consume it once, then
          // resume fresh captures so interaction never freezes on a cached image.
          if (!firstFrame) {
            frame = await bridge.frame();
            capturedAt = new Date().toISOString();
          }
          firstFrame = false;
        });
        if (busy || requested !== revision)
          return json(res, 409, { error: "画面已切换" });
        res.writeHead(200, {
          "Content-Type": "image/png",
          "X-Demo-Revision": String(revision),
          "X-Captured-At": capturedAt || "",
        });
        return res.end(frame);
      }
      if (pathname === "/api/demo/input" && method === "POST") {
        const input = await readBody(req);
        if (busy || !current || input.revision !== revision)
          return json(res, 409, { error: "请等待画面就绪" });
        if (!validInput(input)) return json(res, 400, { error: "无效操作" });
        await exclusive(async () => {
          if (!busy && input.revision === revision) {
            firstFrame = false;
            await bridge.input(input);
          }
        });
        return json(res, 200, { ok: true });
      }
      if (method !== "GET" && method !== "HEAD")
        return json(res, 405, { error: "不支持此操作" });
      if (pathname === "/app.js") {
        const source = await readFile(
          path.join(directory, "public/app.ts"),
          "utf8",
        );
        const { code } = await transform(source, {
          loader: "ts",
          format: "esm",
          target: "es2022",
          sourcefile: "app.ts",
        });
        res.writeHead(200, { "Content-Type": types[".js"] });
        return res.end(method === "HEAD" ? undefined : code);
      }
      const base = pathname.startsWith("/vendor/")
        ? path.join(directory, "node_modules/beercss/dist/cdn")
        : path.join(directory, "public");
      const relative = pathname.startsWith("/vendor/")
        ? pathname.slice(8)
        : pathname === "/"
          ? "index.html"
          : pathname.slice(1);
      const target = path.resolve(base, relative);
      if (!target.startsWith(base + path.sep))
        return json(res, 404, { error: "页面不存在" });
      let content = await readFile(target);
      // BeerCSS ships CDN fallbacks in its @font-face rules. Keep every resource local,
      // including fallback declarations, instead of merely relying on CSP to block them.
      if (pathname.startsWith("/vendor/") && path.extname(target) === ".css") {
        content = Buffer.from(
          content
            .toString()
            .replaceAll(
              "https://cdn.jsdelivr.net/npm/beercss@5.0.3/dist/cdn/",
              "/vendor/",
            ),
        );
      }
      res.writeHead(200, {
        "Content-Type":
          types[path.extname(target)] || "application/octet-stream",
      });
      res.end(method === "HEAD" ? undefined : content);
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const missing = e instanceof Error && "code" in e && e.code === "ENOENT";
      const status =
        e instanceof Error && "status" in e && typeof e.status === "number"
          ? e.status
          : 503;
      json(res, missing ? 404 : status, {
        error: missing
          ? "页面不存在"
          : e instanceof Error
            ? e.message
            : String(e),
      });
    }
  });
  server.requestTimeout = 60000;
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const port = Number(process.env.DEMO_PORT || 4173);
  const server = createDemoServer({ bridge: createBridge(), port });
  server.listen(port, "127.0.0.1", () =>
    console.log(`FireLink 演示：http://127.0.0.1:${port}`),
  );
}
