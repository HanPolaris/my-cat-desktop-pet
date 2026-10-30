export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export function stepToward(
  from: Point,
  to: Point,
  speed: number,
  seconds: number,
): Point {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    d = Math.hypot(dx, dy),
    step = Math.min(d, speed * Math.min(0.1, Math.max(0, seconds)));
  return d
    ? { x: from.x + (dx / d) * step, y: from.y + (dy / d) * step }
    : { ...from };
}
export function clampAnchor(point: Point, areas: Rect[]): Point {
  const distance = (a: Rect) =>
    Math.hypot(
      point.x - Math.max(a.x, Math.min(a.x + a.width, point.x)),
      point.y - Math.max(a.y, Math.min(a.y + a.height, point.y)),
    );
  const area = areas.reduce((best, a) =>
    distance(a) < distance(best) ? a : best,
  );
  return {
    x: Math.max(area.x + 96, Math.min(area.x + area.width - 96, point.x)),
    y: Math.max(area.y + 104, Math.min(area.y + area.height - 104, point.y)),
  };
}
