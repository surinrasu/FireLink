import { URL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

// Wrangler's runtime declarations contain trailing spaces. Keep regenerated
// types clean without reformatting the declarations or changing their headers.
const file = new URL("../worker-configuration.d.ts", import.meta.url);
const source = await readFile(file, "utf8");
const normalized = source.replace(/[\t ]+$/gm, "");
if (source !== normalized) await writeFile(file, normalized);
