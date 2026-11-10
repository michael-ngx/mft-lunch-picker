// The wheel always stops on the segment it chose, fairly and clockwise.
import { describe, expect, it } from "vitest";
import { indexAt, pickIndex, segmentColors, spinTarget, wheelLabel } from "../src/lib/wheel.ts";

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

describe("wheel", () => {
  it("stops on the chosen segment from any starting angle", () => {
    const rand = seeded(7);
    for (let n = 2; n <= 20; n++) {
      let rot = 0;
      for (let k = 0; k < 50; k++) {
        const i = pickIndex(n, rand);
        const next = spinTarget(rot, i, n, rand);
        expect(next).toBeGreaterThanOrEqual(rot + 6 * 360);
        expect(next).toBeLessThan(rot + 7 * 360);
        expect(indexAt(next, n)).toBe(i);
        rot = next;
      }
    }
  });
  it("reads the segment under the pointer", () => {
    expect(indexAt(0, 4)).toBe(0);
    expect(indexAt(-100, 4)).toBe(1);
    expect(indexAt(80, 4)).toBe(3);
  });
  it("picks each segment about equally often", () => {
    const rand = seeded(42);
    const counts = [0, 0, 0, 0, 0];
    for (let k = 0; k < 50_000; k++) counts[pickIndex(5, rand)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(400);
  });
  it("never gives neighbouring segments the same colour", () => {
    for (let n = 2; n <= 20; n++) {
      const c = segmentColors(n);
      for (let i = 0; i < n; i++) expect(c[i].fill).not.toBe(c[(i + 1) % n].fill);
    }
  });
  it("shortens long names", () => {
    expect(wheelLabel("Pho Lien", 6)).toBe("Pho Lien");
    const short = wheelLabel("Restaurant Le Grand Délice du Plateau", 10);
    expect(short).toBe("Restaurant L…");
    expect(short.length).toBeLessThanOrEqual(13);
  });
});
