import chalk from "chalk";
import { ServerReport, CheckStatus } from "./types.js";
import { NAME, VERSION } from "./constants.js";

const ICON: Record<CheckStatus, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
  error: "❌",
  skip: "➖",
};

const ASCII_ICON: Record<CheckStatus, string> = {
  pass: "[PASS]",
  warn: "[WARN]",
  fail: "[FAIL]",
  error: "[ERROR]",
  skip: "[SKIP]",
};

const color: Record<CheckStatus, (s: string) => string> = {
  pass: (s) => chalk.green(s),
  warn: (s) => chalk.yellow(s),
  fail: (s) => chalk.red(s),
  error: (s) => chalk.red(s),
  skip: (s) => chalk.dim(s),
};

function statusLabel(s: CheckStatus, iconMap: Record<CheckStatus, string> = ICON): string {
  return color[s](iconMap[s]);
}

function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length));
}

/** Human-friendly ms: "1.2s" for slow, "850ms" otherwise. */
function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Multi-server pretty table (default view). */
export function renderTerminal(reports: ServerReport[], icons: Record<CheckStatus, string> = ICON): string {
  const lines: string[] = [];
  const width = Math.max(...reports.map((r) => r.serverId.length), 8);

  lines.push("");
  lines.push(chalk.bold.cyan(`  ${NAME} v${VERSION}`) + chalk.dim("  — MCP server health check"));
  lines.push("");

  for (const r of reports) {
    lines.push(...renderServer(r, width, icons));
    lines.push("");
  }

  lines.push(renderSummary(reports));
  lines.push("");
  return lines.join("\n");
}

function renderServer(r: ServerReport, nameWidth: number, icons: Record<CheckStatus, string> = ICON): string[] {
  const out: string[] = [];
  const title = `${chalk.bold(pad(r.serverId, nameWidth))}  ${chalk.dim(`(${r.transport})`)}`;
  out.push(`  ${title}`);

  // CONNECTIVITY
  const connDetail =
    r.connect.status === "pass"
      ? [r.connect.protocolVersion ? `protocol ${r.connect.protocolVersion}` : undefined, r.connect.detail]
          .filter(Boolean)
          .join(" · ")
      : r.connect.detail;
  out.push(`    ${pad("CONNECTIVITY", 14)} ${statusLabel(r.connect.status, icons)} ${chalk.dim(connDetail ?? "")}`);

  if (r.connect.status === "error" && r.connect.stderr) {
    out.push(`    ${" ".repeat(14)} ${chalk.dim("stderr:")} ${chalk.gray(firstLine(r.connect.stderr))}`);
  }

  // DISCOVERY
  for (const c of r.discovery.checks) {
    out.push(
      `    ${pad(c.name.toUpperCase(), 14)} ${statusLabel(c.status, icons)} ${chalk.dim(c.detail ?? "")}`
    );
  }

  // TOOL CALLS
  const toolChecks = r.tools;
  if (toolChecks.length > 0) {
    out.push(`    ${chalk.dim("TOOL CALLS")} ${chalk.dim("─".repeat(Math.max(0, 44 - toolChecks.length)))}`);
    for (const t of toolChecks) {
      const ms = chalk.dim(fmtMs(t.durationMs));
      const tag = t.timeout ? chalk.red("timeout") : t.isError ? chalk.yellow("isError") : t.slow ? chalk.yellow("slow") : t.schemaValid === false ? chalk.yellow("schema") : t.schemaValid === true ? "valid JSON" : "valid JSON";
      const err = t.error && !t.timeout ? chalk.red(`→ ${truncate(t.error, 60)}`) : "";
      out.push(`      ${pad(t.name, 22)} ${statusLabel(t.status, icons)} ${pad(ms, 8)} ${err || chalk.dim(tag)}`);
    }
  }

  // RESPONSE summary
  const parsed = toolChecks.filter((t) => t.parseOk).length;
  const schemaChecked = toolChecks.filter((t) => t.schemaValid !== null);
  const schemaOk = schemaChecked.filter((t) => t.schemaValid === true).length;
  out.push(
    `    ${pad("RESPONSE", 14)} ${parsed}/${toolChecks.length} valid JSON${
      schemaChecked.length > 0 ? chalk.dim(`  ·  schema ${schemaOk}/${schemaChecked.length} ok`) : ""
    }`
  );

  // HEALTH summary line
  const a = r.analytics;
  if (a.avgLatencyMs !== undefined) {
    out.push(
      `    ${pad("HEALTH", 14)} ${chalk.dim(
        `avg ${fmtMs(a.avgLatencyMs)} · max ${fmtMs(a.maxLatencyMs)}${a.timeouts > 0 ? ` · ${a.timeouts} timeout(s)` : ""}`
      )}`
    );
  }
  if (a.failures.length > 0) {
    for (const f of a.failures) {
      out.push(`    ${pad("FAILURE", 14)} ${chalk.red(`${f.count}× ${f.key}`)}`);
    }
  }
  if (a.hugeResponses > 0) {
    out.push(`    ${pad("HARMFUL", 14)} ${chalk.red(`${a.hugeResponses} oversized response(s)`)}`);
  }

  return out;
}

function renderSummary(reports: ServerReport[]): string {
  const passed = reports.filter((r) => r.ok).length;
  const failed = reports.length - passed;
  const verdict = failed === 0 ? chalk.green("ALL SERVERS HEALTHY") : chalk.red(`${failed} SERVER(S) UNHEALTHY`);
  const totalTools = reports.reduce((a, r) => a + r.tools.length, 0);
  const problems = reports.reduce((a, r) => a + r.analytics.counts.error + r.analytics.counts.fail, 0);
  return [
    chalk.dim("─".repeat(64)),
    `  ${passed}/${reports.length} servers healthy · ${totalTools} tools tested · ${problems} problem(s)`,
    `  ${verdict}`,
  ].join("\n");
}

/** ANSI-free plain text with ASCII status marks (used for --ci / piped output). */
export function renderPlain(reports: ServerReport[]): string {
  return renderTerminal(reports, ASCII_ICON).replace(/\u001b\[[0-9;]*m/g, "");
}

/** Pretty JSON for --json. */
export function renderJson(reports: ServerReport[]): string {
  return JSON.stringify(
    { tool: NAME, version: VERSION, generatedAt: new Date().toISOString(), servers: reports },
    null,
    2
  );
}

/** GitHub Actions–friendly markdown for PR comments / job summaries. */
export function renderMarkdown(reports: ServerReport[]): string {
  const out: string[] = [];
  out.push(`## ${NAME} report`);
  out.push("");
  out.push("| server | result | tools | errors | warns | max latency |");
  out.push("|---|---|---|---|---|---|");
  for (const r of reports) {
    out.push(
      `| \`${r.serverId}\` | ${r.ok ? "✅ healthy" : "❌ unhealthy"} | ${r.tools.length} | ${
        r.analytics.counts.error + r.analytics.counts.fail
      } | ${r.analytics.counts.warn} | ${fmtMs(r.analytics.maxLatencyMs)} |`
    );
  }
  out.push("");
  for (const r of reports) {
    out.push(`### \`${r.serverId}\` — ${r.ok ? "healthy" : "unhealthy"}`);
    out.push("");
    const bad = r.tools.filter((t) => t.status !== "pass");
    if (bad.length === 0) {
      out.push(`All ${r.tools.length} tools passed.`);
    } else {
      out.push("| tool | status | latency | note |");
      out.push("|---|---|---|---|");
      for (const t of bad) {
        out.push(`| \`${t.name}\` | ${t.status} | ${fmtMs(t.durationMs)} | ${(t.error ?? "").replace(/\|/g, "\\|")} |`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

/** Exit code for CI: 0 = all healthy, 1 = any unhealthy. */
export function exitCode(reports: ServerReport[]): number {
  return reports.every((r) => r.ok) ? 0 : 1;
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}
