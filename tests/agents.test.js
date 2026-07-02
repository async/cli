import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/cli.js");

test("--agents prints the managed AGENTS.md block", async () => {
  await withRepo(async ({ project, env }) => {
    const result = spawnCli(["--agents"], { cwd: project, env });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /<!-- async-cli:begin -->/);
    assert.match(result.stdout, /## Project commands \(async\/cli\)/);
    assert.match(result.stdout, /cli --list --json/);
    assert.match(result.stdout, /<!-- async-cli:end -->/);
  });
});

test("--agents --write creates AGENTS.md and --check accepts the current block", async () => {
  await withRepo(async ({ project, env }) => {
    const write = spawnCli(["--agents", "--write"], { cwd: project, env });
    assert.equal(write.status, 0, write.stderr);

    const first = await readFile(path.join(project, "AGENTS.md"), "utf8");
    assert.match(first, /<!-- async-cli:begin -->/);

    const check = spawnCli(["--agents", "--check"], { cwd: project, env });
    assert.equal(check.status, 0, check.stderr);

    const rewrite = spawnCli(["--agents", "--write"], { cwd: project, env });
    assert.equal(rewrite.status, 0, rewrite.stderr);
    const second = await readFile(path.join(project, "AGENTS.md"), "utf8");
    assert.equal(second, first);
  });
});

test("--agents --write preserves existing content outside managed markers", async () => {
  await withRepo(async ({ project, env }) => {
    await writeFile(path.join(project, "AGENTS.md"), "# Existing\n\nKeep this.\n", "utf8");

    const write = spawnCli(["--agents", "--write"], { cwd: project, env });
    assert.equal(write.status, 0, write.stderr);

    const content = await readFile(path.join(project, "AGENTS.md"), "utf8");
    assert.match(content, /^# Existing/);
    assert.match(content, /Keep this\./);
    assert.match(content, /<!-- async-cli:begin -->/);
  });
});

test("--agents --check fails for stale blocks with a matching write hint", async () => {
  await withRepo(async ({ project, env }) => {
    await writeFile(
      path.join(project, "AGENTS.md"),
      "<!-- async-cli:begin -->\nstale\n<!-- async-cli:end -->\n",
      "utf8"
    );

    const check = spawnCli(["--agents", "--check"], { cwd: project, env });
    assert.equal(check.status, 1);
    assert.match(check.stderr, /cli --agents --write/);
  });
});

test("--agents --claude targets CLAUDE.md only when requested", async () => {
  await withRepo(async ({ project, env }) => {
    const write = spawnCli(["--agents", "--claude", "--write"], { cwd: project, env });
    assert.equal(write.status, 0, write.stderr);

    assert.ok((await stat(path.join(project, "CLAUDE.md"))).isFile());
    await assert.rejects(readFile(path.join(project, "AGENTS.md"), "utf8"), { code: "ENOENT" });

    const check = spawnCli(["--agents", "--claude", "--check"], { cwd: project, env });
    assert.equal(check.status, 0, check.stderr);
  });
});

test("--agents rejects arbitrary file targets", async () => {
  await withRepo(async ({ project, env }) => {
    const result = spawnCli(["--agents", "--file", "README.md"], { cwd: project, env });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unsupported --agents option: --file/);
  });
});

async function withRepo(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "async-cli-agents-"));
  const project = path.join(root, "repo");
  const env = {
    ...process.env,
    ASYNC_CLI_GLOBAL_ROOT: path.join(root, "global-cli")
  };

  await mkdir(path.join(project, ".git"), { recursive: true });
  await mkdir(env.ASYNC_CLI_GLOBAL_ROOT, { recursive: true });

  try {
    await fn({ root, project, env });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function spawnCli(args, { cwd, env }) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: "utf8"
  });
}
