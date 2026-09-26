#!/usr/bin/env node
/**
 * GitHub Action entry point.
 *
 * Wired up by `action.yml` (runs using: node20, main: dist/action.js).
 * Reads `INPUT_*` env vars (GitHub translates action inputs to these),
 * runs mcp-doctor over the configured server(s) and:
 *   - writes a Markdown report when the `markdown` input is set
 *   - sets `exit-code` / `report` outputs for other steps
 *   - exits 0/1/2 so the job fails iff a server is unhealthy
 */
import { writeFileSync, readFileSync } from "node:fs";
import { loadConfigFile, configFromCommand, configFromUrl } from "./config.js";
import { runServerTest } from "./test.js";
import { renderMarkdown, renderPlain, renderTerminal, exitCode } from "./report.js";
import { ServerConfig, RunOptions, ServerReport } from "./types.js";

function getInput(name: string): string {
  const key = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  return process.env[key] ?? "";
}

function envBool(name: string): boolean {
  const v = getInput(name).toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function parseJsonSafe<T>(value: string, label: string): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    console.error(`mcp-doctor: invalid JSON for ${label}: ${(err as Error).message}`);
    process.exit(2);
  }
}

async function run(): Promise<void> {
  const configPath = getInput("config");
  const command = getInput("command");
  const url = getInput("url");

  const servers: ServerConfig[] = [];
  if (configPath) servers.push(...loadConfigFile(configPath));
  if (command) servers.push(configFromCommand(command, undefined));
  if (url) servers.push(configFromUrl(url));

  if (servers.length === 0) {
    console.error("mcp-doctor: provide at least one of `config`, `command` or `url` inputs.");
    process.exit(2);
  }

  const extraArgs = parseJsonSafe<Record<string, unknown>>(getInput("args"), "args") ??
    (getInput("args-file") ? parseJsonSafe<Record<string, unknown>>(loadText(getInput("args-file")), "args-file") : undefined);

  const runOptions: RunOptions = {
    args: extraArgs,
    fuzz: envBool("fuzz"),
    timeoutMs: getInput("timeout-ms") ? Number.parseInt(getInput("timeout-ms"), 10) || undefined : undefined,
    maxTools: getInput("max-tools") ? Number.parseInt(getInput("max-tools"), 10) || undefined : undefined,
  };

  const reports: ServerReport[] = [];
  for (const server of servers) {
    try {
      reports.push(await runServerTest(server, runOptions));
    } catch (err) {
      console.error(`mcp-doctor: unexpected error testing "${server.id}": ${(err as Error).message}`);
    }
  }

  const code = exitCode(reports);
  const markdown = renderMarkdown(reports);

  setOutput("exit-code", String(code));
  setOutput("report", markdown);

  // A markdown file makes the health check visible on the job summary /
  // as an artifact — write it before we potentially fail the step.
  if (getInput("markdown")) {
    const dest = getInput("markdown");
    writeFileSync(dest, markdown + "\n", "utf8");
    setOutput("report-path", dest);
  }

  const stream = process.env["GITHUB_ACTIONS"] ? renderPlain(reports) : renderTerminal(reports);
  process.stdout.write(stream + "\n");

  process.exit(code);
}

function loadText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`mcp-doctor: cannot read file ${path}: ${(err as Error).message}`);
    process.exit(2);
  }
}

function setOutput(name: string, value: string): void {
  const out = process.env["GITHUB_OUTPUT"];
  if (!out) return;
  // GitHub Actions escaping: % → %25, CR → %0D, LF → %0A
  const escaped = value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  try {
    writeFileSync(out, `${name}=${escaped}\n`, { flag: "a" });
  } catch {
    /* best-effort */
  }
}

run().catch((err) => {
  console.error(`mcp-doctor: fatal: ${(err as Error).stack ?? err}`);
  process.exit(2);
});