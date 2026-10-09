/**
 * Reads range / target limits from a dnd5e activity and measures distance.
 * All data access is defensive: dnd5e's activity schema has shifted between releases.
 */

const REACH_DEFAULT = 5;

/** Convert a distance in the given units to the scene's grid units (assumes ft/mi/m/km scenes). */
function toFeet(value, units) {
  switch (units) {
    case "mi": return value * 5280;
    case "m": return value * 3.28084;
    case "km": return value * 3280.84;
    default: return value;
  }
}

/**
 * Describe the range written on the activity/item (dnd5e 6.0 data model).
 * Activity range: { value, units, special, override }. Units are movementUnits (ft/mi/m/km)
 * or rangeTypes (self/touch/spec/any). Weapon attack activities without `range.override`
 * use the item's range { value, long, reach, units } instead.
 * @returns {{kind: "self"|"touch"|"ranged"|"unlimited"|"special", normal: number, long: number, label: string}}
 */
export function getRange(activity) {
  const item = activity.item;
  const r = activity.range ?? {};
  const itemRange = item?.system?.range ?? {};
  const isWeaponAttack = item?.type === "weapon" && activity.type === "attack" && !r.override;

  if (isWeaponAttack) {
    const units = itemRange.units || "ft";
    const attackType = activity.attack?.type?.value;
    const thrown = activity.attack?.type?.classification === "weapon" && item.system.properties?.has?.("thr");
    const melee = attackType === "melee" && !thrown;
    if (melee) {
      const reach = toFeet(Number(itemRange.reach) || REACH_DEFAULT, units);
      return { kind: "touch", normal: reach, long: reach, label: `Reach ${reach} ft` };
    }
    const normal = toFeet(Number(itemRange.value) || 0, units);
    const long = toFeet(Number(itemRange.long) || 0, units);
    if (normal) {
      return { kind: "ranged", normal, long: Math.max(normal, long),
        label: long > normal ? `${itemRange.value}/${itemRange.long} ${units}` : `${itemRange.value} ${units}` };
    }
  }

  const units = r.units;
  if (units === "self") return { kind: "self", normal: 0, long: 0, label: "Self" };
  if (units === "any") return { kind: "unlimited", normal: Infinity, long: Infinity, label: "Any" };
  if (units === "spec") return { kind: "special", normal: Infinity, long: Infinity, label: r.special || "Special" };
  if (units === "touch") {
    const reach = toFeet(Number(itemRange.reach) || REACH_DEFAULT, itemRange.units || "ft");
    return { kind: "touch", normal: reach, long: reach, label: `Touch (${reach} ft)` };
  }

  const value = Number(r.value) || 0;
  if (!units || !value) return { kind: "unlimited", normal: Infinity, long: Infinity, label: "None" };
  const ft = toFeet(value, units);
  return { kind: "ranged", normal: ft, long: ft, label: `${value} ${units}` };
}

/** Target types that never involve picking tokens. */
const NO_PICK_TYPES = new Set(["self", "space"]);

/**
 * Maximum number of picked targets as written; null when no token prompt applies.
 * Fields: target.affects { count (deterministic formula, string), type, choice, special }.
 */
export function getMaxTargets(activity) {
  // Area effects hit whoever is inside the template, not picked tokens.
  if (activity.target?.template?.type) return null;
  const affects = activity.target?.affects ?? {};
  if (NO_PICK_TYPES.has(affects.type)) return null;

  const n = Number.parseInt(affects.count, 10);
  if (Number.isFinite(n) && n > 0) return n;
  if (affects.count) {
    try {
      const val = new Roll(String(affects.count), activity.getRollData?.() ?? {}).evaluateSync().total;
      if (val > 0) return Math.floor(val);
    } catch (e) { /* fall through */ }
  }
  // Attacks (and anything naming a target type) with no count default to a single target.
  if (activity.type === "attack" || affects.type) return 1;
  return null;
}

/** Shortest token-edge to token-edge distance in scene units, including elevation difference. */
export function distanceBetween(a, b) {
  const grid = canvas.grid;
  const unit = canvas.dimensions.distance / canvas.dimensions.size;
  const ra = a.bounds, rb = b.bounds;
  const dx = Math.max(rb.left - ra.right, ra.left - rb.right, 0);
  const dy = Math.max(rb.top - ra.bottom, ra.top - rb.bottom, 0);
  let planar;
  if (grid.isGridless || grid.isHexagonal === undefined) {
    planar = Math.hypot(dx, dy) * unit;
  } else {
    // Measure between nearest points, then round to grid movement rules.
    const from = { x: dx ? (ra.right <= rb.left ? ra.right - 1 : ra.left + 1) : Math.max(ra.left, rb.left) + 1,
                   y: dy ? (ra.bottom <= rb.top ? ra.bottom - 1 : ra.top + 1) : Math.max(ra.top, rb.top) + 1 };
    const to = { x: dx ? (ra.right <= rb.left ? rb.left + 1 : rb.right - 1) : from.x,
                 y: dy ? (ra.bottom <= rb.top ? rb.top + 1 : rb.bottom - 1) : from.y };
    planar = grid.measurePath([from, to]).distance;
    // Adjacent tokens: measurePath between inner points of neighbours yields one square.
    if (dx === 0 && dy === 0) planar = 0;
  }
  const dz = Math.abs((a.document.elevation ?? 0) - (b.document.elevation ?? 0));
  return Math.hypot(planar, dz);
}

/** Returns "ok" | "long" | "out" for a measured distance. */
export function rangeStatus(range, distance) {
  if (range.kind === "unlimited" || range.kind === "special") return "ok";
  if (distance <= range.normal + 0.01) return "ok";
  if (distance <= range.long + 0.01) return "long";
  return "out";
}
