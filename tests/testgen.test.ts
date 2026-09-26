import { describe, it, expect } from "vitest";
import { generateArgs, firstObjectSchema } from "../src/testgen.js";

describe("generateArgs", () => {
  it("fills required string/number/boolean/array/object properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
        flag: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        meta: { type: "object", properties: { id: { type: "string" } } },
      },
      required: ["name", "count", "tags"],
    };
    const { args, skipped } = generateArgs(schema, { requiredOnly: true });
    expect(typeof args.name).toBe("string");
    expect(args.name.length).toBeGreaterThan(0);
    expect(typeof args.count).toBe("number");
    expect(Array.isArray(args.tags)).toBe(true);
    // optional wasn't filled in requiredOnly mode
    expect(skipped).toContain("flag");
    expect(args.flag).toBeUndefined();
  });

  it("uses enum, format and name hints", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["fast", "slow"] },
        url: { type: "string", format: "url" },
        email: { type: "string", format: "email" },
      },
      required: ["mode", "url", "email"],
    };
    const { args } = generateArgs(schema, {});
    expect(args.mode).toBe("fast");
    expect(args.url).toContain("http");
    expect(args.email).toContain("@");
  });

  it("fills all properties when requiredOnly is false", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
      required: ["a"],
    };
    const { args, skipped, filled } = generateArgs(schema, { requiredOnly: false });
    expect(args.b).toBeTypeOf("number");
    expect(skipped).toHaveLength(0);
    expect(filled.length).toBeGreaterThanOrEqual(2);
  });

  it("honors explicit extraArgs", () => {
    const g = generateArgs({ type: "object", properties: { x: { type: "string" } }, required: ["x"] }, {
      extraArgs: { x: "override" },
    });
    expect(g.args.x).toBe("override");
  });

  it("handles empty schema", () => {
    const { args } = generateArgs({ type: "object", properties: {} }, {});
    expect(args).toEqual({});
  });

  it("does not exceed max depth on nested schemas", () => {
    const deep = { type: "object", properties: {} };
    let cursor = deep;
    for (let i = 0; i < 30; i++) {
      cursor.properties = { child: { type: "object", properties: {} } };
      cursor = cursor.properties.child;
    }
    const { args } = generateArgs(deep, {});
    expect(args).toBeDefined();
  });
});

describe("firstObjectSchema", () => {
  it("returns the schema as-is when it has properties", () => {
    const s = { type: "object", properties: { x: {} } };
    expect(firstObjectSchema(s)).toBe(s);
  });

  it("picks the object branch of anyOf/oneOf", () => {
    const s = { anyOf: [{ type: "null" }, { type: "object", properties: { x: { type: "string" } } }] };
    const picked = firstObjectSchema(s) as { properties?: unknown };
    expect(picked.properties).toBeDefined();
  });
});