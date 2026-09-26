/**
 * Example-argument generation: turn a tool's `inputSchema` into a plausible
 * sample JSON object so we can smoke-test the tool without user input.
 *
 * Heuristics used:
 *   - `enum` → first entry
 *   - `format: url/email/date-time/uuid/ipv4` → a matching sample
 *   - property name hints (path, file, dir, count, name, text, query…)
 *   - `required` properties always filled; optional ones only in `--fuzz` mode
 */

const FORMAT_SAMPLES: Record<string, unknown> = {
  url: "https://example.com",
  uri: "https://example.com/resource",
  email: "doctor@example.com",
  "date-time": "2026-01-01T00:00:00Z",
  date: "2026-01-01",
  time: "12:00:00",
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  ipv4: "127.0.0.1",
  hostname: "example.com",
  json: "{}",
};

const NAME_HINTS: Record<string, (name: string) => unknown> = {
  // Path-like property names.
  path: (name) => (/file|name|path|dir|folder|location/.test(name) ? "/tmp/example.txt" : "https://example.com/"),
  count: () => 1,
  limit: () => 10,
  max: () => 10,
  min: () => 0,
  name: () => "example",
  id: () => "example-id",
  text: () => "hello from mcp-doctor",
  query: () => "hello from mcp-doctor",
  prompt: () => "hello from mcp-doctor",
  content: () => "hello from mcp-doctor",
  message: () => "hello from mcp-doctor",
  enable: () => true,
  flag: () => true,
  bool: () => true,
  width: () => 100,
  height: () => 100,
  number: () => 1,
  amount: () => 1,
};

type JsonSchemaLike = {
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  required?: string[];
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  allOf?: JsonSchemaLike[];
  $ref?: string;
  default?: unknown;
  const?: unknown;
};

const MAX_DEPTH = 6;

/** Resolve a (non-ref) schema node into a list of candidate "types". */
function typesOf(schema: JsonSchemaLike): string[] {
  if (schema.type) return Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.anyOf) return [getKind(schema.anyOf[0] ?? {})];
  if (schema.oneOf) return [getKind(schema.oneOf[0] ?? {})];
  if (schema.allOf) return [getKind(schema.allOf[0] ?? {})];
  return ["string"];
}

function getKind(s: JsonSchemaLike): string {
  if (typeof s.type === "string") return s.type;
  if (Array.isArray(s.type)) return s.type[0] ?? "string";
  if (s.anyOf) return getKind(s.anyOf[0] ?? {});
  if (s.oneOf) return getKind(s.oneOf[0] ?? {});
  if (s.const !== undefined) return typeof s.const;
  return "string";
}

export interface GeneratedArgs {
  args: Record<string, unknown>;
  filled: string[];
  skipped: string[];
}

/**
 * Build sample arguments for a tool call.
 *
 * @param inputSchema the JSON schema the server advertised for the tool
 * @param opts.requiredOnly when true, only `required` properties are filled
 * @param opts.extraArgs caller-supplied overrides (always win)
 */
export function generateArgs(
  inputSchema: unknown,
  opts: { requiredOnly?: boolean; extraArgs?: Record<string, unknown> } = {}
): GeneratedArgs {
  const schema = (inputSchema ?? {}) as JsonSchemaLike;
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const args: Record<string, unknown> = { ...(opts.extraArgs ?? {}) };
  const filled: string[] = Object.keys(opts.extraArgs ?? {});
  const skipped: string[] = [];

  for (const [name, propSchema] of Object.entries(props)) {
    if (args[name] !== undefined) continue;
    if (!required.has(name) && opts.requiredOnly) {
      skipped.push(name);
      continue;
    }
    if (propSchema.default !== undefined) {
      args[name] = propSchema.default;
      filled.push(name);
      continue;
    }
    const value = sampleValue(name, propSchema, 0);
    if (value !== undefined) {
      args[name] = value;
      filled.push(name);
    } else {
      skipped.push(name);
    }
  }

  // `inputSchema` is usually `{ type: "object" }` with no properties.
  return { args, filled, skipped };
}

function sampleValue(name: string, schema: JsonSchemaLike, depth: number): unknown | undefined {
  if (depth > MAX_DEPTH) return undefined;

  if (schema.const !== undefined) return schema.const;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;

  const hint = Object.keys(NAME_HINTS).find((k) => name.toLowerCase().includes(k));
  const types = typesOf(schema);
  const kind = types[0] ?? "string";

  switch (kind) {
    case "string":
      if (schema.format && FORMAT_SAMPLES[schema.format] !== undefined) return FORMAT_SAMPLES[schema.format];
      return hint ? (NAME_HINTS[hint] as (n: string) => unknown)(name) : "example";
    case "number":
    case "integer":
      return hint ? (NAME_HINTS[hint] as (n: string) => unknown)(name) : 1;
    case "boolean":
      return hint ? (NAME_HINTS[hint] as (n: string) => unknown)(name) : true;
    case "array": {
      const items = schema.items ? sampleValue(name, schema.items, depth + 1) : undefined;
      return items === undefined ? [] : [items];
    }
    case "object": {
      const nested = generateArgs(schema, { requiredOnly: false, extraArgs: {} });
      return nested.args;
    }
    case "null":
      return null;
    default:
      return undefined;
  }
}

/** Pick the first schema of a possibly union-typed input schema. */
export function firstObjectSchema(inputSchema: unknown): unknown {
  const s = (inputSchema ?? {}) as JsonSchemaLike;
  if (s.properties) return s;
  if (s.anyOf) {
    const first = s.anyOf.find((x) => x.properties || x.type === "object");
    return first ?? s;
  }
  if (s.oneOf) {
    const first = s.oneOf.find((x) => x.properties || x.type === "object");
    return first ?? s;
  }
  if (s.allOf) {
    // Merge allOf — best-effort: take the first with properties.
    const first = s.allOf.find((x) => x.properties);
    return first ?? s;
  }
  return s;
}