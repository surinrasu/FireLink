import type { ContentBlock, MapAnnotation } from "./organizer";

export const MAX_MAP_ANNOTATIONS = 50;
export const MAX_MAP_POINTS = 200;
export const mapAnnotationLabels = {
  point: "位置",
  path: "路径",
  area: "范围",
};
export const mapMinimumPoints = { point: 1, path: 2, area: 3 };

export function validCoordinates(
  latitude: unknown,
  longitude: unknown,
): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

export function mapAnnotations(
  block: Pick<ContentBlock, "annotations" | "latitude" | "longitude">,
): MapAnnotation[] {
  if (block.annotations !== undefined) return block.annotations;
  return validCoordinates(block.latitude, block.longitude)
    ? [
        {
          type: "point",
          coordinates: [
            { latitude: block.latitude!, longitude: block.longitude! },
          ],
        },
      ]
    : [];
}

export function completeMapAnnotation(annotation: MapAnnotation): boolean {
  const points = annotation.coordinates;
  const valid =
    points.every((point) =>
      validCoordinates(point.latitude, point.longitude),
    ) &&
    (annotation.type !== "point" || points.length === 1) &&
    new Set(points.map((point) => `${point.latitude},${point.longitude}`))
      .size >= mapMinimumPoints[annotation.type];
  if (!valid || annotation.type !== "area") return valid;
  const origin = points[0];
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return (
      sum +
      (point.longitude - origin.longitude) * (next.latitude - origin.latitude) -
      (next.longitude - origin.longitude) * (point.latitude - origin.latitude)
    );
  }, 0);
  return Math.abs(area) > Number.EPSILON;
}

export function completeMap(
  block: Pick<ContentBlock, "annotations" | "latitude" | "longitude">,
): boolean {
  const annotations = mapAnnotations(block);
  return annotations.length > 0 && annotations.every(completeMapAnnotation);
}
