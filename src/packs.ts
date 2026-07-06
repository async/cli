import { spawn } from "node:child_process";
import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CliError } from "./errors.js";
import { isIgnoredCommandSegment, resolveScopedRoot, scriptFileNames } from "./router.js";
import type { CommandRoot, DiscoverRootsOptions } from "./router.js";

export interface AddPackOptions extends DiscoverRootsOptions {
  to?: "root" | "local";
  prefix?: string;
  force?: boolean;
}

export interface AddPackResult {
  source: string;
  root: CommandRoot;
  installed: string[];
}

export async function addPack(options: AddPackOptions = {}, source: string): Promise<AddPackResult> {
  if (!source || source.startsWith("-")) {
    throw new CliError("INVALID_ARGS", "cli --add requires a Git URL or path.");
  }
  if (options.prefix !== undefined) {
    validatePrefix(options.prefix);
  }

  const targetRoot = await resolveScopedRoot(options, options.to ?? "root");
  const staging = await mkdtemp(path.join(os.tmpdir(), "async-cli-pack-"));

  try {
    await gitClone(source, staging);
    const packRoot = path.join(staging, ".cli");
    if (!await isDirectory(packRoot)) {
      throw new CliError("PACK_INVALID", `Pack has no .cli/ directory: ${source}`);
    }

    const plan = await planInstall(packRoot, targetRoot.path, options.prefix);
    if (plan.length === 0) {
      throw new CliError("PACK_INVALID", `Pack .cli/ contains no command directories: ${source}`);
    }

    const conflicts = [];
    for (const step of plan) {
      if (await exists(step.to)) {
        conflicts.push(step.to);
      }
    }
    if (conflicts.length > 0 && !options.force) {
      throw new CliError("TARGET_EXISTS", "Refusing to overwrite existing command directories. Re-run with --force.", {
        files: conflicts
      });
    }

    for (const step of plan) {
      if (conflicts.includes(step.to)) {
        await rm(step.to, { recursive: true, force: true });
      }
      await cp(step.from, step.to, { recursive: true });
    }

    return {
      source,
      root: targetRoot,
      installed: plan.map((step) => step.command)
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function planInstall(
  packRoot: string,
  targetPath: string,
  prefix: string | undefined
): Promise<Array<{ from: string; to: string; command: string }>> {
  if (prefix) {
    return [{
      from: packRoot,
      to: path.join(targetPath, prefix),
      command: prefix
    }];
  }

  const entries = await readdir(packRoot, { withFileTypes: true });
  const hasRootScript = entries.some((entry) => entry.isFile() && scriptFileNames.includes(entry.name));
  if (hasRootScript) {
    throw new CliError(
      "PACK_INVALID",
      "Pack defines a command at its .cli/ root. Install it under a name with --prefix <name>."
    );
  }

  return entries
    .filter((entry) => entry.isDirectory() && !isIgnoredCommandSegment(entry.name))
    .map((entry) => ({
      from: path.join(packRoot, entry.name),
      to: path.join(targetPath, entry.name),
      command: entry.name
    }))
    .sort((a, b) => a.command.localeCompare(b.command));
}

function validatePrefix(prefix: string): void {
  if (
    prefix.length === 0 ||
    prefix === "." ||
    prefix === ".." ||
    path.isAbsolute(prefix) ||
    prefix.includes("/") ||
    prefix.includes("\\") ||
    prefix.startsWith(".") ||
    prefix.startsWith("_")
  ) {
    throw new CliError("UNSAFE_SEGMENT", `Unsafe pack prefix: ${prefix}`);
  }
}

async function gitClone(source: string, destination: string): Promise<void> {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("git", ["clone", "--depth", "1", "--quiet", "--", source, destination], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0 && stderr.length > 0) {
        reject(new CliError("GIT_FAILED", `git clone failed: ${stderr.trim().split("\n").slice(-3).join("\n")}`));
        return;
      }
      resolve(code ?? 1);
    });
  }).catch((error) => {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError("GIT_FAILED", `git clone failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  if (exitCode !== 0) {
    throw new CliError("GIT_FAILED", `git clone exited with ${exitCode}: ${source}`);
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}
