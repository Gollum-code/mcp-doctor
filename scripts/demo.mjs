#!/usr/bin/env node
/**
 * Demo runner used to capture the README GIF / demo output.
 * It exercises every scenario back-to-back against the built-in fixtures
 * so the recording shows: healthy server, slow tool, isError tool, timeout,
 * broken server, and JSON output.
 *
 *   node scripts/demo.mjs
 *
 * Assumes `npm run build` has been run (uses dist/cli.js).
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(root, "dist", "cli.js");
const FIXTURE = "examples/fixture-server.mjs";
const HTTP_PORT = 3211;
const FORCE_COLOR = "1";

function title(t) {
  console.log(`\n\x1b[1m\x1b[35m# ${t}\x1b[0m`);
}

function sh(args, { label } = {}) {
  return new Promise((resolve) => {
    if (label) title(label);
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: root,
      env: { ...process.env, FORCE_COLOR },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", (code) => resolve(code));
  });
}

async function main() {
  // Start the HTTP fixture so the http-transport scenario works.
  const httpFixture = spawn(process.execPath, [path.join(root, "examples", "http-fixture-server.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(HTTP_PORT) },
    stdio: ["ignore", "ignore", "ignore"],
  });
  // Give it a moment to bind.
  await new Promise((r) => setTimeout(r, 800));
  void once(httpFixture, "exit");

  await sh(["--version"], { label: "mcp-doctor — the curl of MCP" });

  await sh(["-x", `node ${FIXTURE}`, "-n", "demo", "--ci"], {
    label: "1) healthy stdio server (CI mode: ASCII, exit 0)",
  });

  await sh(["-x", `node ${FIXTURE}`, "-n", "demo", "--fuzz"], {
    label: "2) same server, pretty mode (colors + emoji)",
  });

  await sh(["-u", `http://127.0.0.1:${HTTP_PORT}/mcp`, "-n", "remote", "--ci"], {
    label: "3) HTTP / SSE transport",
  });

  await sh(["-x", `node ${FIXTURE}`, "-n", "demo", "-t", "300", "--ci"], {
    label: "4) timeout detection (300ms budget → slow tool fails, exit 1)",
  });

  await sh(["-x", "node no-such-server.mjs", "-n", "broken", "--ci"], {
    label: "5) broken server (connection error, exit 1)",
  });

  await sh(["-x", `node ${FIXTURE}`, "-n", "demo", "--json"], {
    label: "6) machine-readable JSON report",
  });

  // Tear down http fixture.
  httpFixture.kill("SIGKILL");
  console.log("\n\x1b[1m\x1b[32mdemo complete.\x1b[0m\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// keep `http` import used for potential port pre-check in future
void http;
