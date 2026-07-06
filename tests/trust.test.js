import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/cli.js");

test("untrusted local overlays refuse to run and cli --trust unlocks them", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "deploy", "script.js"), "console.log('deployed');\n");

    const refused = spawnCli(["deploy"], { cwd: project, env });
    assert.equal(refused.status, 3, refused.stdout);
    assert.match(refused.stderr, /not trusted/);
    assert.match(refused.stderr, /cli --trust/);

    const trust = spawnCli(["--trust"], { cwd: project, env });
    assert.equal(trust.status, 0, trust.stderr);
    assert.match(trust.stdout, /trusted .*\.cli/);

    const allowed = spawnCli(["deploy"], { cwd: project, env });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(allowed.stdout, /deployed/);
  });
});

test("changed overlays are refused until re-trusted", async () => {
  await withFixture(async ({ project, env }) => {
    const script = path.join(project, ".cli", "deploy", "script.js");
    await writeScript(script, "console.log('v1');\n");
    assert.equal(spawnCli(["--trust"], { cwd: project, env }).status, 0);
    assert.equal(spawnCli(["deploy"], { cwd: project, env }).status, 0);

    await writeFile(script, "console.log('v2');\n", "utf8");
    const refused = spawnCli(["deploy"], { cwd: project, env });
    assert.equal(refused.status, 3);
    assert.match(refused.stderr, /changed since it was trusted/);

    assert.equal(spawnCli(["--trust"], { cwd: project, env }).status, 0);
    assert.equal(spawnCli(["deploy"], { cwd: project, env }).status, 0);
  });
});

test("--trust --status reports overlay states and --untrust removes trust", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "deploy", "script.js"));

    let status = spawnCli(["--trust", "--status"], { cwd: project, env });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /untrusted .*\.cli/);
    assert.match(status.stdout, /user-global root/);

    assert.equal(spawnCli(["--trust"], { cwd: project, env }).status, 0);
    status = spawnCli(["--trust", "--status"], { cwd: project, env });
    assert.match(status.stdout, /^trusted /m);

    const untrust = spawnCli(["--untrust"], { cwd: project, env });
    assert.equal(untrust.status, 0);
    assert.match(untrust.stdout, /untrusted /);
    assert.equal(spawnCli(["deploy"], { cwd: project, env }).status, 3);
  });
});

test("global root commands never require trust", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(globalRoot, "hello", "script.js"), "console.log('global ok');\n");

    const result = spawnCli(["hello"], { cwd: project, env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /global ok/);
  });
});

test("ASYNC_CLI_TRUST=off disables enforcement", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "deploy", "script.js"), "console.log('yolo');\n");

    const result = spawnCli(["deploy"], { cwd: project, env: { ...env, ASYNC_CLI_TRUST: "off" } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /yolo/);
  });
});

test("--new auto-trusts a freshly created overlay", async () => {
  await withFixture(async ({ project, env }) => {
    const created = spawnCli(["--new", "greet"], { cwd: project, env });
    assert.equal(created.status, 0, created.stderr);

    const run = spawnCli(["greet"], { cwd: project, env });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /greet command/);

    const store = JSON.parse(await readFile(path.join(env.ASYNC_CLI_GLOBAL_ROOT, ".trust.json"), "utf8"));
    assert.ok(Object.keys(store.overlays).includes(path.join(project, ".cli")));
  });
});

test("--new inside an untrusted pre-existing overlay leaves it untrusted", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "existing", "script.js"));

    const created = spawnCli(["--new", "greet"], { cwd: project, env });
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stderr, /remains untrusted/);
    assert.equal(spawnCli(["greet"], { cwd: project, env }).status, 3);
  });
});

test("--mv refreshes the trusted source overlay so it keeps working", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(path.join(project, ".cli", "keep", "script.js"), "console.log('kept');\n");
    await writeScript(path.join(project, ".cli", "promote", "script.js"));
    assert.equal(spawnCli(["--trust"], { cwd: project, env }).status, 0);

    const moved = spawnCli(["--mv", "promote"], { cwd: project, env });
    assert.equal(moved.status, 0, moved.stderr);
    assert.ok((await readFile(path.join(globalRoot, "promote", "script.js"), "utf8")).length > 0);

    const kept = spawnCli(["keep"], { cwd: project, env });
    assert.equal(kept.status, 0, kept.stderr);
    assert.match(kept.stdout, /kept/);
  });
});

async function withFixture(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "async-cli-trust-")));
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
