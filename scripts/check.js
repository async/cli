import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const errors = [];

if (packageJson.name !== "@async/cli") {
  errors.push("package.json must identify @async/cli");
}

if (packageJson.type !== "module") {
  errors.push("package.json must set type=module");
}

if (packageJson.engines?.node !== ">=24") {
  errors.push("package.json must require Node >=24");
}

if (packageJson.bin?.cli !== "./dist/cli.js") {
  errors.push("package.json must expose cli bin");
}

if (packageJson.bin?.["async-cli"] !== "./dist/cli.js") {
  errors.push("package.json must expose async-cli bin");
}

if (Object.keys(packageJson.dependencies ?? {}).length > 0) {
  errors.push("runtime dependencies must stay empty for the scaffold");
}

for (const requiredFile of ["README.md", "SPEC.md", "AGENTS.md", "CHANGELOG.md", "tsconfig.json"]) {
  try {
    await stat(requiredFile);
  } catch (error) {
    if (error.code === "ENOENT") {
      errors.push(`missing required file ${requiredFile}`);
    } else {
      throw error;
    }
  }
}

for (const file of await collectJavaScriptFiles(["scripts", "tests"])) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    errors.push(`node --check failed for ${file}\n${result.stderr.trim()}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log("async-cli scaffold check passed");
}

async function collectJavaScriptFiles(roots) {
  const files = [];
  for (const root of roots) {
    files.push(...await walk(root));
  }
  return files.filter((file) => file.endsWith(".js")).sort();
}

async function walk(entry) {
  let info;
  try {
    info = await stat(entry);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  if (info.isFile()) {
    return [entry];
  }

  if (!info.isDirectory()) {
    return [];
  }

  const children = await readdir(entry);
  const nested = await Promise.all(
    children
      .filter((child) => child !== "node_modules" && child !== "dist")
      .map((child) => walk(path.join(entry, child)))
  );
  return nested.flat();
}
