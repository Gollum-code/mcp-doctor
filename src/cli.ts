#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ServerConfig, RunOptions, ServerReport } from "./types.js";
import { loadConfigFile, configFromCommand, configFromUrl, ConfigError } from "./config.js";
import { runServerTest } from "./test.js";
import { renderTerminal, renderJson, renderMarkdown, renderPlain, exitCode } from "./report.js";
import { NAME, VERSION } from "./constants.js";
import { setVerbose } from "./logger.js";

interface CliArgs {
  config?: string;
  command?: string;
  launch?: string;
  url?: string;
  args?: string;
  argsFile?: string;
  env?: string;
  headers?: string;
  name?: string;
  fuzz?: boolean;
  timeout?: string;
  maxTools?: string;
  schema?: boolean;
  json?: boolean;
  markdown?: string | boolean;
  ci?: boolean;
  verbose?: boolean;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    throw new Error(`invalid JSON for ${label} (${(err as Error).message})`);
  }
}

function parseIntTime(v: string, label: string): number {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n) || n <= 0) throw new Error(`invalid numeric value "${v}" for ${label}`);
  return n;
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name(NAME)
    .description("Health check / smoke test / conformance report for MCP servers — the `curl` of MCP.")
    .version(VERSION, "-V, --version")
    .usage("[options] <configFile...>")
    .argument("[files...]", "JSON config file(s) with one or more servers under `servers`")
    .option("-c, --config <file>", "JSON config file (same as positional argument)")
    .option("-x, --command <cmd>", "stdio server: command to run (e.g. 'npx @modelcontextprotocol/server-everything')")
    .option("--launch <cmd>", "alias for --command")
    .option("-u, --url <url>", "http/SSE server: endpoint URL")
    .option("-a, --args <json>", 'example arguments to pass to every tool call, e.g. \'{"count": 1}\'')
    .option("--args-file <file>", "read example arguments from a JSON file")
    .option("--env <json>", "extra environment for stdio servers, e.g. '{\"KEY\":\"VAL\"}'")
    .option("--headers <json>", "extra HTTP headers for url servers, e.g. '{\"Authorization\":\"Bearer x\"}'")
    .option("-n, --name <name>", "server name when using --command/--url")
    .option("--fuzz", "also fill optional properties when generating example args")
    .option("-t, --timeout <ms>", "per-tool timeout in ms (default 10000)")
    .option("--max-tools <n>", "limit how many tools are smoke-tested per server")
    .option("--no-schema", "skip output schema validation")
    .option("-j, --json", "emit JSON report to stdout")
    .option("-m, --markdown [file]", "emit (or write to file) a Markdown report")
    .option("--ci", "CI mode: plain, ASCII-safe output and strict exit code")
    .option("-v, --verbose", "verbose stderr logging");

  return program;
}

async function collectServers(opts: CliArgs, positionals: string[]): Promise<ServerConfig[]> {
  const files = [...positionals];
  if (opts.config) files.push(opts.config);

  const all: ServerConfig[] = [];
  for (const f of files) {
    all.push(...loadConfigFile(path.resolve(f)));
  }

  if (opts.command || opts.launch) {
    const cmd = opts.command ?? opts.launch!;
    all.push(configFromCommand(cmd, undefined, opts.name));
  }
  if (opts.url) {
    // If --name was already consumed by --command, derive a fresh id.
    const usedName = (opts.command || opts.launch) ? undefined : opts.name;
    const headers = opts.headers ? parseJson<Record<string, string>>(opts.headers, "--headers") : undefined;
    all.push(configFromUrl(opts.url, headers, usedName));
  }

  // Dedupe by transport+id so a stdio and an http server with the same id
  // never collide. Later definitions (e.g. explicit --command/--url) win.
  const deduped = new Map<string, ServerConfig>();
  for (const s of all) deduped.set(`${s.transport}:${s.id}`, s);
  return [...deduped.values()];
}

export async function main(argv: string[]): Promise<number> {
  const program = buildCli();
  let opts: CliArgs;
  let positionals: string[] = [];
  try {
    const parsed = program.parse(argv);
    opts = program.opts<CliArgs>();
    positionals = (parsed.args ?? []) as string[];
  } catch (err) {
    console.error((err as Error).message);
    console.error(program.helpInformation());
    return 2;
  }

  setVerbose(Boolean(opts.verbose));

  let extraArgs: Record<string, unknown> | undefined;
  if (opts.args) {
    try {
      extraArgs = parseJson<Record<string, unknown>>(opts.args, "--args");
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      return 2;
    }
  }
  if (opts.argsFile) {
    try {
      extraArgs = { ...(extraArgs ?? {}), ...parseJson<Record<string, unknown>>(readFileSync(opts.argsFile, "utf8"), "--args-file") };
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      return 2;
    }
  }

  let servers: ServerConfig[];
  try {
    servers = await collectServers(opts, positionals);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`config error: ${err.message}`);
      return 2;
    }
    console.error(`error: ${(err as Error).message}`);
    return 2;
  }

  if (servers.length === 0) {
    console.error("error: no servers specified. Pass a config file, --command, or --url.");
    console.error(program.helpInformation());
    return 2;
  }

  if (opts.env) {
    let envMap: Record<string, string>;
    try {
      envMap = parseJson<Record<string, string>>(opts.env, "--env");
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      return 2;
    }
    for (const s of servers) s.env = { ...(s.env ?? {}), ...envMap };
  }

  let timeoutMs: number | undefined;
  let maxTools: number | undefined;
  try {
    timeoutMs = opts.timeout ? parseIntTime(opts.timeout, "--timeout") : undefined;
    maxTools = opts.maxTools ? parseIntTime(opts.maxTools, "--max-tools") : undefined;
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 2;
  }

  const runOptions: RunOptions = {
    args: extraArgs,
    fuzz: opts.fuzz,
    timeoutMs,
    maxTools,
    schema: opts.schema !== false,
    verbose: opts.verbose,
  };

  const reports: ServerReport[] = [];
  for (const server of servers) {
    try {
      reports.push(await runServerTest(server, runOptions));
    } catch (err) {
      // runServerTest never throws for normal failures, but guard anyway.
      console.error(`error testing "${server.id}": ${(err as Error).message}`);
    }
  }

  // Sanity: a server that errored before producing a report must still be represented.
  const byId = new Set(reports.map((r) => r.serverId));
  for (const s of servers) {
    if (!byId.has(s.id)) {
      const failedReport: ServerReport = {
        serverId: s.id,
        config: s,
        transport: s.transport,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        totalMs: 0,
        ok: false,
        connect: { ok: false, status: "error", detail: "unexpected runner error", exitCode: null },
        discovery: { protocolVersion: null, capabilities: null, tools: [], promptsCount: 0, resourcesCount: 0, checks: [] },
        tools: [],
        analytics: { counts: { pass: 0, warn: 0, fail: 0, error: 1, skip: 0 }, timeouts: 0, failures: [], slowTools: [], hugeResponses: 0 },
      };
      reports.push(failedReport);
    }
  }

  if (opts.json) {
    process.stdout.write(renderJson(reports) + "\n");
  } else if (typeof opts.markdown === "string") {
    const dest = path.resolve(opts.markdown);
    writeFileSync(dest, renderMarkdown(reports) + "\n", "utf8");
    console.error(`markdown report written to ${dest}`);
  } else if (opts.markdown === true) {
    process.stdout.write(renderMarkdown(reports) + "\n");
  } else if (opts.ci) {
    process.stdout.write(renderPlain(reports) + "\n");
  } else {
    process.stdout.write(renderTerminal(reports) + "\n");
  }

  return exitCode(reports);
}

// Direct execution (only as the CLI entrypoint, not when imported).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 2;
    }
  );
}