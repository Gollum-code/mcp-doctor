import { ServerConfig } from "../types.js";
import { StdioTransport } from "./stdio.js";
import { makeHttpTransport, HttpTransportLike } from "./http.js";

export type TransportLike = StdioTransport | HttpTransportLike;

/** Build a transport for the given server config. */
export function createTransport(config: ServerConfig): TransportLike {
  if (config.transport === "stdio") {
    if (!config.command) throw new Error(`no "command" for stdio server "${config.id}"`);
    return new StdioTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    });
  }
  if (config.transport === "http") {
    if (!config.url) throw new Error(`no "url" for http server "${config.id}"`);
    return makeHttpTransport({ url: config.url, headers: config.headers });
  }
  throw new Error(`unknown transport "${(config as ServerConfig).transport}"`);
}

export function isStdioTransport(t: TransportLike): t is StdioTransport {
  return t instanceof StdioTransport;
}