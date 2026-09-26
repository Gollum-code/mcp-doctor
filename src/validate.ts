import { createRequire } from "node:module";
import type { ValidateFunction } from "ajv";

// ajv / ajv-formats are CommonJS. Under NodeNext ESM the `.default` dance is
// unreliable, so load them via createRequire to get the real constructors.
const require = createRequire(import.meta.url);
const { default: AjvClass } = require("ajv") as { default: new (opts?: Record<string, unknown>) => AjvInstance };
const { default: addFormatsClass } = require("ajv-formats") as {
  default: (ajv: AjvInstance) => void;
};

type AjvInstance = {
  compile: (schema: object) => ValidateFunction;
};

/**
 * Response validation.
 *
 * 1. `isValidJson` — the JSON-RPC layer already guarantees transport-level
 *    JSON parsing, so callers get +1 for "valid JSON" from a successful call.
 * 2. `validateArgs` — do the example args we generated satisfy the tool's
 *    declared `inputSchema`? (This doubles as a server-contract check.)
 * 3. `validateResult` — if the tool declared an `outputSchema`, validate the
 *    returned `structuredContent`/parsed text against it.
 */

export interface ValidationReport {
  argsValid: boolean;
  argsProblems: string[];
  resultValid: boolean | null; // null = no output schema to check
  resultProblems: string[];
  jsonValid: boolean;
}

const ajv = new AjvClass({ allErrors: true, strict: false, coerceTypes: false });
addFormatsClass(ajv);

const compileCache = new Map<string, ValidateFunction>();

export function compile(schema: unknown): { fn: ValidateFunction; key: string } {
  const key = JSON.stringify(schema);
  let fn = compileCache.get(key);
  if (!fn) {
    const compiled = ajv.compile(schema as object);
    compileCache.set(key, compiled);
    return { fn: compiled, key };
  }
  return { fn, key };
}

/** Validate a JS value against a JSON schema. Returns problem strings (or []). */
export function validateData(value: unknown, schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const { fn } = compile(schema);
  const ok = fn(value);
  if (ok) return [];
  return (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}

export interface CallResultShape {
  jsonValid: boolean;
  structuredValid: boolean | null;
  problems: string[];
}

/**
 * Lint the shape of a `callTool` result:
 *   - result must be an object
 *   - `content` (if present) must be an array of content blocks with a `type`
 *   - `isError` must be a boolean if present
 */
export function validateCallResultShape(raw: unknown): CallResultShape {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { jsonValid: false, structuredValid: null, problems: ["result is not a JSON object"] };
  }

  const rec = raw as Record<string, unknown>;
  const problems: string[] = [];
  let jsonValid = true;

  if (!Array.isArray(rec["content"])) {
    problems.push("result.content is missing or not an array");
    jsonValid = false;
  } else {
    for (const block of rec["content"] as unknown[]) {
      if (typeof block === "object" && block !== null && typeof (block as Record<string, unknown>)["type"] === "string") {
        continue;
      }
      problems.push("result.content contains a block without a string `type`");
      jsonValid = false;
      break;
    }
  }

  if (rec["isError"] !== undefined && typeof rec["isError"] !== "boolean") {
    problems.push("result.isError must be a boolean when present");
    jsonValid = false;
  }

  return { jsonValid, structuredValid: null, problems };
}

export interface ToolPreamble {
  name: string;
  description?: string;
}

export const KNOWN_MIME_TYPES = new Set([
  "application/json",
  "text/plain",
  "text/markdown",
  "application/xml",
  "application/yaml",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "audio/wav",
  "application/octet-stream",
]);