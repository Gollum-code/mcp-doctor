import { describe, it, expect } from "vitest";
import { normalizeServer, loadConfigFile, configFromCommand, configFromUrl } from "../src/config.js";

describe("normalizeServer", () => {
  it("builds a stdio server", () => {
    const s = normalizeServer({ id: "a", transport: "stdio", command: "npx", args: ["-y", "server"] }, 0);
    expect(s.transport).toBe("stdio");
    expect(s.command).toBe("npx");
    expect(s.args).toEqual(["-y", "server"]);
  });

  it("builds an http server", () => {
    const s = normalizeServer({ id: "b", transport: "http", url: "https://x.test/mcp", headers: { "X-A": "1" } }, 1);
    expect(s.transport).toBe("http");
    expect(s.url).toBe("https://x.test/mcp");
    expect(s.headers?.["X-A"]).toBe("1");
  });

  it("throws on missing command / url", () => {
    expect(() => normalizeServer({ transport: "stdio", id: "x" }, 0)).toThrow(/command/);
    expect(() => normalizeServer({ transport: "http", id: "y" }, 0)).toThrow(/url/);
  });
});

describe("loadConfigFile", () => {
  it("loads a batch config file with multiple servers", () => {
    const servers = loadConfigFile("tests/fixtures/batch.config.json");
    expect(servers.length).toBe(2);
    expect(servers[0]!.id).toBe("one");
    expect(servers[1]!.transport).toBe("http");
  });

  it("loads a bare array config", () => {
    const servers = loadConfigFile("tests/fixtures/array.config.json");
    expect(servers.length).toBe(1);
  });

  it("throws meaningful error for missing file", () => {
    expect(() => loadConfigFile("tests/fixtures/nope.json")).toThrow(/cannot read config/);
  });
});

describe("shorthands", () => {
  it("configFromCommand splits the commandline", () => {
    const s = configFromCommand("npx -y @modelcontextprotocol/server-everything", undefined, "ev");
    expect(s.command).toBe("npx");
    expect(s.args).toEqual(["-y", "@modelcontextprotocol/server-everything"]);
    expect(s.id).toBe("ev");
  });

  it("configFromUrl derives id from the host", () => {
    const s = configFromUrl("https://mcp.example.com/mcp");
    expect(s.id).toBe("mcp.example.com");
    expect(s.transport).toBe("http");
  });
});