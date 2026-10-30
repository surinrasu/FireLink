import type { BrowserContext } from "playwright";

/** Local Wrangler accepts this test identity; deployed demo limits stay untouched. */
export async function isolateLocalDemo(context: BrowserContext, url: string) {
  const origin = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) return;
  const identity = crypto.randomUUID();
  await context.route(`${origin.origin}/api/organizer/auth/demo`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "CF-Connecting-IP": identity },
    }),
  );
}
