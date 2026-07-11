import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/cli.js");

test("--doctor reports problems and exits nonzero on errors", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "dupe", "script.js"));
    await writeScript(path.join(project, ".cli", "dupe", "script.ts"));
    await writeScript(path.join(project, ".cli", "escapee", "script.js"), "import x from \"../lib.js\";\nconsole.log(x);\n");
    await writeScript(path.join(project, ".cli", "quiet", "script.js"), "console.log('no description');\n");
    await mkdir(path.join(project, ".cli", "hollow"), { recursive: true });

    const result = spawnCli(["--doctor"], { cwd: project, env });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /ambiguous-script/);

    const json = spawnCli(["--doctor", "--json"], { cwd: project, env });
    assert.equal(json.status, 1);
    const report = JSON.parse(json.stdout);
    const codes = report.problems.map((problem) => problem.code);
    assert.ok(codes.includes("ambiguous-script"));
    assert.ok(codes.includes("escaping-import"));
    assert.ok(codes.includes("missing-description"));
    assert.ok(codes.includes("untrusted-overlay"));
    assert.ok(codes.includes("agents-missing"));
    assert.ok(report.summary.errors >= 1);
  });
});

test("--doctor flags empty command directories and agents drift", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "fine", "script.js"), "// cli: fine\nconsole.log('fine');\n");
    await mkdir(path.join(project, ".cli", "hollow"), { recursive: true });
    await writeFile(
      path.join(project, "AGENTS.md"),
      "<!-- async-cli:begin -->\nstale\n<!-- async-cli:end -->\n",
      "utf8"
    );

    const json = spawnCli(["--doctor", "--json"], { cwd: project, env });
    const report = JSON.parse(json.stdout);
    const codes = report.problems.map((problem) => problem.code);
    assert.ok(codes.includes("empty-command-dir"));
    assert.ok(codes.includes("agents-drift"));
  });
});

test("--doctor is clean on a healthy trusted tree", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "fine", "script.js"), "// cli: fine\nconsole.log('fine');\n");
    assert.equal(spawnCli(["--trust"], { cwd: project, env }).status, 0);
    assert.equal(spawnCli(["--agents", "--write"], { cwd: project, env }).status, 0);
    assert.equal(spawnCli(["--trust"], { cwd: project, env }).status, 0);

    const result = spawnCli(["--doctor", "--json"], { cwd: project, env });
    assert.equal(result.status, 0, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  });
});

test("--doctor keeps AGENTS checks at the git context for nested overlays", async () => {
  await withFixture(async ({ project, env }) => {
    const cwd = path.join(project, "packages", "app");
    await writeScript(path.join(cwd, ".cli", "fine", "script.js"), "// cli: fine\nconsole.log('fine');\n");
    assert.equal(spawnCli(["--trust"], { cwd, env }).status, 0);
    assert.equal(spawnCli(["--agents", "--write"], { cwd, env }).status, 0);

    const result = spawnCli(["--doctor", "--json"], { cwd, env });
    assert.equal(result.status, 0, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.ok(!report.problems.some((problem) => problem.code === "agents-missing"));
  });
});

async function withFixture(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "async-cli-doctor-")));
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
