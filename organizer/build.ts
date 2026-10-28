import { cp, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
await mkdir(`${root}build/assets`, { recursive: true });
await cp(`${root}public`, `${root}build`, { recursive: true });
await cp(`${root}../assets/firelink.svg`, `${root}build/assets/firelink.svg`);
const vendor = `${root}node_modules/beercss/dist/cdn`;
for (const name of await readdir(vendor)) {
  if (/^(beer\.min\.(css|js)|.*\.woff2)$/.test(name))
    await cp(`${vendor}/${name}`, `${root}build/assets/${name}`);
}
await cp(
  `${root}node_modules/leaflet/dist/leaflet.css`,
  `${root}build/assets/leaflet.css`,
);
const result = await Bun.build({
  entrypoints: [`${root}src/app.ts`],
  outdir: `${root}build/assets`,
  target: "browser",
  minify: true,
  naming: "app.js",
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
console.log("Organizer built → organizer/build");
