/* HOME-WHEEL-001: Home's own radial geometry — a full circle with the
   platform nodes equidistant around the centre. This is intentionally
   separate from person-radial.ts, which keeps its own two-branch topology
   for /chains/person; neither file imports the other. */

export type WheelPoint = { x: number; y: number };

export const HOME_WHEEL_STAGE = { width: 200, height: 200 } as const;
export const HOME_WHEEL_CENTER: WheelPoint = { x: 100, y: 100 };
/* Leaves margin for the 84px node, its focus ring and the hover halo on a
   200-unit stage. */
export const HOME_WHEEL_RADIUS = 70;
/* Midpoint between the inner (54%) and outer (96%) circle radii. */
export const HOME_WHEEL_CROWN_RADIUS = 75;
export const HOME_WHEEL_MAX_FLAT_NODES = 8;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `count` positions equidistant around `center` at `radius`, starting at
 * `startAngle`.
 *
 * Angle convention: 0° points right (+x); positive angles rotate clockwise,
 * matching CSS's downward y-axis (so 90° points straight down, 180° left,
 * 270°/-90° straight up). `count <= 0` returns `[]`. Results are
 * deterministic and coordinates are rounded to two decimals.
 */
export function orbitPositions(
  count: number,
  startAngle: number,
  radius: number = HOME_WHEEL_RADIUS,
  center: WheelPoint = HOME_WHEEL_CENTER,
): WheelPoint[] {
  if (count <= 0) return [];
  const step = 360 / count;
  return Array.from({ length: count }, (_, index) => {
    const angle = ((startAngle + index * step) * Math.PI) / 180;
    return {
      x: round(center.x + radius * Math.cos(angle)),
      y: round(center.y + radius * Math.sin(angle)),
    };
  });
}

export type RadialWheelNode = {
  angleDeg: number;
  nodeSize: number;
  position: WheelPoint;
};

/** HOME-WHEEL-002 density contract for the single-level orbit. */
export function wheelNodeSize(count: number): number {
  if (count > HOME_WHEEL_MAX_FLAT_NODES) {
    throw new RangeError('More than 8 tools require HOME-WHEEL-X hierarchical navigation');
  }
  if (count <= 4) return 84;
  if (count <= 6) return 72;
  return 62;
}

/**
 * Place each tool on the middle of the two-dimensional radial crown. The
 * caller owns DOM order, so visual placement never changes keyboard order.
 */
export function radialOrbitLayout(
  count: number,
  startAngle: number,
  radius: number = HOME_WHEEL_CROWN_RADIUS,
  center: WheelPoint = HOME_WHEEL_CENTER,
): RadialWheelNode[] {
  if (count <= 0) return [];
  const nodeSize = wheelNodeSize(count);
  const step = 360 / count;
  return Array.from({ length: count }, (_, index) => {
    const angleDeg = round((startAngle + index * step + 360) % 360);
    const angle = (angleDeg * Math.PI) / 180;
    return {
      angleDeg,
      nodeSize,
      position: {
        x: round(center.x + radius * Math.cos(angle)),
        y: round(center.y + radius * Math.sin(angle)),
      },
    };
  });
}

/** Percent offsets for an HTML node placed over the square stage. */
export function wheelPercent(point: WheelPoint): { left: string; top: string } {
  return {
    left: `${round((point.x / HOME_WHEEL_STAGE.width) * 100)}%`,
    top: `${round((point.y / HOME_WHEEL_STAGE.height) * 100)}%`,
  };
}

export type WheelRay = { originLeft: string; originTop: string; length: number; lengthPercent: number; angleDeg: number };

/**
 * A ray from `from` to `to`: its origin as stage percentages (for `left`/
 * `top`), its length in stage units and as a percentage of the stage width
 * (the stage is square, so one scale serves both axes), and the rotation
 * angle in degrees for an element with `transform-origin: 0 0` (or `left
 * center`) at that origin.
 */
export function wheelRay(from: WheelPoint, to: WheelPoint): WheelRay {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = round((Math.atan2(dy, dx) * 180) / Math.PI);
  const origin = wheelPercent(from);
  return {
    originLeft: origin.left,
    originTop: origin.top,
    length: round(length),
    lengthPercent: round((length / HOME_WHEEL_STAGE.width) * 100),
    angleDeg,
  };
}
