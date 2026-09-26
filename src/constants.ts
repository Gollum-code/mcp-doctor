export const NAME = "mcp-doctor";
export const VERSION = "0.1.0";

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
