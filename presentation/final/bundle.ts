import { fileURLToPath } from "node:url";

// Use the same browser bundle for local preview, offline HTML and the deployed site.
export async function buildFinalApp(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./app.ts", import.meta.url))],
    target: "browser",
    format: "iife",
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Final presentation build failed");
  return result.outputs[0].text();
}
