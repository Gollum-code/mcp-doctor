import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { ServerConfig, ToolInfo } from "./types.js";
import { createTransport, TransportLike, isStdioTransport } from "./transport/index.js";
import { CONNECT_TIMEOUT_MS, NAME, VERSION } from "./constants.js";
import { vlog } from "./logger.js";

/** Thin promise wrapper so a hung request can be abandoned (and reported) on a timer. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`timed out after ${ms}ms: ${label}`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export class TimeoutError extends Error {
  readonly isTimeout = true;
}

export interface ConnectedClient {
  client: Client;
  transport: TransportLike;
  /** Negotiated protocol version captured from the initialize result. */
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  close(): Promise<void>;
}

/** Wraps a transport to capture the negotiated protocol version via setProtocolVersion. */
class TrackingTransport {
  private capturedVersion: string | undefined;

  constructor(private inner: Transport) {}

  get onclose() {
    return this.inner.onclose;
  }
  set onclose(v: (() => void) | undefined) {
    this.inner.onclose = v;
  }
  get onerror() {
    return this.inner.onerror;
  }
  set onerror(v: ((error: Error) => void) | undefined) {
    this.inner.onerror = v;
  }
  get onmessage() {
    return this.inner.onmessage as ((message: JSONRPCMessage, extra?: unknown) => void) | undefined;
  }
  set onmessage(v: ((message: JSONRPCMessage, extra?: unknown) => void) | undefined) {
    this.inner.onmessage = v as unknown as NonNullable<Transport["onmessage"]>;
  }
  get sessionId() {
    return this.inner.sessionId;
  }
  start() {
    return this.inner.start();
  }
  send(message: JSONRPCMessage, options?: unknown) {
    return this.inner.send(message, options as never);
  }
  close() {
    return this.inner.close();
  }
  setProtocolVersion(v: string) {
    this.capturedVersion = v;
    this.inner.setProtocolVersion?.(v);
  }
  getProtocolVersion(): string | undefined {
    return this.capturedVersion;
  }
}

/**
 * Connect a raw JSON-RPC MCP client to a server config, performing the
 * full `initialize` handshake. The SDK's `Client.connect()` sends
 * `initialize` and then `notifications/initialized`.
 */
export async function connect(config: ServerConfig, connectTimeoutMs = CONNECT_TIMEOUT_MS): Promise<ConnectedClient> {
  const transport = createTransport(config);
  const tracking = new TrackingTransport(transport);
  const client = new Client({ name: NAME, version: VERSION }, { capabilities: {} });

  // Surface transport errors so a broken server reports instead of hanging.
  const transportErrors: Error[] = [];
  transport.onerror = (err) => {
    transportErrors.push(err);
    vlog(`[${config.id}] transport error:`, err.message);
  };

  vlog(`[${config.id}] connecting via ${config.transport}…`);

  try {
    await withTimeout(client.connect(tracking as never), connectTimeoutMs, `connect(${config.id})`);
  } catch (err) {
    if (transportErrors.length > 0) {
      const first = transportErrors[0];
      if (first && !isStdioTransport(transport)) throw first;
    }
    throw err;
  }

  const close = async () => {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
  };

  return {
    client,
    transport,
    close,
    protocolVersion: tracking.getProtocolVersion(),
    serverName: client.getServerVersion()?.name,
    serverVersion: client.getServerVersion()?.version,
  };
}

export interface DiscoveryResult {
  protocolVersion: string | null;
  capabilities: Record<string, unknown> | null;
  tools: ToolInfo[];
  promptsCount: number;
  resourcesCount: number;
  /** Non-fatal notes about prompts/resources discovery. */
  notes: string[];
}

/** `tools/list` + `prompts/list` + `resources/list` (each guarded). */
export async function discover(client: Client): Promise<DiscoveryResult> {
  const capabilities = (client.getServerCapabilities() ?? null) as Record<string, unknown> | null;

  const toolsRes = await client.listTools();
  const tools: ToolInfo[] = (toolsRes.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    outputSchema: (t as { outputSchema?: unknown }).outputSchema,
  }));

  const notes: string[] = [];
  let promptsCount = 0;
  try {
    const res = await client.listPrompts();
    promptsCount = (res.prompts ?? []).length;
  } catch (err) {
    notes.push(`prompts/list unsupported: ${(err as Error).message}`);
  }

  let resourcesCount = 0;
  try {
    const res = await client.listResources();
    resourcesCount = (res.resources ?? []).length;
  } catch (err) {
    notes.push(`resources/list unsupported: ${(err as Error).message}`);
  }

  return { protocolVersion: null, capabilities, tools, promptsCount, resourcesCount, notes };
}