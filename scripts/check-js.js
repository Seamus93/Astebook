import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ignoredDirs = new Set([".git", "node_modules"]);
const roots = ["server.js", "lib", "public", "scrapers", "scripts", "tests"];

function collectJsFiles(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return path.endsWith(".js") ? [path] : [];
  if (!stat.isDirectory()) return [];

  return readdirSync(path)
    .filter((entry) => !ignoredDirs.has(entry))
    .flatMap((entry) => collectJsFiles(join(path, entry)));
}

const files = roots.flatMap(collectJsFiles);
const failures = files.filter((file) => {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  return result.status !== 0;
});

if (failures.length > 0) {
  process.exitCode = 1;
}
