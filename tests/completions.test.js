import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/cli.js");

test("--complete suggests next command segments", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(project, ".cli", "gh", "pull", "script.js"));
    await writeScript(path.join(project, ".cli", "gh", "pr", "script.js"));
    await writeScript(path.join(globalRoot, "deploy", "script.js"));

    const top = spawnCli(["--complete", "--", "g"], { cwd: project, env });
    assert.equal(top.status, 0, top.stderr);
    assert.deepEqual(lines(top.stdout), ["gh"]);

    const nested = spawnCli(["--complete", "--", "gh", ""], { cwd: project, env });
    assert.deepEqual(lines(nested.stdout), ["pr", "pull"]);

    const partial = spawnCli(["--complete", "--", "gh", "pu"], { cwd: project, env });
    assert.deepEqual(lines(partial.stdout), ["pull"]);

    const global = spawnCli(["--complete", "--", "de"], { cwd: project, env });
    assert.deepEqual(lines(global.stdout), ["deploy"]);
  });
});

test("--complete suggests built-in flags for a leading dash", async () => {
  await withFixture(async ({ project, env }) => {
    const result = spawnCli(["--complete", "--", "--"], { cwd: project, env });
    assert.equal(result.status, 0, result.stderr);
    const flags = lines(result.stdout);
    assert.ok(flags.includes("--list"));
    assert.ok(flags.includes("--doctor"));
    assert.ok(flags.includes("--trust"));
    assert.ok(!flags.includes("--mcp"));
  });
});

test("--complete hides shadowed commands", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(project, ".cli", "gh", "script.js"));
    await writeScript(path.join(globalRoot, "gh", "clone", "script.js"));

    const result = spawnCli(["--complete", "--", "gh", ""], { cwd: project, env });
    assert.deepEqual(lines(result.stdout), []);
  });
});

test("--complete includes farther commands behind namespace-only overlays", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(project, ".cli", "gh", "status", "script.js"));
    await writeScript(path.join(globalRoot, "gh", "clone", "script.js"));

    const result = spawnCli(["--complete", "--", "gh", "cl"], { cwd: project, env });
    assert.deepEqual(lines(result.stdout), ["clone"]);
  });
});

test("--completions emits shell scripts", async () => {
  await withFixture(async ({ project, env }) => {
    const bash = spawnCli(["--completions", "bash"], { cwd: project, env });
    assert.equal(bash.status, 0, bash.stderr);
    assert.match(bash.stdout, /complete -F _async_cli_complete cli async-cli/);

    const zsh = spawnCli(["--completions", "zsh"], { cwd: project, env });
    assert.match(zsh.stdout, /compdef _async_cli_complete cli async-cli/);

    const fish = spawnCli(["--completions", "fish"], { cwd: project, env });
    assert.match(fish.stdout, /complete -c cli -f/);

    const unsupported = spawnCli(["--completions", "powershell"], { cwd: project, env });
    assert.equal(unsupported.status, 2);
    assert.match(unsupported.stderr, /Unsupported completion shell/);
  });
});

function lines(text) {
  return text.split("\n").filter((line) => line.length > 0);
}

async function withFixture(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "async-cli-complete-")));
  const home = path.join(root, "home");
  const project = path.join(home, "repo");
  const globalRoot = path.join(root, "global-cli");
  const env = {
    ...process.env,
    ASYNC_CLI_GLOBAL_ROOT: globalRoot
  };

  await mkdir(path.join(project, ".git"), { recursive: true });
  await mkdir(globalRoot, { recursive: true });

  try {
    await fn({ root, home, project, globalRoot, env });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeScript(file, content = "console.log('ok');\n") {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

function spawnCli(args, { cwd, env }) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: "utf8"
  });
}
