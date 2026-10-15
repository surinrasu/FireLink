import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, api } from "../state.ts";
import { TOKEN } from "../scenes.ts";

test("vehicle counts and free-form equipment use the same validation and persistence in the demo", () => {
  const state = createState("profile");
  const auth = `Bearer ${TOKEN}`;
  const invalid = api(
    state,
    "PATCH",
    "/v1/me",
    { vehicles: { sedan: -1 } },
    auth,
  );
  assert.equal(invalid.status, 400);
  assert.ok("error" in invalid.body && invalid.body.error.includes("轿车"));
  const equipmentDescription = "任意物资、用途\n自由填写";
  const vehicles = { motorcycle: 2, cargoVan: 1 };
  assert.equal(
    api(state, "PATCH", "/v1/me", { vehicles, equipmentDescription }, auth)
      .status,
    200,
  );
  assert.deepEqual(state.profile.vehicles, vehicles);
  assert.equal(state.profile.equipmentDescription, equipmentDescription);
  api(
    state,
    "PATCH",
    "/v1/me",
    { vehicles: {}, equipmentDescription: "" },
    auth,
  );
  assert.deepEqual(state.profile.vehicles, {});
  assert.equal(state.profile.equipmentDescription, "");
});
