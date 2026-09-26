#!/usr/bin/env node
/**
 * Capture the demo output (with ANSI colors) into JSON frames, then hand off
 * to scripts/render-gif.py to render a looping GIF.
 *
 * Windows-friendly: we do NOT rely on `asciinema rec` (POSIX-only). We run the
 * demo, buffer colored stdout, and emit progressively longer slices so a
 * terminal-like animation can be rendered by the Python side.
 *
 *   node scripts/capture-demo.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The demo we record.
const command = ["scripts/demo.mjs"];

// Viewport: fixed height in terminal rows for the GIF viewer.
const ROWS = 22;
const COLS = 78;

const child = spawn(process.execPath, command, {
  cwd: root,
  env: { ...process.env, FORCE_COLOR: "1", COLUMNS: String(COLS), LINES: String(ROWS) },
  stdio: ["ignore", "pipe", "inherit"],
});

let buf = "";
child.stdout.on("data", (c) => {
  buf += c.toString("utf8");
});

child.on("exit", () => {
  mkdirSync(path.join(root, "docs"), { recursive: true });

  const lines = buf.split(/\r?\n/);
  const maxFrames = 60;
  const step = Math.max(1, Math.ceil(lines.length / maxFrames));
  const frames = [];
  for (let i = step; i < lines.length; i += step) {
    frames.push(lines.slice(0, i).join("\n"));
  }
  frames.push(lines.join("\n")); // hold final

  const pathOut = path.join(root, "docs", "demo-frames.json");
  writeFileSync(pathOut, JSON.stringify({ rows: ROWS, cols: COLS, frames }, null, 0), "utf8");
  console.log(`wrote ${frames.length} frames -> ${path.relative(root, pathOut)}`);
  void readFileSync;
});