#!/usr/bin/env node
/**
 * A tiny, dependency-free MCP server over stdio, used as a smoke-test
 * fixture for mcp-doctor's own test suite and demos.
 *
 * It deliberately implements:
 *   - a fast, well-behaved tool (`echo`)
 *   - a slow tool (`slow_echo`) to exercise the "warn: slow" path
 *   - a tool that errors via isError (`fail`)
 *   - a tool with a declared outputSchema (`structured`)
 *   - a prompt and a resource so discovery has something to find
 *
 * Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout.
 */
import readline from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";

const tools = [
  {
    name: "echo",
    description: "Echo a message back immediately.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", description: "Text to echo" } },
      required: ["message"],
    },
  },
  {
    name: "slow_echo",
    description: "Echo after a deliberate delay (to test timeout / slow detection).",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" }, delayMs: { type: "number" } },
      required: ["message"],
    },
  },
  {
    name: "fail",
    description: "Always returns isError=true.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "structured",
    description: "Returns structuredContent matching its outputSchema.",
    inputSchema: { type: "object", properties: { n: { type: "number" } } },
    outputSchema: {
      type: "object",
      properties: { doubled: { type: "number" } },
      required: ["doubled"],
    },
  },
];

const prompts = [{ name: "greet", description: "A greeting prompt." }];
const resources = [{ uri: "mem://readme", name: "readme", mimeType: "text/plain" }];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function textContent(text) {
  return { content: [{ type: "text", text }] };
}

async function callTool(name, args) {
  switch (name) {
    case "echo":
      return textContent(`echo: ${args?.message ?? ""}`);
    case "slow_echo": {
      const delay = typeof args?.delayMs === "number" ? Math.min(args.delayMs, 5000) : 1500;
      await new Promise((r) => setTimeout(r, delay));
      return textContent(`slow echo: ${args?.message ?? ""}`);
    }
    case "fail":
      return { ...textContent("this tool always fails"), isError: true };
    case "structured": {
      const n = typeof args?.n === "number" ? args.n : 1;
      return { ...textContent(JSON.stringify({ doubled: n * 2 })), structuredContent: { doubled: n * 2 } };
    }
    default:
      return null;
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined;

  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, prompts: {}, resources: {} },
        serverInfo: { name: "mcp-doctor-fixture", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
      return; // notification, no reply
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools });
      return;
    case "prompts/list":
      reply(id, { prompts });
      return;
    case "resources/list":
      reply(id, { resources });
      return;
    case "resources/read":
      reply(id, { contents: [{ uri: params?.uri, mimeType: "text/plain", text: "hello from mcp-doctor fixture" }] });
      return;
    case "prompts/get":
      reply(id, { description: "greet", messages: [{ role: "user", content: { type: "text", text: "Hello!" } }] });
      return;
    case "tools/call": {
      const name = params?.name;
      const result = await callTool(name, params?.arguments);
      if (result === null) {
        replyError(id, -32602, `Unknown tool: ${name}`);
        return;
      }
      reply(id, result);
      return;
    }
    default:
      if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  try {
    await handle(msg);
  } catch (err) {
    if (msg.id !== undefined) replyError(msg.id, -32603, String(err));
  }
});
