#!/usr/bin/env node
/**
 * A tiny, dependency-free MCP Streamable-HTTP server fixture for testing
 * mcp-doctor's `http` transport path.
 *
 * It accepts JSON-RPC 2.0 over HTTP POST at `/mcp`, responding with either
 * `application/json` (regular) or `text/event-stream` (SSE) — the two modes
 * the MCP Streamable HTTP spec allows and the SDK client supports.
 *
 *   node examples/http-fixture-server.mjs            # listen on 127.0.0.1:3211
 *   node dist/cli.js -u http://127.0.0.1:3211/mcp
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3211);
const PROTOCOL_VERSION = "2025-06-18";

const tools = [
  {
    name: "http_echo",
    description: "Echo a message over HTTP.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
  {
    name: "http_bad",
    description: "Always returns isError=true.",
    inputSchema: { type: "object", properties: {} },
  },
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  if (req.method === "GET") {
    // SSE stream endpoint (kept alive, no server-initiated messages needed).
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("event: endpoint\ndata: /mcp\n\n");
    return;
  }

  if (req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }

    const result = handle(msg);
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      ...result,
    });

    const accept = req.headers["accept"] ?? "";
    if (accept.includes("text/event-stream") && msg.id !== undefined) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(`event: message\ndata: ${payload}\n\n`);
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(payload);
    }
    return;
  }

  res.writeHead(405);
  res.end();
});

function handle(msg) {
  const method = msg?.method;
  switch (method) {
    case "initialize":
      return {
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {}, prompts: {}, resources: {} },
          serverInfo: { name: "mcp-doctor-http-fixture", version: "0.1.0" },
        },
      };
    case "notifications/initialized":
      return { result: {} };
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools } };
    case "prompts/list":
      return { result: { prompts: [] } };
    case "resources/list":
      return { result: { resources: [] } };
    case "tools/call": {
      const name = msg.params?.name;
      if (name === "http_echo") {
        return {
          result: { content: [{ type: "text", text: `http echo: ${msg.params?.arguments?.message ?? ""}` }] },
        };
      }
      if (name === "http_bad") {
        return { result: { content: [{ type: "text", text: "bad over http" }], isError: true } };
      }
      return { error: { code: -32602, message: `Unknown tool: ${name}` } };
    }
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

server.listen(PORT, "127.0.0.1", () => {
  console.error(`http fixture listening on http://127.0.0.1:${PORT}/mcp`);
});