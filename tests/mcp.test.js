import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliPath = path.resolve("dist/cli.js");

test("--mcp serves initialize, tools/list, and tools/call", async () => {
  await withFixture(async ({ project, globalRoot, env }) => {
    await writeScript(
      path.join(globalRoot, "hello", "script.js"),
      "// cli: Say hello\nconsole.log(`hello ${process.argv[2] ?? \"world\"}`);\n"
    );
    await writeScript(path.join(globalRoot, "fail", "script.js"), "console.error('boom');\nprocess.exit(2);\n");
    await writeScript(path.join(project, ".cli", "secret", "script.js"), "console.log('local');\n");

    const session = startMcp({ cwd: project, env });
    try {
      session.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      const init = await session.next();
      assert.equal(init.id, 1);
      assert.equal(init.result.serverInfo.name, "@async/cli");
      assert.equal(init.result.protocolVersion, "2025-06-18");

      session.send({ jsonrpc: "2.0", method: "notifications/initialized" });

      session.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const list = await session.next();
      const names = list.result.tools.map((tool) => tool.name);
      assert.ok(names.includes("hello"));
      assert.ok(names.includes("fail"));
      assert.ok(!names.includes("secret"), `untrusted local command listed: ${names.join(", ")}`);
      const hello = list.result.tools.find((tool) => tool.name === "hello");
      assert.match(hello.description, /Say hello/);
      assert.equal(hello.inputSchema.type, "object");

      session.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hello", arguments: { args: ["mcp"] } } });
      const call = await session.next();
      assert.equal(call.result.isError, false);
      assert.match(call.result.content[0].text, /hello mcp/);

      session.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "fail", arguments: {} } });
      const failed = await session.next();
      assert.equal(failed.result.isError, true);
      assert.match(failed.result.content[0].text, /boom/);

      session.send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope", arguments: {} } });
      const unknown = await session.next();
      assert.equal(unknown.error.code, -32602);
    } finally {
      await session.close();
    }
  });
});

test("--mcp lists trusted local commands", async () => {
  await withFixture(async ({ project, env }) => {
    await writeScript(path.join(project, ".cli", "gh", "pull", "script.js"), "// cli: Pull\nconsole.log('pulled');\n");
    assert.equal(spawnSync(process.execPath, [cliPath, "--trust"], { cwd: project, env, encoding: "utf8" }).status, 0);

    const session = startMcp({ cwd: project, env });
    try {
      session.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
      await session.next();
      session.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const list = await session.next();
      const names = list.result.tools.map((tool) => tool.name);
      assert.ok(names.includes("gh__pull"), names.join(", "));
    } finally {
      await session.close();
    }
  });
});

test("--mcp refuses a trusted local command after its symlink target changes", async () => {
  await withFixture(async ({ root, project, env }) => {
    const target = path.join(root, "linked-target.js");
    const script = path.join(project, ".cli", "linked", "script.js");
    await writeFile(target, "console.log('v1');\n", "utf8");
    await mkdir(path.dirname(script), { recursive: true });
    await symlink(target, script);
    assert.equal(spawnSync(process.execPath, [cliPath, "--trust"], { cwd: project, env, encoding: "utf8" }).status, 0);

    const session = startMcp({ cwd: project, env });
    try {
      session.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
      await session.next();
      session.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const list = await session.next();
      assert.ok(list.result.tools.some((tool) => tool.name === "linked"));

      await writeFile(target, "console.log('v2');\n", "utf8");
      session.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "linked", arguments: {} } });
      const call = await session.next();
      assert.equal(call.error.code, -32602);
      assert.match(call.error.message, /Unknown tool/);
    } finally {
      await session.close();
    }
  });
});

function startMcp({ cwd, env }) {
  const child = spawn(process.execPath, [cliPath, "--mcp"], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pending = [];
  const waiting = [];
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  reader.on("line", (line) => {
    if (line.trim().length === 0) {
      return;
    }
    const message = JSON.parse(line);
    const waiter = waiting.shift();
    if (waiter) {
      waiter(message);
    } else {
      pending.push(message);
    }
  });

  return {
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    next(timeoutMs = 10000) {
      if (pending.length > 0) {
        return Promise.resolve(pending.shift());
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for MCP response")), timeoutMs);
        waiting.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    async close() {
      child.stdin.end();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  };
}

async function withFixture(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "async-cli-mcp-")));
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
