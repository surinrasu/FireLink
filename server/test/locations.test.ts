import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  isCompleteRegion,
  mainlandRegions,
  regionLabel,
  regionPath,
  regionSelection,
} from "../../shared/regions";
import { locationResults, locationURL } from "../src/organizer-locations";

test("mainland regions resolve municipalities, ordinary districts and cities without districts", () => {
  assert.equal(mainlandRegions.length, 31);
  for (const code of ["110101", "500236", "330106", "441900003"]) {
    const path = regionPath(code);
    assert.ok(isCompleteRegion(path), code);
    assert.equal(regionSelection(regionLabel(path)).at(-1)?.code, code);
  }
  assert.equal(regionLabel(regionPath("110101")), "北京市 东城区");
  assert.equal(regionSelection("北京市 市辖区 东城区").at(-1)?.code, "110101");
  assert.equal(regionSelection("浙江省杭州市西湖区").at(-1)?.code, "330106");
  assert.equal(isCompleteRegion(regionPath("33")), false);
  assert.equal(isCompleteRegion(regionPath("3301")), false);
  assert.equal(isCompleteRegion(regionSelection("港澳台")), false);
});
test("OSM searches are scoped to the selected mainland region and malformed results are excluded", () => {
  const url = locationURL("https://search.example/nominatim/", {
    kind: "search",
    regionCode: "110101",
    query: "图书馆",
  });
  assert.equal(url.pathname, "/nominatim/search");
  assert.equal(url.searchParams.get("q"), "图书馆, 东城区, 北京市");
  assert.equal(url.searchParams.get("countrycodes"), "cn");
  assert.equal(
    locationURL("https://search.example", {
      kind: "search",
      query: "杭州市社区服务中心",
      regionCode: "3301",
    }).searchParams.get("q"),
    "杭州市社区服务中心, 杭州市, 浙江省",
  );
  assert.equal(
    locationURL("https://search.example", {
      kind: "search",
      query: "杭州市社区服务中心",
    }).searchParams.get("q"),
    "杭州市社区服务中心",
  );
  assert.throws(() =>
    locationURL("https://search.example", {
      kind: "search",
      query: "社区服务中心",
      regionCode: "invalid",
    }),
  );
  assert.deepEqual(
    locationResults(
      [
        {
          lat: "30",
          lon: "120",
          display_name: "图书馆, 杭州市",
          address: { country_code: "cn" },
        },
        { lat: "91", lon: "120", display_name: "invalid" },
        { lat: "x", lon: "120", display_name: "invalid" },
        {
          lat: "30",
          lon: "120",
          display_name: "elsewhere",
          address: { country_code: "us" },
        },
      ],
      false,
    ),
    [
      {
        name: "图书馆",
        address: "图书馆, 杭州市",
        latitude: 30,
        longitude: 120,
      },
    ],
  );
  assert.deepEqual(locationResults({ error: "unable to geocode" }, true), []);
});
