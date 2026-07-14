#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const denoBin = process.env.DENO_BIN?.trim() || "deno";
const minimumDeno = { major: 2, minor: 7 };
const commandTimeoutMs = 120_000;

let tempRoot;

try {
  const denoVersion = probeDeno();
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "async-cli-deno-"));
  const packageDirectory = path.join(tempRoot, "package");
  const appDirectory = path.join(tempRoot, "app");

  await mkdir(packageDirectory, { recursive: true });
  await mkdir(appDirectory, { recursive: true });

  runChecked("npm", ["pack", repoRoot, "--ignore-scripts"], {
    cwd: packageDirectory
  });
  const tarball = await findTarball(packageDirectory);
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

  await writeFile(path.join(appDirectory, "package.json"), `${JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "@async/cli": `file:${tarball}`
    }
  }, null, 2)}\n`, "utf8");

  runChecked("npm", ["install", "--ignore-scripts", "--package-lock=false"], {
    cwd: appDirectory
  });

  const cliPath = path.join(appDirectory, "node_modules", "@async", "cli", "dist", "cli.js");
  runDenoChecked(["check", cliPath], { cwd: appDirectory });

  const version = runDenoChecked(["run", "-A", cliPath, "--version"], {
    cwd: appDirectory
  });
  if (version.stdout.trim() !== packageJson.version) {
    throw new Error(`Deno CLI version mismatch: expected ${packageJson.version}, received ${version.stdout.trim()}.`);
  }

  const failDirectory = path.join(appDirectory, ".cli", "fail");
  await mkdir(failDirectory, { recursive: true });
  for (const extension of ["js", "mjs", "ts", "mts"]) {
    const probeDirectory = path.join(appDirectory, ".cli", extension);
    await mkdir(probeDirectory, { recursive: true });
    await writeFile(path.join(probeDirectory, `script.${extension}`), [
      "// cli: Deno host smoke",
      ...(extension === "ts" || extension === "mts"
        ? ["enum RuntimeHost { Deno = 'deno' }", "const runtime = RuntimeHost.Deno;"]
        : ["const runtime = 'deno';"]),
      "console.log(JSON.stringify({",
      "  runtime,",
      "  denoArgs: Deno.args,",
      "  processArgs: process.argv.slice(2),",
      "  command: Deno.env.get('CLI_COMMAND'),",
      "  scope: process.env.CLI_SCOPE,",
      "  cwd: Deno.cwd()",
      "}));",
      ""
    ].join("\n"), "utf8");
  }
  await writeFile(path.join(failDirectory, "script.ts"), "Deno.exit(7);\n", "utf8");

  const env = {
    ...process.env,
    ASYNC_CLI_GLOBAL_ROOT: path.join(appDirectory, "global"),
    ASYNC_CLI_TRUST: "off",
    DENO_NO_UPDATE_CHECK: "1"
  };
  const expectedCwd = await realpath(appDirectory);
  for (const extension of ["js", "mjs", "ts", "mts"]) {
    const probe = runDenoChecked(["run", "-A", cliPath, extension, "one", "--", "two"], {
      cwd: appDirectory,
      env
    });
    const payload = JSON.parse(probe.stdout.trim());
    if (
      payload.runtime !== "deno" ||
      payload.command !== extension ||
      payload.scope !== "local" ||
      payload.cwd !== expectedCwd ||
      JSON.stringify(payload.denoArgs) !== JSON.stringify(["one", "two"]) ||
      JSON.stringify(payload.processArgs) !== JSON.stringify(["one", "two"])
    ) {
      throw new Error(`Unexpected Deno ${extension} command payload: ${probe.stdout.trim()}`);
    }
  }

  const failure = runDeno(["run", "-A", cliPath, "fail"], { cwd: appDirectory, env });
  if (failure.error) {
    throw failure.error;
  }
  if (failure.status !== 7) {
    throw new Error(`Deno command exit propagation failed: expected 7, received ${failure.status ?? 1}.\n${tail(failure.stderr)}`);
  }

  console.log(`Deno host smoke passed with ${denoVersion}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (tempRoot && process.env.ASYNC_CLI_KEEP_DENO_SMOKE !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function probeDeno() {
  const result = runChecked(denoBin, ["--version"], { cwd: repoRoot });
  const match = /^deno (\d+)\.(\d+)\.\d+/m.exec(result.stdout);
  if (!match) {
    throw new Error(`Could not parse Deno version from ${denoBin} --version.`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < minimumDeno.major || (major === minimumDeno.major && minor < minimumDeno.minor)) {
    throw new Error(`Deno ${minimumDeno.major}.${minimumDeno.minor}+ is required; found ${match[0].slice(5)}.`);
  }
  return match[0].slice(5);
}

async function findTarball(directory) {
  const files = await readdir(directory);
  const tarball = files.find((file) => file.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("npm pack did not create a tarball for the Deno smoke.");
  }
  return path.join(directory, tarball);
}

function runDeno(args, options) {
  return run(denoBin, args, options);
}

function runDenoChecked(args, options) {
  return runChecked(denoBin, args, options);
}

function runChecked(command, args, options) {
  const result = run(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} exited with ${result.status ?? 1}.`,
      tail(result.stdout),
      tail(result.stderr)
    ].filter(Boolean).join("\n"));
  }
  return result;
}

function run(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: commandTimeoutMs,
    maxBuffer: 8 * 1024 * 1024
  });
}

function tail(output) {
  return output.trim().split(/\r?\n/).slice(-30).join("\n");
}
