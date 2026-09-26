import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * HTTP/SSE transport.
 *
 * `StreamableHTTPClientTransport` is the SDK's standard client for:
 *   - MCP Streamable HTTP (POST, SSE response, session reuse)
 *   - legacy HTTP+SSE (SSE `GET`, POST to the `message` endpoint)
 *
 * We just wrap it with a stable `makeHttpTransport()` surface and surface
 * its `onerror`/`onclose` handlers.
 */
export interface HttpTransportLike {
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;
}

export function makeHttpTransport(opts: {
  url: string;
  headers?: Record<string, string>;
}): HttpTransportLike {
  return new StreamableHTTPClientTransport(new URL(opts.url), {
    requestInit: {
      headers: opts.headers ?? {},
    },
  }) as unknown as HttpTransportLike;
}