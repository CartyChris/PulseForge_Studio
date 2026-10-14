import { describe, it, expect } from "vitest";
import { EFFECT_DEFS } from "./effects";
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
