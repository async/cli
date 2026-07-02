#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(repoRoot, "dist", "cli.js");
const binaryNames = ["cli", "async-cli"];

async function main(argv) {
  const command = argv[0] ?? "status";
  const options = parseOptions(argv.slice(1));
  const binDir = resolveBinDir(options);

  if (command === "link") {
    await linkBinaries({ binDir, force: options.force });
    return;
  }

  if (command === "unlink") {
    await unlinkBinaries({ binDir });
    return;
  }

  if (command === "status") {
    await printStatus({ binDir, json: options.json });
    return;
  }

  throw new UsageError(`unknown command: ${command}`);
}

async function linkBinaries({ binDir, force }) {
  await ensureTarget();
  await mkdir(binDir, { recursive: true });
  await chmod(target, 0o755);

  for (const name of binaryNames) {
    const linkPath = path.join(binDir, name);
    const state = await inspectLink(linkPath);

    if (state.kind === "managed") {
      console.log(`${name}: already linked`);
      continue;
    }

    if (state.kind !== "missing") {
      if (!force) {
        throw new UsageError(`${linkPath} already exists and is not managed by this checkout; rerun with --force to replace it`);
      }
      if (state.kind === "directory") {
        throw new UsageError(`${linkPath} is a directory and cannot be replaced`);
      }
      await rm(linkPath, { force: true });
    }

    await symlink(target, linkPath);
    console.log(`${name}: linked`);
  }
}

async function unlinkBinaries({ binDir }) {
  for (const name of binaryNames) {
    const linkPath = path.join(binDir, name);
    const state = await inspectLink(linkPath);

    if (state.kind === "missing") {
      console.log(`${name}: missing`);
      continue;
    }

    if (state.kind !== "managed") {
      throw new UsageError(`${linkPath} is not managed by this checkout`);
    }

    await rm(linkPath, { force: true });
    console.log(`${name}: unlinked`);
  }
}

async function printStatus({ binDir, json }) {
  const records = [];
  for (const name of binaryNames) {
    const linkPath = path.join(binDir, name);
    const state = await inspectLink(linkPath);
    records.push({
      name,
      path: linkPath,
      target,
      status: state.kind,
      currentTarget: state.currentTarget ?? null
    });
  }

  if (json) {
    console.log(JSON.stringify({ binDir, target, links: records }, null, 2));
    return;
  }

  for (const record of records) {
    const suffix = record.currentTarget ? ` -> ${record.currentTarget}` : "";
    console.log(`${record.name}: ${record.status}${suffix}`);
  }
}

async function inspectLink(linkPath) {
  let info;
  try {
    info = await lstat(linkPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }

  if (info.isDirectory()) {
    return { kind: "directory" };
  }

  if (!info.isSymbolicLink()) {
    return { kind: "external-file" };
  }

  const currentTarget = path.resolve(path.dirname(linkPath), await readlink(linkPath));
  return currentTarget === target
    ? { kind: "managed", currentTarget }
    : { kind: "external-link", currentTarget };
}

async function ensureTarget() {
  try {
    await access(target, fsConstants.F_OK);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new UsageError("dist/cli.js is missing; run pnpm run build before linking");
    }
    throw error;
  }
}

function resolveBinDir(options) {
  const selected = options.binDir
    ?? process.env.ASYNC_CLI_LOCAL_BIN_DIR
    ?? process.env.PNPM_HOME
    ?? path.join(homedir(), "Library", "pnpm");
  return path.resolve(expandHome(selected));
}

function parseOptions(args) {
  const options = {
    binDir: undefined,
    force: false,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--bin-dir") {
      const value = args[index + 1];
      if (!value) {
        throw new UsageError("--bin-dir requires a value");
      }
      options.binDir = value;
      index += 1;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new UsageError(`unknown option: ${arg}`);
  }

  return options;
}

function expandHome(value) {
  return value === "~" || value.startsWith("~/")
    ? path.join(homedir(), value.slice(2))
    : value;
}

class UsageError extends Error {}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(error.message);
    console.error("usage: node scripts/local-link.js <link|unlink|status> [--bin-dir <dir>] [--force] [--json]");
    process.exitCode = 2;
  } else {
    throw error;
  }
}
