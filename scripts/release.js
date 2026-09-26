#!/usr/bin/env node
/**
 * One-shot release helper for mcp-doctor.
 *
 *   node scripts/release.js patch   # 0.1.0 -> 0.1.1 (default)
 *   node scripts/release.js minor   # 0.1.0 -> 0.2.0
 *   node scripts/release.js major   # 0.1.0 -> 1.0.0
 *   node scripts/release.js 0.2.0   # explicit version
 *   node scripts/release.js --dry-run
 *
 * Steps: bump package.json -> typecheck + test + build -> git tag vX.Y.Z
 *        -> publish --access public (interactive, you approve the OTP in browser)
 *
 * Requires: logged-in npm (npm whoami), a git remote named `origin`.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const bump = process.argv[2] ?? "patch";
const dryRun = process.argv.includes("--dry-run");

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  if (dryRun) return "";
  return execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

function nextVersion(bumpOrVersion) {
  if (/^\d+\.\d+\.\d+/.test(bumpOrVersion)) return bumpOrVersion;
  const [maj, min, pat] = pkg.version.split(".").map(Number);
  if (bumpOrVersion === "major") return `${maj + 1}.0.0`;
  if (bumpOrVersion === "minor") return `${maj}.${min + 1}.0`;
  if (bumpOrVersion === "patch") return `${maj}.${min}.${pat + 1}`;
  throw new Error(`unknown bump "${bumpOrVersion}" (use patch|minor|major|X.Y.Z)`);
}

const version = nextVersion(bump);
const tag = `v${version}`;

console.log(`mcp-doctor release: ${pkg.version} -> ${version}${dryRun ? "  [DRY RUN]" : ""}`);

if (!dryRun) {
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  // Keep package-lock.json in sync with the new version.
  const lockPath = path.join(root, "package-lock.json");
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.version = version;
    if (lock.packages) {
      if (lock.packages[""]) lock.packages[""].version = version;
      if (lock.packages["node_modules/@gollum-code/mcp-doctor"]) {
        lock.packages["node_modules/@gollum-code/mcp-doctor"].version = version;
      }
    }
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
  }
}

run("npm run typecheck");
run("npm test");
run("npm run build");
run(`git add package.json package-lock.json`);
run(`git commit -m "chore: release ${version}"`);
run(`git tag -a ${tag} -m "${tag}"`);
run("git push origin HEAD");
run(`git push origin ${tag}`);

if (dryRun) {
  console.log("\n[dry-run] skipped publish — run without --dry-run to publish.");
} else {
  // Interactive: prints the auth URL for you to approve, then PUTs.
  run("npm publish --access public");
}

console.log(`\n✅ released @gollum-code/mcp-doctor@${version}`);
