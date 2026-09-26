let verboseFlag = false;

export function setVerbose(v: boolean): void {
  verboseFlag = v;
}

export function isVerbose(): boolean {
  return verboseFlag;
}

export function vlog(...args: unknown[]): void {
  if (verboseFlag) {
    console.error("[mcp-doctor] ", ...args);
  }
}
