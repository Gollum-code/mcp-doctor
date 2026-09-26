import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const NAME = "mcp-doctor";

/**
 * Read the version from package.json so a release bump never desyncs from
 * `package.json` (single source of truth). Falls back gracefully.
 */
function readVersion(): string {
  try {
    // Resolve package.json relative to this module, walking up from dist/ or src/.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

/** Per-tool default timeout (matches the doc's "timeout (10s)" example). */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** Time budget for the whole initialize handshake. */
export const CONNECT_TIMEOUT_MS = 15_000;
/** Above this per-call latency a tool is reported as slow (warn). */
export const SLOW_THRESHOLD_MS = 1200;
/** Responses larger than this (serialized) are flagged as "huge / harmful". */
export const HUGE_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Cap on how much child stderr we keep for diagnosis. */
export const MAX_STDERR_CAPTURE = 8192;
/** Default cap of tools smoke-tested per server (0 = unlimited). */
export const DEFAULT_MAX_TOOLS = 0;
/** Protocol versions we advertise / accept. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
