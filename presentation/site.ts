import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFinalApp } from "./final/bundle.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const urls = (html: string, prefix: string) =>
  html.replace(
    /\b(href|src|srcset)="(?![#/]|[a-z]+:)([^"]+)"/g,
    (_, attr, value) => `${attr}="${prefix}${value}"`,
  );

// Both reports share the existing Worker's static-asset deployment.
export async function buildPresentations(siteRoot: string) {
  const proposal = path.join(siteRoot, "pre/proposal");
  const final = path.join(siteRoot, "pre/final");
  await mkdir(path.join(proposal, "vendor"), { recursive: true });
  await mkdir(path.join(final, "assets"), { recursive: true });
  await writeFile(
    path.join(proposal, "index.html"),
    urls(
      await readFile(path.join(root, "proposal/static.html"), "utf8"),
      "/pre/proposal/",
    ),
  );
  for (const name of ["style.css", "static.css", "firelink.svg", "screenshots"])
    await cp(
      path.join(root, "proposal/public", name),
      path.join(proposal, name),
      { recursive: true },
    );
  const bundle = await Bun.build({
    entrypoints: [path.join(root, "proposal/public/static.ts")],
    outdir: proposal,
    naming: "app.js",
    target: "browser",
    minify: true,
  });
  if (!bundle.success)
    throw new AggregateError(bundle.logs, "Proposal build failed");
  const vendor = path.join(root, "../organizer/node_modules/beercss/dist/cdn");
  for (const name of await readdir(vendor)) {
    if (name.endsWith(".woff2"))
      await cp(path.join(vendor, name), path.join(proposal, "vendor", name));
  }
  const css = await readFile(path.join(vendor, "beer.min.css"), "utf8");
  await writeFile(
    path.join(proposal, "vendor/beer.min.css"),
    css.replaceAll(
      "https://cdn.jsdelivr.net/npm/beercss@5.0.3/dist/cdn/",
      "/pre/proposal/vendor/",
    ),
  );

  await writeFile(
    path.join(final, "index.html"),
    urls(
      await readFile(path.join(root, "final/index.html"), "utf8"),
      "/pre/final/",
    ),
  );
  for (const name of [
    "style.css",
    "FireLink-结题汇报.pdf",
    "FireLink-Final-Review-English.pdf",
    "FireLink-结题材料.zip",
  ])
    await cp(path.join(root, "final", name), path.join(final, name));
  await writeFile(path.join(final, "app.js"), await buildFinalApp());
  for (const name of await readdir(path.join(root, "final/assets"))) {
    if (/\.(webp|svg)$/.test(name))
      await cp(
        path.join(root, "final/assets", name),
        path.join(final, "assets", name),
      );
  }
  // Externalize the speaker page's script to keep the site's existing CSP intact.
  let speaker = await readFile(
    path.join(root, "final/FireLink-演讲稿.html"),
    "utf8",
  );
  const scripts: string[] = [];
  speaker = speaker
    .replace(/<script>([\s\S]*?)<\/script>/g, (_, script) => {
      scripts.push(script);
      return "";
    })
    .replace(' onclick="window.print()"', "")
    .replace(
      "</head>",
      '<link rel="icon" href="/pre/final/assets/firelink.svg" type="image/svg+xml"></head>',
    )
    .replace(
      '双击打开同目录的 <strong>FireLink-结题汇报.html</strong>。',
      '<a href="/pre/final" target="_blank" rel="noopener">打开结题汇报</a>。',
    )
    .replace(
      '</button><div class="intro">',
      '</button> <a href="/pre/final/script.pdf">下载讲稿 PDF</a><div class="intro">',
    )
    .replace(
      "</body>",
      '<script src="/pre/final/speaker.js" defer></script></body>',
    );
  scripts.push(
    'document.querySelector(".print").addEventListener("click", () => window.print());',
  );
  await writeFile(path.join(final, "speaker.js"), scripts.join("\n"));
  await writeFile(path.join(final, "script.html"), speaker);
  await cp(
    path.join(root, "final/FireLink-演讲稿.pdf"),
    path.join(final, "script.pdf"),
  );
  console.log("Presentations built → /pre/proposal and /pre/final");
}
