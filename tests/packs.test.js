import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/cli.js");

test("--add installs a pack's command directories into the user-global tree", async () => {
  await withFixture(async ({ root, project, globalRoot, env }) => {
    const pack = await makePack(root, {
      "greet/script.js": "// cli: Greet\nconsole.log('hello from pack');\n",
      "tools/x/script.js": "console.log('x');\n"
    });

    const added = spawnCli(["--add", pack], { cwd: project, env });
    assert.equal(added.status, 0, added.stderr);
    assert.match(added.stdout, /installed greet, tools -> /);
    assert.ok((await stat(path.join(globalRoot, "greet", "script.js"))).isFile());
    assert.ok((await stat(path.join(globalRoot, "tools", "x", "script.js"))).isFile());

    const run = spawnCli(["greet"], { cwd: project, env });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /hello from pack/);
  });
});

test("--add refuses conflicts unless --force", async () => {
  await withFixture(async ({ root, project, globalRoot, env }) => {
    const pack = await makePack(root, { "greet/script.js": "console.log('v2');\n" });
    await writeScript(path.join(globalRoot, "greet", "script.js"), "console.log('v1');\n");

    const refused = spawnCli(["--add", pack], { cwd: project, env });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /Refusing to overwrite/);

    const forced = spawnCli(["--add", pack, "--force"], { cwd: project, env });
    assert.equal(forced.status, 0, forced.stderr);
    const run = spawnCli(["greet"], { cwd: project, env });
    assert.match(run.stdout, /v2/);
  });
});

test("--add --prefix installs the whole pack under one namespace", async () => {
  await withFixture(async ({ root, project, globalRoot, env }) => {
    const pack = await makePack(root, { "greet/script.js": "console.log('namespaced');\n" });

    const added = spawnCli(["--add", pack, "--prefix", "vendor"], { cwd: project, env });
    assert.equal(added.status, 0, added.stderr);
    assert.ok((await stat(path.join(globalRoot, "vendor", "greet", "script.js"))).isFile());

    const run = spawnCli(["vendor", "greet"], { cwd: project, env });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /namespaced/);
  });
});

test("--add --to local installs into the project overlay and trusts it", async () => {
  await withFixture(async ({ root, project, env }) => {
    const pack = await makePack(root, { "greet/script.js": "console.log('local pack');\n" });
    await rm(path.join(project, ".git"), { recursive: true, force: true });

    const added = spawnCli(["--add", pack, "--to", "local"], { cwd: project, env });
    assert.equal(added.status, 0, added.stderr);
    assert.ok((await stat(path.join(project, ".cli", "greet", "script.js"))).isFile());

    const run = spawnCli(["greet"], { cwd: project, env });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /local pack/);
  });
});

test("--add rejects repositories without a .cli directory", async () => {
  await withFixture(async ({ root, project, env }) => {
    const source = path.join(root, "not-a-pack");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "README.md"), "no commands here\n", "utf8");
    gitInit(source);

    const result = spawnCli(["--add", source], { cwd: project, env });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no \.cli\/ directory/);
  });
});

async function makePack(root, files) {
  const source = path.join(root, `pack-${Math.random().toString(36).slice(2, 8)}`);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(source, ".cli", relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
  gitInit(source);
  return source;
}

function gitInit(directory) {
  const runGit = (...args) => {
    const result = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  runGit("init", "-q");
  runGit("add", "-A");
  runGit("-c", "user.email=pack@test.invalid", "-c", "user.name=pack", "commit", "-qm", "pack");
}

async function withFixture(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "async-cli-pack-test-")));
  const home = path.join(root, "home");
  const project = path.join(home, "repo");
  const globalRoot = path.join(root, "global-cli");
  const env = {
    ...process.env,
    ASYNC_CLI_GLOBAL_ROOT: globalRoot
  };
  delete env.ASYNC_CLI_TRUST;

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
