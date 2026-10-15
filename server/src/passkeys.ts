import { Hono } from "hono";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { type App, authorize, fail, issueSession, boundedJSON } from "./index";
import { randomToken, timestamp, asJSON, type Profile } from "./domain";
export const passkeyRoutes = new Hono<App>();
function configured(env: Env) {
  if (!env.RP_ID || env.RP_ID === "localhost" || !env.PASSKEY_ORIGINS)
    fail(503, "passkey_not_configured");
}
const credential = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal("public-key"),
  clientExtensionResults: z.object({}).passthrough(),
});
const registration = z.object({
  challengeId: z.string(),
  response: credential.extend({
    response: z.object({
      clientDataJSON: z.string(),
      attestationObject: z.string(),
      transports: z.array(z.string()).optional(),
    }),
  }),
});
const authentication = z.object({
  challengeId: z.string(),
  response: credential.extend({
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
      userHandle: z.string().optional(),
    }),
  }),
});
passkeyRoutes.get("/.well-known/apple-app-site-association", (c) =>
  c.json({
    webcredentials: { apps: c.env.APPLE_APP_ID ? [c.env.APPLE_APP_ID] : [] },
  }),
);
passkeyRoutes.get("/.well-known/assetlinks.json", (c) =>
  c.json(
    c.env.ANDROID_SHA256
      ? [
          {
            relation: [
              "delegate_permission/common.handle_all_urls",
              "delegate_permission/common.get_login_creds",
            ],
            target: {
              namespace: "android_app",
              package_name: "cn.firelink.volunteer",
              sha256_cert_fingerprints: c.env.ANDROID_SHA256.split(","),
            },
          },
        ]
      : [],
  ),
);
passkeyRoutes.use("/v1/me/passkeys/*", authorize);
passkeyRoutes.use("/v1/me/passkeys", authorize);
passkeyRoutes.get("/v1/me/passkeys", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,created_at AS createdAt FROM passkeys WHERE user_id=?",
      )
        .bind(c.get("user").id)
        .all()
    ).results,
  ),
);
passkeyRoutes.delete("/v1/me/passkeys/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM passkeys WHERE id=? AND user_id=?")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  return c.json({ ok: true });
});
passkeyRoutes.post("/v1/me/passkeys/options", async (c) => {
  configured(c.env);
  const user = c.get("user");
  const existing = (
    await c.env.DB.prepare("SELECT id FROM passkeys WHERE user_id=?")
      .bind(user.id)
      .all<{ id: string }>()
  ).results;
  const options = await generateRegistrationOptions({
    rpName: "FireLink",
    rpID: c.env.RP_ID,
    userID: new Uint8Array(new TextEncoder().encode(user.id)),
    userName: user.username,
    excludeCredentials: existing,
    attestationType: "none",
    supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
  const challengeId = randomToken();
  await c.env.DB.prepare("INSERT INTO challenges VALUES (?, ?, ?, ?, ?)")
    .bind(
      challengeId,
      "passkey-register",
      user.id,
      options.challenge,
      Date.now() + 300000,
    )
    .run();
  return c.json({ challengeId, options });
});
passkeyRoutes.post("/v1/me/passkeys/verify", async (c) => {
  configured(c.env);
  const data = registration.parse(await boundedJSON(c.req.raw));
  const row = await c.env.DB.prepare(
    "DELETE FROM challenges WHERE id=? AND kind=? AND subject=? AND expires_at>? RETURNING payload",
  )
    .bind(data.challengeId, "passkey-register", c.get("user").id, Date.now())
    .first<{ payload: string }>();
  if (!row) fail(400, "passkey_expired");
  try {
    const result = await verifyRegistrationResponse({
      response: data.response,
      expectedChallenge: row.payload,
      expectedOrigin: c.env.PASSKEY_ORIGINS.split(","),
      expectedRPID: c.env.RP_ID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
    if (!result.verified) fail(400, "passkey_invalid");
    const credential = result.registrationInfo.credential;
    await c.env.DB.prepare("INSERT INTO passkeys VALUES (?, ?, ?, ?, ?, ?)")
      .bind(
        credential.id,
        c.get("user").id,
        Buffer.from(credential.publicKey).toString("base64url"),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        timestamp(),
      )
      .run();
  } catch {
    fail(400, "passkey_verify_failed");
  }
  return c.json({ ok: true });
});
passkeyRoutes.post("/v1/auth/passkeys/options", async (c) => {
  configured(c.env);
  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: "required",
  });
  const challengeId = randomToken();
  await c.env.DB.prepare("INSERT INTO challenges VALUES (?, ?, ?, ?, ?)")
    .bind(
      challengeId,
      "passkey-login",
      "",
      options.challenge,
      Date.now() + 300000,
    )
    .run();
  return c.json({ challengeId, options });
});
passkeyRoutes.post("/v1/auth/passkeys/verify", async (c) => {
  configured(c.env);
  const data = authentication.parse(await boundedJSON(c.req.raw));
  const challenge = await c.env.DB.prepare(
    "DELETE FROM challenges WHERE id=? AND kind=? AND expires_at>? RETURNING payload",
  )
    .bind(data.challengeId, "passkey-login", Date.now())
    .first<{ payload: string }>();
  const key = await c.env.DB.prepare(
    "SELECT p.*,u.profile FROM passkeys p JOIN users u ON u.id=p.user_id WHERE p.id=?",
  )
    .bind(data.response.id)
    .first<{
      id: string;
      public_key: string;
      counter: number;
      profile: string;
    }>();
  if (!challenge || !key) fail(400, "passkey_invalid_or_expired");
  try {
    const result = await verifyAuthenticationResponse({
      response: data.response,
      expectedChallenge: challenge.payload,
      expectedOrigin: c.env.PASSKEY_ORIGINS.split(","),
      expectedRPID: c.env.RP_ID,
      credential: {
        id: key.id,
        publicKey: new Uint8Array(Buffer.from(key.public_key, "base64url")),
        counter: key.counter,
      },
      requireUserVerification: true,
    });
    if (!result.verified) fail(400, "passkey_invalid");
    const changed = await c.env.DB.prepare(
      "UPDATE passkeys SET counter=? WHERE id=? AND counter=?",
    )
      .bind(result.authenticationInfo.newCounter, key.id, key.counter)
      .run();
    if (!changed.meta.changes) fail(400, "sign_in_again");
  } catch {
    fail(400, "passkey_verify_failed");
  }
  return c.json(await issueSession(c.env, asJSON<Profile>(key.profile)));
});
