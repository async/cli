import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve("scripts/local-link.js");
const target = path.resolve("dist/cli.js");

test("local link script links both binaries to the checkout build", async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), "async-cli-local-link-"));

  try {
    const link = runLocalLink(["link", "--bin-dir", binDir]);
    assert.equal(link.status, 0, link.stderr);

    for (const name of ["cli", "async-cli"]) {
      const linkPath = path.join(binDir, name);
      const info = await lstat(linkPath);
      assert.equal(info.isSymbolicLink(), true);
      assert.equal(path.resolve(binDir, await readlink(linkPath)), target);
    }

    const cli = spawnSync(path.join(binDir, "cli"), ["--version"], {
      encoding: "utf8"
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), "0.1.1");

    const status = runLocalLink(["status", "--bin-dir", binDir, "--json"]);
    assert.equal(status.status, 0, status.stderr);
    const parsed = JSON.parse(status.stdout);
    assert.deepEqual(parsed.links.map((linkRecord) => linkRecord.status), ["managed", "managed"]);

    const unlink = runLocalLink(["unlink", "--bin-dir", binDir]);
    assert.equal(unlink.status, 0, unlink.stderr);
    for (const name of ["cli", "async-cli"]) {
      await assert.rejects(lstat(path.join(binDir, name)), { code: "ENOENT" });
    }
  } finally {
    await rm(binDir, { force: true, recursive: true });
  }
});

test("local link script refuses to replace external files without force", async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), "async-cli-local-link-"));

  try {
    const cliPath = path.join(binDir, "cli");
    await writeFile(cliPath, "#!/bin/sh\nexit 0\n");

    const result = runLocalLink(["link", "--bin-dir", binDir]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not managed by this checkout/);
    assert.equal(await readFile(cliPath, "utf8"), "#!/bin/sh\nexit 0\n");
  } finally {
    await rm(binDir, { force: true, recursive: true });
  }
});

function runLocalLink(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8"
  });
}
