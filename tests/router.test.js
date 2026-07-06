import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CliError,
  copyCommand,
  createCommand,
  discoverRoots,
  listCommands,
  moveCommand,
  resolveCommand
} from "../dist/index.js";

const cliPath = path.resolve("dist/cli.js");

test("discoverRoots collects nearest local overlays, stops at git root, and appends global once", async () => {
  await withFixture(async ({ project, cwd, globalRoot, env }) => {
    await mkdir(path.join(project, ".cli"), { recursive: true });
    await mkdir(path.join(cwd, ".cli"), { recursive: true });

    const roots = await discoverRoots({ cwd, env });

    assert.deepEqual(roots.map((root) => root.path), [
      path.join(cwd, ".cli"),
      path.join(project, ".cli"),
      globalRoot
    ]);
    assert.deepEqual(roots.map((root) => root.scope), ["local", "local", "root"]);
  });
});

test("listCommands ignores reserved path segments and reads first-line descriptions", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(project, ".cli", "deploy", "script.js"), "// cli: Deploy the app\n");
    await writeScript(path.join(project, ".cli", "foo_bar", "script.js"), "// cli: Uses underscores\n");
    await writeScript(path.join(project, ".cli", "help", "script.js"));
    await writeScript(path.join(project, ".cli", "lib", "x", "script.js"));
    await writeScript(path.join(project, ".cli", "_private", "script.js"));
    await writeScript(path.join(project, ".cli", ".hidden", "script.js"));
    await writeScript(path.join(globalRoot, "deploy", "script.js"), "// cli: Global deploy\n");

    const listing = await listCommands({ cwd: project, env });
    const visible = listing.commands.map((command) => command.command);

    assert.ok(visible.includes("deploy"));
    assert.ok(visible.includes("foo_bar"));
    assert.ok(!visible.includes("help"));
    assert.ok(!visible.includes("lib x"));
    assert.ok(!visible.includes("_private"));
    assert.equal(listing.commands.find((command) => command.command === "deploy" && command.scope === "local")?.description, "Deploy the app");
    assert.equal(listing.version, 1);
  });
});

test("resolveCommand applies first-overlay longest-prefix namespace shadowing", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(project, ".cli", "gh", "script.js"));
    await writeScript(path.join(globalRoot, "gh", "clone", "script.js"));

    const resolution = await resolveCommand({ cwd: project, env }, ["gh", "clone", "repo"]);

    assert.equal(resolution.command.join(" "), "gh");
    assert.equal(resolution.script, path.join(project, ".cli", "gh", "script.js"));
    assert.deepEqual(resolution.argv, ["clone", "repo"]);
    assert.deepEqual(resolution.shadows, [path.join(globalRoot, "gh", "clone", "script.js")]);
  });
});

test("script remains a valid command path segment and -- forwards remaining args", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "foo", "script", "script.js"));

    const resolution = await resolveCommand({ cwd: project, env }, ["foo", "script", "--", "--flag"]);

    assert.equal(resolution.command.join(" "), "foo script");
    assert.deepEqual(resolution.argv, ["--flag"]);
  });
});

test("ambiguous script directories fail with the conflicting files", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "dupe", "script.js"));
    await writeScript(path.join(project, ".cli", "dupe", "script.ts"));

    await assert.rejects(
      resolveCommand({ cwd: project, env }, ["dupe"]),
      (error) => error instanceof CliError && error.code === "AMBIGUOUS_SCRIPT" && error.files.length === 2
    );
  });
});

test("CLI executes .js, .mjs, .ts, and .mts scripts with env and argv", async () => {
  await withFixture(async ({ project, env }) => {
    for (const extension of ["js", "mjs", "ts", "mts"]) {
      await writeScript(
        path.join(project, ".cli", extension, `script.${extension}`),
        [
          "// cli: smoke",
          "console.log(JSON.stringify({",
          "  command: process.env.CLI_COMMAND,",
          "  scope: process.env.CLI_SCOPE,",
          "  cwd: process.cwd(),",
          "  argv: process.argv.slice(2)",
          "}));"
        ].join("\n")
      );

      const result = spawnCli([extension, "one", "--", "two"], { cwd: project, env });
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.command, extension);
      assert.equal(payload.scope, "local");
      assert.equal(payload.cwd, await realpath(project));
      assert.deepEqual(payload.argv, ["one", "two"]);
    }
  });
});

test("--list --json and --which expose selected and shadowed layers", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(project, ".cli", "gh", "script.js"), "// cli: local gh\n");
    await writeScript(path.join(globalRoot, "gh", "clone", "script.js"), "// cli: global clone\n");

    const list = spawnCli(["--list", "--json"], { cwd: project, env });
    assert.equal(list.status, 0, list.stderr);
    const payload = JSON.parse(list.stdout);
    assert.equal(payload.version, 1);
    assert.ok(payload.commands.some((command) => command.command === "gh" && command.shadows.length === 1));
    assert.ok(payload.commands.some((command) => command.command === "gh clone" && command.shadowed === true));

    const which = spawnCli(["--which", "gh", "clone"], { cwd: project, env });
    assert.equal(which.status, 0, which.stderr);
    assert.match(which.stdout, /command: gh/);
    assert.match(which.stdout, /shadows:/);
  });
});

test("--new creates script.ts under the nearest local overlay and rejects unsafe segments", async () => {
  await withFixture(async ({ project, cwd, env }) => {
    await mkdir(path.join(project, ".cli"), { recursive: true });

    const result = spawnCli(["--new", "ops", "deploy"], { cwd, env });
    assert.equal(result.status, 0, result.stderr);
    assert.ok((await stat(path.join(project, ".cli", "ops", "deploy", "script.ts"))).isFile());

    const rejected = spawnCli(["--new", "_private"], { cwd, env });
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /Unsafe command path segment/);
  });
});

test("--mv moves command directories and warns about escaping imports", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(project, ".cli", "ops", "deploy", "script.js"), "import x from \"../lib.js\";\nconsole.log(x);\n");

    const result = spawnCli(["--mv", "ops", "deploy", "--to", "root"], { cwd: project, env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /warning: script\.js imports through/);
    assert.ok((await stat(path.join(globalRoot, "ops", "deploy", "script.js"))).isFile());

    await writeScript(path.join(globalRoot, "ops", "rollback", "script.js"));
    const local = await moveCommand({ cwd: project, env, to: "local" }, ["ops", "rollback"]);
    assert.equal(local.to, path.join(project, ".cli", "ops", "rollback"));
    await assert.rejects(stat(path.join(globalRoot, "ops", "rollback", "script.js")), { code: "ENOENT" });
  });
});

test("--cp copies command directories without removing the source", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(globalRoot, "ops", "seed", "script.js"), "import x from \"../lib.js\";\nconsole.log(x);\n");

    const result = spawnCli(["--cp", "ops", "seed", "--to", "local"], { cwd: project, env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /copied /);
    assert.match(result.stderr, /warning: script\.js imports through/);
    assert.ok((await stat(path.join(globalRoot, "ops", "seed", "script.js"))).isFile());
    assert.ok((await stat(path.join(project, ".cli", "ops", "seed", "script.js"))).isFile());

    await writeScript(path.join(project, ".cli", "ops", "promote", "script.js"));
    const promoted = await copyCommand({ cwd: project, env, to: "root" }, ["ops", "promote"]);
    assert.equal(promoted.to, path.join(globalRoot, "ops", "promote"));
    assert.ok((await stat(path.join(project, ".cli", "ops", "promote", "script.js"))).isFile());
  });
});

async function withFixture(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "async-cli-")));
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
