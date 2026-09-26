import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ServerConfig, RunOptions, ServerReport } from "./types.js";
import { connect, discover, withTimeout, TimeoutError, ConnectedClient } from "./client.js";
import { generateArgs, firstObjectSchema } from "./testgen.js";
import { validateCallResultShape, validateData } from "./validate.js";
import { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOOLS, HUGE_RESPONSE_BYTES, SLOW_THRESHOLD_MS } from "./constants.js";
import { vlog } from "./logger.js";

interface ToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}

/**
 * Run the full doctor check against one server:
 *
 *   CONNECTIVITY → initialize handshake
 *   DISCOVERY    → tools/list, prompts/list, resources/list
 *   TOOL CALLS   → every tool: empty args + example args
 *   RESPONSE     → JSON validity + output schema check
 *   ANALYTICS    → latency, timeouts, failure clustering
 */
export async function runServerTest(config: ServerConfig, opts: RunOptions = {}): Promise<ServerReport> {
  const startedAt = new Date();
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTools = opts.maxTools ?? DEFAULT_MAX_TOOLS;

  const report: ServerReport = {
    serverId: config.id,
    config,
    transport: config.transport,
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    totalMs: 0,
    ok: false,
    connect: { ok: false, status: "fail", exitCode: null },
    discovery: {
      protocolVersion: null,
      capabilities: null,
      tools: [],
      promptsCount: 0,
      resourcesCount: 0,
      checks: [],
      notes: [],
    },
    tools: [],
    analytics: { counts: { pass: 0, warn: 0, fail: 0, error: 0, skip: 0 }, timeouts: 0, failures: [], slowTools: [], hugeResponses: 0 },
  };
  const count = report.analytics.counts;
  const tally = (status: keyof typeof count, n = 1) => {
    count[status] = (count[status] ?? 0) + n;
  };

  const started = performance.now();

  // ---------- CONNECTIVITY ----------
  let conn: ConnectedClient | null = null;
  try {
    conn = await connect(config);
    report.connect.ok = true;
    report.connect.status = "pass";
    report.connect.protocolVersion = conn.protocolVersion;
    report.connect.detail = conn.serverName
      ? `server=${conn.serverName} (${conn.serverVersion ?? "unknown"})`
      : undefined;
    report.discovery.protocolVersion = conn.protocolVersion ?? null;
    tally("pass");
    vlog(`[${config.id}] connected, protocol=${conn.protocolVersion}`);
  } catch (err) {
    const e = err as Error;
    report.connect.ok = false;
    report.connect.status = "error";
    report.connect.detail = e.message;
    report.connect.stderr = getStderr(conn);
    tally("error");
    report.analytics.failures = [{ key: classifyError(e.message), count: 1, example: e.message }];
    return finish(report, started);
  }

  // ---------- DISCOVERY ----------
  try {
    const d = await withTimeout(discover(conn.client), timeoutMs, "discovery");
    report.discovery.protocolVersion = conn.protocolVersion ?? d.protocolVersion;
    report.discovery.capabilities = d.capabilities;
    report.discovery.tools = d.tools;
    report.discovery.promptsCount = d.promptsCount;
    report.discovery.resourcesCount = d.resourcesCount;
    report.discovery.notes = d.notes;

    const caps = (d.capabilities ?? {}) as Record<string, unknown>;
    pushCheck(report, "tools/list", "pass", `${d.tools.length} tools found`);
    pushCheck(
      report,
      "prompts/list",
      caps["prompts"] ? "pass" : "skip",
      caps["prompts"] ? `${d.promptsCount} prompts found` : "server advertises no prompts"
    );
    pushCheck(
      report,
      "resources/list",
      caps["resources"] ? "pass" : "skip",
      caps["resources"] ? `${d.resourcesCount} resources found` : "server advertises no resources"
    );
    for (const c of report.discovery.checks) tally(c.status as keyof typeof count);
    // Discovery notes (e.g. unsupported endpoints) surface as warnings.
    for (const n of d.notes) {
      tally("warn");
      report.discovery.checks.push({ name: "discovery note", status: "warn", durationMs: 0, detail: n });
    }
  } catch (err) {
    const e = err as Error;
    pushCheck(report, "discovery", "error", e.message);
    tally("error");
  }

  // ---------- TOOL CALLS ----------
  const toolsToTest = (maxTools > 0 ? report.discovery.tools.slice(0, maxTools) : report.discovery.tools) as ToolDef[];

  // `--args` may be a flat object applied to every tool, OR a per-tool map
  // (`{ toolName: { ...args } }`). Decide once, deterministically, from the
  // discovered tool set.
  const toolNames = new Set(toolsToTest.map((t) => t.name));
  const argsArePerTool =
    !!opts.args && Object.keys(opts.args).some((k) => toolNames.has(k));

  for (const tool of toolsToTest) {
    const baseArgs = argsArePerTool
      ? isPlainObject(opts.args?.[tool.name])
        ? (opts.args![tool.name] as Record<string, unknown>)
        : {}
      : (opts.args ?? {});
    const check = await smokeTool(conn.client, tool, opts, timeoutMs, baseArgs);
    report.tools.push(check);
    tally(check.status, 1);
    if (check.timeout) report.analytics.timeouts += 1;
    if (check.slow) report.analytics.slowTools.push(tool.name);
    if (check.huge) report.analytics.hugeResponses += 1;
  }

  // ---------- ANALYTICS ----------
  const clocks = report.tools.map((t) => t.durationMs).filter((n) => n > 0);
  if (clocks.length > 0) {
    const sorted = [...clocks].sort((a, b) => a - b);
    report.analytics.minLatencyMs = sorted[0];
    report.analytics.maxLatencyMs = sorted[sorted.length - 1];
    report.analytics.avgLatencyMs = round(sum(clocks) / clocks.length);
    report.analytics.medianLatencyMs = sorted[Math.floor(sorted.length / 2)];
  }

  // Failure clustering.
  const byKey = new Map<string, { count: number; example?: string }>();
  for (const t of report.tools) {
    if (!t.error || t.status !== "error") continue;
    const key = classifyError(t.error);
    const prev = byKey.get(key);
    if (prev) {
      prev.count += 1;
    } else {
      byKey.set(key, { count: 1, example: t.error });
    }
  }
  report.analytics.failures = [...byKey.entries()].map(([key, v]) => ({ key, count: v.count, example: v.example }));

  // ---------- SUMMARY ----------
  report.ok = count.error === 0 && count.fail === 0;
  await conn.close().catch(() => {});
  return finish(report, started);
}

function finish(report: ServerReport, started: number): ServerReport {
  report.finishedAt = new Date().toISOString();
  report.totalMs = round(performance.now() - started);
  return report;
}

async function smokeTool(
  client: Client,
  tool: ToolDef,
  opts: RunOptions,
  timeoutMs: number,
  baseArgs: Record<string, unknown>
): Promise<ServerReport["tools"][number]> {
  const name = tool.name;
  vlog(`calling tool "${name}"…`);

  const schemaFor = firstObjectSchema(tool.inputSchema);
  const gen = generateArgs(schemaFor, {
    requiredOnly: !opts.fuzz,
    extraArgs: baseArgs,
  });
  const argsCandidate = gen.args;
  const argsValid = validateData(argsCandidate, tool.inputSchema);

  const call = await runOneCall(client, name, argsCandidate, timeoutMs);
  const shape = validateCallResultShape(call.result);
  const resultIsError = isErrorResult(call.result);

  let schemaValid: boolean | null = null;
  let schemaProblems: string[] = [];
  if (tool.outputSchema && opts.schema !== false && !call.failed && shape.jsonValid && !resultIsError) {
    const target = extractResultValue(call.result, shape.jsonValid);
    schemaProblems = validateData(target, tool.outputSchema);
    schemaValid = schemaProblems.length === 0;
  }

  let status: ServerReport["tools"][number]["status"] = "pass";
  const durationMs = call.elapsedMs;
  const slow = !call.failed && durationMs >= SLOW_THRESHOLD_MS;

  let error: string | undefined;
  let detail: string | undefined;

  if (call.failed) {
    status = call.timedOut ? "error" : "error";
    error = call.error;
  } else if (resultIsError) {
    status = "warn";
    error = extractErrorText(call.result) ?? "server returned isError=true";
  } else if (!shape.jsonValid) {
    status = "error";
    error = `malformed result: ${shape.problems.slice(0, 2).join("; ")}`;
  } else if (schemaValid === false) {
    status = "warn";
    error = `output schema mismatch: ${schemaProblems.slice(0, 2).join("; ")}`;
  } else if (slow) {
    status = "warn";
  }

  let huge = false;
  try {
    const bytes = JSON.stringify(call.result ?? {}).length;
    huge = bytes > HUGE_RESPONSE_BYTES;
  } catch {
    /* ignore circular refs */
  }

  if (argsValid.length > 0) {
    detail = [detail, `our example args failed input schema: ${argsValid.slice(0, 2).join("; ")}`].filter(Boolean).join(" | ");
  }

  return {
    name,
    status,
    durationMs,
    hadArgs: Object.keys(argsCandidate).length > 0,
    timeout: call.timedOut,
    slow,
    huge,
    parseOk: shape.jsonValid,
    schemaValid,
    isError: resultIsError,
    error,
    detail,
    structuralProblems: shape.problems,
  };
}

interface OneCallOutcome {
  result: unknown;
  elapsedMs: number;
  failed: boolean;
  timedOut: boolean;
  error?: string;
}

async function runOneCall(client: Client, name: string, args: Record<string, unknown>, timeoutMs: number): Promise<OneCallOutcome> {
  const start = performance.now();
  try {
    const result = await withTimeout(client.callTool({ name, arguments: args }), timeoutMs, `callTool(${name})`);
    return { result, elapsedMs: performance.now() - start, failed: false, timedOut: false };
  } catch (err) {
    const elapsed = performance.now() - start;
    return {
      result: null,
      elapsedMs: elapsed,
      failed: true,
      timedOut: err instanceof TimeoutError,
      error: (err as Error).message,
    };
  }
}

function isErrorResult(result: unknown): boolean {
  return (
    typeof result === "object" && result !== null && (result as Record<string, unknown>)["isError"] === true
  );
}

function extractResultValue(result: unknown, jsonValid: boolean): unknown {
  if (!jsonValid || typeof result !== "object" || result === null) return result;
  const rec = result as Record<string, unknown>;
  if (rec["structuredContent"] !== undefined) return rec["structuredContent"];
  const content = rec["content"];
  if (Array.isArray(content)) {
    const text = content.find((b) => (b as Record<string, unknown>)["type"] === "text");
    if (text) return (text as Record<string, unknown>)["text"];
  }
  return result;
}

function extractErrorText(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const rec = result as Record<string, unknown>;
  if (rec["isError"]) {
    const content = rec["content"];
    if (Array.isArray(content)) {
      const text = content.find((b) => (b as Record<string, unknown>)["type"] === "text");
      if (text && typeof (text as Record<string, unknown>)["text"] === "string") {
        return clean((text as Record<string, unknown>)["text"] as string);
      }
    }
  }
  return "server returned isError=true";
}

function pushCheck(report: ServerReport, name: string, status: ServerReport["discovery"]["checks"][number]["status"], detail?: string) {
  report.discovery.checks.push({ name, status, durationMs: 0, detail });
}

/** Normalize an error message into a stable cluster key. */
export function classifyError(msg: string): string {
  if (/timed out/i.test(msg) || /timeout/i.test(msg)) return "timeout";
  if (/ECONNREFUSED|ECONNRESET/i.test(msg)) return "connection refused";
  if (/ENOENT|not found|spawn/i.test(msg)) return "command/spawn error (ENOENT)";
  if (/closed|close/i.test(msg)) return "connection closed";
  if (/schema/i.test(msg)) return "schema error";
  if (/parse|invalid JSON/i.test(msg)) return "malformed JSON response";
  const trimmed = msg.trim();
  return trimmed.length > 60 ? trimmed.slice(0, 60) : trimmed;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function getStderr(conn: ConnectedClient | null): string | undefined {
  const t = conn?.transport as unknown as { getStderrTail?: () => string };
  return t?.getStderrTail?.() || undefined;
}

function clean(s: string): string {
  return s.replace(/\r?\n/g, " ").slice(0, 200);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}