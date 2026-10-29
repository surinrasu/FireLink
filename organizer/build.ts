import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
const output = `${root}build/mng-dash`;
await rm(`${root}build`, { recursive: true, force: true });
await mkdir(`${output}/assets`, { recursive: true });
for (const name of await readdir(`${root}public`)) {
  const directory =
    name.startsWith("_") || name === "robots.txt" ? `${root}build` : output;
  await cp(`${root}public/${name}`, `${directory}/${name}`, {
    recursive: true,
  });
}
await cp(`${root}../assets/firelink.svg`, `${output}/assets/firelink.svg`);
const vendor = `${root}node_modules/beercss/dist/cdn`;
for (const name of await readdir(vendor)) {
  if (/^(beer\.min\.(css|js)|.*\.woff2)$/.test(name))
    await cp(`${vendor}/${name}`, `${output}/assets/${name}`);
}
await cp(
  `${root}node_modules/leaflet/dist/leaflet.css`,
  `${output}/assets/leaflet.css`,
);
const result = await Bun.build({
  entrypoints: [`${root}src/app.ts`],
  outdir: `${output}/assets`,
  target: "browser",
  minify: true,
  naming: "app.js",
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
console.log("Organizer built → organizer/build");
