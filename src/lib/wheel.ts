// The wheel: which segment sits under the pointer, and how far to turn so a
// randomly chosen segment ends there. Angles are degrees, clockwise, 0 = top.

/** A random number in [0, 1) from the browser's cryptographic generator. */
export function randomUnit(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

export const pickIndex = (n: number, rand: () => number = randomUnit) => Math.min(n - 1, Math.floor(rand() * n));

/** Segment under the top pointer when the wheel is turned `rotation` degrees clockwise. */
export function indexAt(rotation: number, n: number): number {
  const a = 360 / n;
  const under = (((-rotation) % 360) + 360) % 360;
  return Math.min(n - 1, Math.floor(under / a));
}

/** The rotation to animate to (always further clockwise than `current`) so that
 *  segment `index` stops under the pointer, at a random spot away from its edges. */
export function spinTarget(current: number, index: number, n: number, rand: () => number = randomUnit, turns = 6): number {
  const a = 360 / n;
  const spot = (index + 0.15 + 0.7 * rand()) * a;
  const delta = ((((-spot - current) % 360) + 360) % 360);
  return current + turns * 360 + delta;
}

// Blue theme, alternating dark and light so neighbours stand apart.
const PALETTE = [
  { fill: "#1d4ed8", text: "#ffffff" }, { fill: "#bfdbfe", text: "#0b1f4b" },
  { fill: "#0b1f4b", text: "#ffffff" }, { fill: "#60a5fa", text: "#0b1f4b" },
  { fill: "#2563eb", text: "#ffffff" }, { fill: "#dbeafe", text: "#0b1f4b" },
  { fill: "#1e3a8a", text: "#ffffff" }, { fill: "#93c5fd", text: "#0b1f4b" },
];

/** Colours for n segments, so the last never matches the first next to it. */
export function segmentColors(n: number) {
  const out = Array.from({ length: n }, (_, i) => PALETTE[i % PALETTE.length]);
  if (n > 2 && out[n - 1] === out[0]) out[n - 1] = PALETTE[(n % 2 === 0 ? 3 : 4) % PALETTE.length];
  if (n > 2 && out[n - 1] === out[n - 2]) out[n - 1] = PALETTE[5];
  return out;
}

/** A label short enough to fit its segment. */
export function wheelLabel(name: string, n: number): string {
  const max = n <= 4 ? 20 : n <= 8 ? 16 : n <= 12 ? 13 : 10;
  return name.length <= max ? name : name.slice(0, max - 1).trimEnd() + "…";
}
