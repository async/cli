import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { packageInfo, renderHelp } from "../dist/index.js";

test("package metadata defines the @async/cli scaffold", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.name, "@async/cli");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines.node, ">=24");
  assert.equal(packageJson.bin.cli, "dist/cli.js");
  assert.equal(packageJson.bin["async-cli"], "dist/cli.js");
  assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), []);
});

test("root import is metadata-only", () => {
  assert.equal(packageInfo.name, "@async/cli");
  assert.equal(packageInfo.node, ">=24");
  assert.equal(packageInfo.routerStatus, "implemented");
  assert.equal(packageInfo.contextPointerStatus, "implemented");
});

test("help states the router surface", () => {
  const help = renderHelp();

  assert.match(help, /cli <command\.\.\.> \[args\.\.\.\]/);
  assert.match(help, /cli --list \[--json\]/);
  assert.match(help, /cli --cp <command\.\.\.> \[--to root\|local\]/);
  assert.match(help, /cli --agents \[--write\|--check\] \[--claude\]/);
});

test("cli --version prints the package version", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--version"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.1.1");
});
