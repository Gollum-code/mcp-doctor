import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { ReadBuffer } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MAX_STDERR_CAPTURE } from "../constants.js";

/**
 * Minimal client-side stdio transport.
 *
 * MCP speaks JSON-RPC over stdio. Newer MCP versions (and this SDK) use
 * newline-delimited JSON; older versions used `Content-Length` headers.
 * The SDK's `ReadBuffer` handles both, so we reuse it here while keeping
 * full control over the spawned child process (so we can kill it on timeout).
 */
export class StdioTransport implements Transport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = new ReadBuffer();
  private closed = false;
  private stderrTail = "";

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private opts: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  ) {}

  /** Kick off the child process and start reading its stdout. */
  start(): Promise<void> {
    if (this.child) throw new Error("stdio transport already started");

    const child = spawn(this.opts.command, this.opts.args ?? [], {
      cwd: this.opts.cwd,
      env: { ...process.env, ...(this.opts.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.child = child as ChildProcessWithoutNullStreams;

    child.stderr.on("data", (chunk: Buffer) => {
      const room = MAX_STDERR_CAPTURE - this.stderrTail.length;
      if (room > 0) {
        this.stderrTail += chunk.toString("utf8").slice(0, room);
      }
    });

    child.on("error", (err) => {
      if (this.onerror) this.onerror(err);
    });

    child.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        if (this.onclose) this.onclose();
      }
    });

    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer.append(chunk);
      this.pump();
    });

    return Promise.resolve();
  }

  /** Try to parse as many complete messages as possible from the buffer. */
  private pump(): void {
    if (this.closed || !this.child) return;
    let message: JSONRPCMessage | null;
    while ((message = this.buffer.readMessage()) !== null) {
      const handler = this.onmessage;
      if (handler) handler(message);
    }
  }

  getStderrTail(): string {
    return this.stderrTail;
  }

  send(message: JSONRPCMessage): Promise<void> {
    if (!this.child || this.child.stdin.destroyed || this.closed) {
      return Promise.reject(new Error("stdio transport is not connected"));
    }
    try {
      this.child.stdin.write(JSON.stringify(message) + "\n");
    } catch (err) {
      return Promise.reject(err as Error);
    }
    return Promise.resolve();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 500);
      if (child.exitCode !== null) {
        clearTimeout(timer);
        resolve();
        return;
      }
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
