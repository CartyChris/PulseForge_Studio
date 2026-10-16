import { describe, it, expect } from "vitest";
import { EFFECT_DEFS, softClipCurve, CLIP_HEADROOM } from "./effects";
import { EffectTypeSchema } from "../../shared/project";

// Node has no AudioContext, so node instantiation is verified in the browser smoke
// (S5). These checks catch the failure mode that actually bites: an EffectType in the
// schema with no def (or a def with unusable parameter ranges) — a mixer crash at runtime.
describe("effect definitions", () => {
  const types = EffectTypeSchema.options;

  it("every schema effect type has a definition", () => {
    for (const t of types) {
      expect(EFFECT_DEFS[t], `missing def for "${t}"`).toBeDefined();
      expect(EFFECT_DEFS[t].type).toBe(t);
      expect(EFFECT_DEFS[t].name.length).toBeGreaterThan(0);
      expect(EFFECT_DEFS[t].create).toBeTypeOf("function");
    }
  });

  it("no orphan definitions outside the schema", () => {
    for (const key of Object.keys(EFFECT_DEFS)) expect(types).toContain(key as (typeof types)[number]);
  });

  it("every effect exposes at least one editable parameter with a sane range", () => {
    for (const t of types) {
      const def = EFFECT_DEFS[t];
      expect(def.params.length, `${t} has no params`).toBeGreaterThan(0);
      const keys = new Set<string>();
      for (const p of def.params) {
        expect(p.max, `${t}.${p.key} max<=min`).toBeGreaterThan(p.min);
        expect(p.default, `${t}.${p.key} default below min`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${t}.${p.key} default above max`).toBeLessThanOrEqual(p.max);
        expect(keys.has(p.key), `${t} duplicate param ${p.key}`).toBe(false);
        keys.add(p.key);
      }
    }
  });

  it("ships at least 25 effects", () => {
    expect(types.length).toBeGreaterThanOrEqual(25);
  });
});

describe("limiter safety clipper", () => {
  const at = (curve: Float32Array, x: number) => curve[Math.round(((x / CLIP_HEADROOM + 1) / 2) * (curve.length - 1))]!;
  it("never exceeds the ceiling, even +12 dB over", () => {
    for (const db of [-6, -1, 0]) {
      const c = 10 ** (db / 20), curve = softClipCurve(db);
      for (const v of curve) expect(Math.abs(v)).toBeLessThanOrEqual(c + 1e-6);
      expect(at(curve, CLIP_HEADROOM)).toBeGreaterThan(c * 0.99); // reaches the ceiling, doesn't collapse
    }
  });
  it("is transparent below the knee and odd-symmetric", () => {
    const curve = softClipCurve(-1);
    expect(at(curve, 0.5)).toBeCloseTo(0.5, 2);
    expect(at(curve, -0.5)).toBeCloseTo(-0.5, 2);
    expect(at(curve, 0)).toBeCloseTo(0, 2);
  });
});
