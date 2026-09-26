import { readFileSync } from "node:fs";
import { ServerConfig, TransportKind } from "./types.js";

export interface ConfigFile {
  /** A single server object, or a batch via `servers: [...]`. */
  servers?: Array<Record<string, unknown>> | Record<string, unknown>;
  /** Global defaults merged into each server. */
  env?: Record<string, string>;
  headers?: Record<string, string>;
  args?: string[];
  timeoutMs?: number;
}

const SUPPORTED_KEYS = new Set([
  "servers",
  "env",
  "headers",
  "args",
  "timeoutMs",
  "id",
  "name",
  "transport",
  "command",
  "url",
  "cwd",
]);

export class ConfigError extends Error {}

/** Normalise one raw JSON object (from the CLI or a config file) into a ServerConfig. */
export function normalizeServer(raw: Record<string, unknown>, index: number): ServerConfig {
  const transport = pick(raw, ["transport", "type"], "stdio") as string;
  if (transport !== "stdio" && transport !== "http") {
    throw new ConfigError(`server[${index}]: "transport" must be "stdio" or "http", got ${JSON.stringify(transport)}`);
  }

  const url = asString(raw, "url");
  const command = asString(raw, "command");
  const name = asString(raw, "name");
  const id = asString(raw, "id") ?? name ?? (transport === "http" && url ? url.replace(/^https?:\/\//, "") : `server-${index}`);

  if (transport === "stdio" && !command) {
    throw new ConfigError(`server[${index}] ("${id}"): stdio servers need a "command" (and optionally "args").`);
  }
  if (transport === "http" && !url) {
    throw new ConfigError(`server[${index}] ("${id}"): http servers need a "url".`);
  }

  const extra = Object.keys(raw).filter((k) => !SUPPORTED_KEYS.has(k));
  const config: ServerConfig = {
    id,
    transport: transport as TransportKind,
    name: name ?? undefined,
    command,
    url,
    cwd: asString(raw, "cwd"),
    env: (raw["env"] as Record<string, string>) ?? undefined,
    headers: (raw["headers"] as Record<string, string>) ?? undefined,
    args: (raw["args"] as string[]) ?? undefined,
    timeoutMs: (raw["timeoutMs"] as number) ?? undefined,
  };
  if (extra.length > 0) {
    (config as unknown as Record<string, unknown>)["unrecognizedKeys"] = extra;
  }
  return config;
}

export function mergeDefaults(server: ServerConfig, global?: ConfigFile): ServerConfig {
  if (!global) return server;
  return {
    ...server,
    env: { ...(global.env ?? {}), ...(server.env ?? {}) },
    headers: { ...(global.headers ?? {}), ...(server.headers ?? {}) },
    args: server.args ?? global.args ?? undefined,
    timeoutMs: server.timeoutMs ?? global.timeoutMs ?? undefined,
  };
}

/** Parse a config file. Accepts `{ servers: [ {…}, … ] }`, `{ servers: { a: {…}, b: {…} } }` or a bare array. */
export function loadConfigFile(path: string): ServerConfig[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`cannot read config "${path}": ${(err as Error).message}`);
  }

  if (Array.isArray(raw)) {
    return raw.map((s, i) => normalizeServer(asRecord(s, i), i));
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("servers" in obj) {
      return normalizeServersBlock(obj["servers"]);
    }
    // Otherwise treat the whole object as one server.
    return [normalizeServer(obj, 0)];
  }
  throw new ConfigError(`config "${path}" must be a server object or an object with "servers".`);
}

export function normalizeServersBlock(block: unknown): ServerConfig[] {
  if (Array.isArray(block)) {
    return block.map((s, i) => normalizeServer(asRecord(s, i), i));
  }
  if (block && typeof block === "object") {
    // Map form { name: {...} } — each value carries no explicit id.
    return Object.entries(block as Record<string, unknown>).map(([name, v], i) => {
      const rec = asRecord(v, i);
      const withId: Record<string, unknown> = { ...rec, name: rec["name"] ?? name };
      if (!withId["id"]) withId["id"] = name;
      return normalizeServer(withId, i);
    });
  }
  return [];
}

/** Convert a `--command "npx -y foo"` shorthand into a config. */
export function configFromCommand(command: string, appendArgs?: string[], name?: string): ServerConfig {
  const parts = command.split(/\s+/).filter(Boolean);
  const [head, ...rest] = parts;
  const args = [...rest, ...(appendArgs ?? [])];
  return {
    id: name ?? parts[0] ?? "server",
    name: name ?? undefined,
    transport: "stdio",
    command: head,
    args,
  };
}

export function configFromUrl(url: string, headers?: Record<string, string>, name?: string): ServerConfig {
  const host = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return {
    id: name ?? host,
    name: name ?? undefined,
    transport: "http",
    url,
    headers,
  };
}

function pick(rec: Record<string, unknown>, keys: string[], fallback: unknown): unknown {
  for (const k of keys) {
    if (rec[k] !== undefined) return rec[k];
  }
  return fallback;
}

function asString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  throw new ConfigError(`field "${key}" must be a string, got ${typeof v}`);
}

function asRecord(v: unknown, index: number): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new ConfigError(`server[${index}] must be an object, got ${typeof v}`);
}