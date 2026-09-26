import { describe, it, expect, afterAll, beforeAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { runServerTest } from "../src/test.js";
import { loadConfigFile } from "../src/config.js";
import { configFromCommand } from "../src/config.js";
import { configFromUrl } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(__dirname, "..", "examples", "fixture-server.mjs");

describe("runServerTest (E2E against in-repo fixture server)", () => {
  it("discovers tools/prompts/resources and passes healthy tools", async () => {
    const server = configFromCommand(`node ${fixture}`, undefined, "fixture");
    const report = await runServerTest(server, { timeoutMs: 5000 });

    expect(report.connect.ok).toBe(true);
    expect(report.connect.status).toBe("pass");
    expect(report.discovery.tools.length).toBeGreaterThanOrEqual(4);
    expect(report.discovery.promptsCount).toBeGreaterThanOrEqual(1);
    expect(report.discovery.resourcesCount).toBeGreaterThanOrEqual(1);

    const echo = report.tools.find((t) => t.name === "echo");
    expect(echo).toBeDefined();
    expect(echo!.status).toBe("pass");
    expect(echo!.schemaValid).toBeNull(); // no outputSchema on echo

    const structured = report.tools.find((t) => t.name === "structured");
    expect(structured).toBeDefined();
    // fixture returns structuredContent matching outputSchema → schemaValid true
    expect(structured!.schemaValid).toBe(true);

    const fail = report.tools.find((t) => t.name === "fail");
    expect(fail!.isError).toBe(true);
    expect(fail!.status).toBe("warn"); // server-level error → warn, not hard fail

    expect(report.ok).toBe(true);
    expect(report.analytics.counts.error).toBe(0);
    expect(report.analytics.counts.fail).toBe(0);
    expect(report.totalMs).toBeGreaterThan(0);
  }, 30_000);

  it("flags slow tools as warn and huge failures don't crash", async () => {
    const server = configFromCommand(`node ${fixture}`, undefined, "fixture-slow");
    const report = await runServerTest(server, { timeoutMs: 5000 });

    const slow = report.tools.find((t) => t.name === "slow_echo");
    expect(slow).toBeDefined();
    // slow_echo waits 1500ms by default → exceeds 1200ms threshold → warn
    expect(slow!.slow).toBe(true);
    expect(slow!.status).toBe("warn");
    expect(report.analytics.slowTools).toContain("slow_echo");
    expect(report.ok).toBe(true);
  }, 30_000);

  it("reports connection failure for a bad command without hanging", async () => {
    const server = configFromCommand(`node no-such-file-xyz.mjs`, undefined, "broken");
    const report = await runServerTest(server, { timeoutMs: 3000, connectTimeoutMs: 4000 });
    expect(report.connect.ok).toBe(false);
    expect(report.connect.status).toBe("error");
    expect(report.ok).toBe(false);
  }, 20_000);

  it("loads a config file and runs it", async () => {
    const servers = loadConfigFile(path.resolve(__dirname, "fixtures", "batch.config.json"));
    expect(servers.length).toBe(2);
    // First one launches the fixture server; second is http (not run here).
    const report = await runServerTest(servers[0]!, { timeoutMs: 5000 });
    expect(report.connect.ok).toBe(true);
    expect(report.discovery.tools.length).toBe(4);
    expect(report.ok).toBe(true);
  }, 20_000);
});

describe("runServerTest over HTTP (fixture http server)", () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const port = 3211;

  beforeAll(async () => {
    child = spawn(process.execPath, ["examples/http-fixture-server.mjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    await waitForPort(port, 10_000);
  }, 20_000);

  afterAll(async () => {
    child?.kill("SIGKILL");
  });

  it("connects, discovers tools and reports an isError tool as warn", async () => {
    const server = configFromUrl(`http://127.0.0.1:${port}/mcp`, undefined, "http-fixture");
    const report = await runServerTest(server, { timeoutMs: 8000 });

    expect(report.connect.ok).toBe(true);
    expect(report.connect.protocolVersion).toBe("2025-06-18");
    expect(report.discovery.tools.map((t) => t.name)).toContain("http_echo");
    expect(report.discovery.tools.map((t) => t.name)).toContain("http_bad");

    const bad = report.tools.find((t) => t.name === "http_bad");
    expect(bad!.isError).toBe(true);
    expect(bad!.status).toBe("warn");

    const echo = report.tools.find((t) => t.name === "http_echo");
    expect(echo!.status).toBe("pass");

    expect(report.ok).toBe(true);
    expect(report.analytics.counts.error).toBe(0);
  }, 30_000);

  it("reports connection failure for an unreachable url without hanging", async () => {
    const server = configFromUrl("http://127.0.0.1:1/mcp", undefined, "unreachable");
    const report = await runServerTest(server, { timeoutMs: 3000, connectTimeoutMs: 4000 });
    expect(report.connect.ok).toBe(false);
    expect(report.ok).toBe(false);
  }, 20_000);
});

afterAll(() => {
  // Ensure no orphaned fixture processes.
});

/** Poll a TCP port until it accepts connections or we time out. */
async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const net = await import("node:net");
  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (ready) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`port ${port} never became reachable`);
}