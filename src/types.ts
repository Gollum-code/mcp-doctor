export type TransportKind = "stdio" | "http";

/**
 * One MCP server to test. Used directly via CLI flags (single server),
 * or read from a JSON config file (single / batch via `servers: []`).
 */
export interface ServerConfig {
  /** Unique id, defaults to the server name / url basename. */
  id: string;
  transport: TransportKind;
  /** Display name (optional; defaults to id). */
  name?: string;

  /* stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;

  /* http / SSE */
  url?: string;
  headers?: Record<string, string>;

  /** Per-server override of the global timeout for each tool call. */
  timeoutMs?: number;
}

export type CheckStatus = "pass" | "warn" | "fail" | "error" | "skip";

export interface CheckDetail {
  durationMs: number;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface CheckResult extends CheckDetail {
  name: string;
  status: CheckStatus;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}

/** Result of one smoke call to one tool. */
export interface ToolCallCheck {
  /** Tool name. */
  name: string;
  status: CheckStatus;
  durationMs: number;
  /** Whether example args were attached (vs. an empty object). */
  hadArgs: boolean;
  /** Exceeded the timeout budget. */
  timeout: boolean;
  /** Last sentence to the right of "." was "network parse ok". */
  parseOk: boolean;
  /** null = no output schema to check against. */
  schemaValid: boolean | null;
  /** The server signalled an error result (isError). */
  isError: boolean;
  /** Latency above SLOW_THRESHOLD_MS. */
  slow: boolean;
  /** Response exceeded the "huge response" threshold. */
  huge?: boolean;
  /** Raw error message when the call failed fatally. */
  error?: string;
  detail?: string;
  /** Structure-lint problems on the returned result. */
  structuralProblems: string[];
}

export interface FailureCluster {
  key: string;
  count: number;
  example?: string;
}

export interface Discovery {
  protocolVersion: string | null;
  capabilities: Record<string, unknown> | null;
  tools: ToolInfo[];
  promptsCount: number;
  resourcesCount: number;
  checks: CheckResult[];
  /** Non-fatal discovery problems (e.g. prompts/list unsupported). */
  notes?: string[];
}

export interface Analytics {
  counts: Record<CheckStatus, number>;
  timeouts: number;
  /** Latency summary (ms) across all timed tool calls. */
  minLatencyMs?: number;
  medianLatencyMs?: number;
  avgLatencyMs?: number;
  maxLatencyMs?: number;
  failures: FailureCluster[];
  slowTools: string[];
  hugeResponses: number;
}

export interface ServerReport {
  serverId: string;
  config: ServerConfig;
  transport: TransportKind;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  /** Overall: true only when nothing failed / errored. */
  ok: boolean;
  connect: {
    ok: boolean;
    status: CheckStatus;
    detail?: string;
    exitCode?: number | null;
    stderr?: string;
    protocolVersion?: string | null;
  };
  discovery: Discovery;
  tools: ToolCallCheck[];
  analytics: Analytics;
}

export interface RunOptions {
  /** Example args (JSON) applied to every tool call. */
  args?: Record<string, unknown>;
  /** Fill optional schema properties too. */
  fuzz?: boolean;
  /** Per-call timeout (ms). */
  timeoutMs?: number;
  /** Max tools to smoke-test per server. */
  maxTools?: number;
  /** Validate each response against the tool's output schema. */
  schema?: boolean;
  verbose?: boolean;
}
