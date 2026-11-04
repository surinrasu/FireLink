import catalog from "./regions.json";

export interface RegionNode {
  code: string;
  name: string;
  children?: RegionNode[];
}
export const mainlandRegions: RegionNode[] = catalog;
export const municipalityCodes = new Set(["11", "12", "31", "50"]);
const groupingNames = new Set([
  "市辖区",
  "县",
  "省直辖县级行政区划",
  "自治区直辖县级行政区划",
]);
export const regionNames = (path: RegionNode[]) =>
  path.map((node) => node.name).filter((name) => !groupingNames.has(name));
export const regionLabel = (path: RegionNode[]) => regionNames(path).join(" ");
const paths = new Map<string, RegionNode[]>();
function index(nodes: RegionNode[], parents: RegionNode[] = []) {
  for (const node of nodes) {
    const path = [...parents, node];
    paths.set(node.code, path);
    if (node.children) index(node.children, path);
  }
}
index(mainlandRegions);
export const regionPath = (code: string) => paths.get(code) ?? [];
export const isCompleteRegion = (path: RegionNode[]) =>
  path.length > 0 && !path.at(-1)?.children?.length;
const normalize = (value: string) => value.replace(/[\s/／]/g, "");
export function regionSelection(value: string) {
  const label = normalize(value);
  return (
    [...paths.values()].find(
      (path) =>
        normalize(regionLabel(path)) === label ||
        normalize(path.map((node) => node.name).join("")) === label,
    ) ?? []
  );
}
