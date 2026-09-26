import { describe, it, expect } from "vitest";
import { validateData, validateCallResultShape } from "../src/validate.js";

describe("validateData", () => {
  it("accepts matching data", () => {
    const problems = validateData({ a: 1 }, { type: "object", properties: { a: { type: "number" } }, required: ["a"] });
    expect(problems).toEqual([]);
  });

  it("rejects missing required", () => {
    const problems = validateData({}, { type: "object", required: ["a"] });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("rejects wrong type and does not throw on strict:false", () => {
    const problems = validateData(
      { a: "not-a-number" },
      { type: "object", properties: { a: { type: "number" } }, required: ["a"] }
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("validates enums and arrays", () => {
    expect(validateData("b", { enum: ["a", "b"] })).toEqual([]);
    expect(validateData("c", { enum: ["a", "b"] }).length).toBeGreaterThan(0);
    expect(validateData([1, 2], { type: "array", items: { type: "number" } })).toEqual([]);
  });

  it("returns [] for non-schema inputs", () => {
    expect(validateData("x", undefined)).toEqual([]);
  });
});

describe("validateCallResultShape", () => {
  it("passes a well-formed callTool result", () => {
    const res = validateCallResultShape({ content: [{ type: "text", text: "hi" }], isError: false });
    expect(res.jsonValid).toBe(true);
    expect(res.problems).toEqual([]);
  });

  it("flags a result without content", () => {
    const res = validateCallResultShape({});
    expect(res.jsonValid).toBe(false);
  });

  it("flags non-object results", () => {
    expect(validateCallResultShape("nope").jsonValid).toBe(false);
    expect(validateCallResultShape(null).jsonValid).toBe(false);
  });

  it("flags non-boolean isError", () => {
    const res = validateCallResultShape({ content: [{ type: "text", text: "x" }], isError: "yes" });
    expect(res.jsonValid).toBe(false);
  });
});