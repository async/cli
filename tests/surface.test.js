import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverRoots } from "../dist/index.js";

const cliPath = path.resolve("dist/cli.js");

test("--edit opens the resolved script in $EDITOR", async () => {
  await withFixture(async ({ root, project, env }) => {
    const script = path.join(project, ".cli", "deploy", "script.js");
    await writeScript(script);

    const recorder = path.join(root, "recorder.mjs");
    const recorded = path.join(root, "recorded.txt");
    await writeFile(recorder, [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(recorded)}, process.argv[2] ?? "");`
    ].join("\n"), "utf8");

    const result = spawnCli(["--edit", "deploy"], {
      cwd: project,
      env: { ...env, EDITOR: `${process.execPath} ${recorder}`, VISUAL: "" }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(recorded, "utf8"), script);
  });
});

test("--rm removes a command directory and prunes empty parents", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "ops", "deploy", "script.js"));
    await writeScript(path.join(project, ".cli", "other", "script.js"));

    const result = spawnCli(["--rm", "ops", "deploy"], { cwd: project, env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /removed /);
    await assert.rejects(stat(path.join(project, ".cli", "ops")), { code: "ENOENT" });
    assert.ok((await stat(path.join(project, ".cli", "other", "script.js"))).isFile());
  });
});

test("--rm refuses nested commands without --force", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "ops", "script.js"));
    await writeScript(path.join(project, ".cli", "ops", "deploy", "script.js"));

    const refused = spawnCli(["--rm", "ops"], { cwd: project, env });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /nested commands/);
    assert.match(refused.stderr, /deploy/);

    const forced = spawnCli(["--rm", "ops", "--force"], { cwd: project, env });
    assert.equal(forced.status, 0, forced.stderr);
    await assert.rejects(stat(path.join(project, ".cli", "ops")), { code: "ENOENT" });
  });
});

test("--rm --root removes from the user-global tree", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(globalRoot, "hello", "script.js"));

    const result = spawnCli(["--rm", "hello", "--root"], { cwd: project, env });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(stat(path.join(globalRoot, "hello")), { code: "ENOENT" });
  });
});

test("--new --template copies a template command directory", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(
      path.join(project, ".cli", "_templates", "worker", "script.ts"),
      "// cli: worker template\nconsole.log('worker');\n"
    );
    await writeFile(path.join(project, ".cli", "_templates", "worker", "notes.txt"), "docs\n", "utf8");

    const result = spawnCli(["--new", "jobs", "run", "--template", "worker"], { cwd: project, env });
    assert.equal(result.status, 0, result.stderr);
    assert.ok((await stat(path.join(project, ".cli", "jobs", "run", "script.ts"))).isFile());
    assert.ok((await stat(path.join(project, ".cli", "jobs", "run", "notes.txt"))).isFile());

    const run = spawnCli(["jobs", "run"], { cwd: project, env });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /worker/);
  });
});

test("--new --template fails with available template suggestions", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "_templates", "worker", "script.ts"));

    const result = spawnCli(["--new", "jobs", "--template", "missing"], { cwd: project, env });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Template not found: missing/);
    assert.match(result.stderr, /worker/);
  });
});

test("cli-cwd pragma controls the script working directory", async () => {
  await withFixture(async ({ project, cwd, env }) => {
    const commandDirectory = path.join(project, ".cli", "where");
    await writeScript(
      path.join(commandDirectory, "script.js"),
      "// cli: where am i\nconsole.log(JSON.stringify({ cwd: process.cwd(), caller: process.env.CLI_CALLER_CWD }));\n"
    );
    await writeScript(
      path.join(project, ".cli", "rooted", "script.js"),
      "// cli: rooted\n// cli-cwd: project-root\nconsole.log(process.cwd());\n"
    );
    await writeScript(
      path.join(project, ".cli", "sited", "script.js"),
      "// cli-cwd: script-dir\nconsole.log(process.cwd());\n"
    );
    await writeScript(
      path.join(project, ".cli", "broken", "script.js"),
      "// cli-cwd: nonsense\nconsole.log('nope');\n"
    );

    const caller = spawnCli(["where"], { cwd, env });
    assert.equal(caller.status, 0, caller.stderr);
    const payload = JSON.parse(caller.stdout);
    assert.equal(payload.cwd, cwd);
    assert.equal(payload.caller, cwd);

    const rooted = spawnCli(["rooted"], { cwd, env });
    assert.equal(rooted.status, 0, rooted.stderr);
    assert.equal(rooted.stdout.trim(), project);

    const sited = spawnCli(["sited"], { cwd, env });
    assert.equal(sited.status, 0, sited.stderr);
    assert.equal(sited.stdout.trim(), path.join(project, ".cli", "sited"));

    const broken = spawnCli(["broken"], { cwd, env });
    assert.equal(broken.status, 2);
    assert.match(broken.stderr, /Unknown cli-cwd value/);
  });
});

test("global project-root uses the nearest local overlay owner or caller cwd", async () => {
  await withFixture(async ({ project, cwd, globalRoot, env }) => {
    await mkdir(path.join(project, ".cli"), { recursive: true });
    await writeScript(
      path.join(globalRoot, "rooted", "script.js"),
      "// cli-cwd: project-root\nconsole.log(JSON.stringify({ cwd: process.cwd(), project: process.env.CLI_PROJECT_ROOT }));\n"
    );

    const contextual = spawnCli(["rooted"], { cwd, env });
    assert.equal(contextual.status, 0, contextual.stderr);
    assert.deepEqual(JSON.parse(contextual.stdout), { cwd: project, project });

    await rm(path.join(project, ".cli"), { recursive: true, force: true });
    const caller = spawnCli(["rooted"], { cwd, env });
    assert.equal(caller.status, 0, caller.stderr);
    assert.deepEqual(JSON.parse(caller.stdout), { cwd, project: cwd });
  });
});

test("ASYNC_CLI_PROJECT_ROOT overrides script context without bounding discovery", async () => {
  await withFixture(async ({ root, home, project, cwd, globalRoot, env }) => {
    const override = path.join(root, "context-root");
    await mkdir(override, { recursive: true });
    await writeScript(path.join(home, ".cli", "ancestor", "script.js"));
    await writeScript(
      path.join(globalRoot, "rooted", "script.js"),
      "// cli-cwd: project-root\nconsole.log(process.cwd());\n"
    );
    const overriddenEnv = { ...env, ASYNC_CLI_PROJECT_ROOT: override };

    const roots = await discoverRoots({ cwd, env: overriddenEnv });
    assert.ok(roots.some((entry) => entry.path === path.join(home, ".cli")));
    assert.ok(roots.every((entry) => entry.projectRoot === override));

    const result = spawnCli(["rooted"], { cwd, env: overriddenEnv });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), override);
  });
});

async function withFixture(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "async-cli-surface-")));
  const home = path.join(root, "home");
  const project = path.join(home, "repo");
  const cwd = path.join(project, "packages", "app");
  const globalRoot = path.join(root, "global-cli");
  const env = {
    ...process.env,
    ASYNC_CLI_GLOBAL_ROOT: globalRoot,
    ASYNC_CLI_TRUST: "off"
  };

  await mkdir(path.join(project, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(globalRoot, { recursive: true });

  try {
    await fn({ root, home, project, cwd, globalRoot, env });
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
