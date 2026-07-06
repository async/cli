import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { packageInfo } from "./package-info.js";
import { buildScriptEnv, listCommands, resolveCommand, resolveScriptCwd } from "./router.js";
import { isTrustEnforced, overlayTrustState } from "./trust.js";
const protocolVersion = "2025-06-18";
const maxOutputBytes = 1024 * 1024;
export async function runMcpServer(options = {}, io = { input: process.stdin, output: process.stdout }) {
    const lines = createInterface({ input: io.input, crlfDelay: Infinity });
    for await (const line of lines) {
        const text = line.trim();
        if (text.length === 0) {
            continue;
        }
        let message;
        try {
            message = JSON.parse(text);
        }
        catch {
            writeMessage(io, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
            continue;
        }
        const response = await handleMessage(options, message);
        if (response !== null) {
            writeMessage(io, response);
        }
    }
    return 0;
}
async function handleMessage(options, message) {
    const { id, method, params } = message;
    const isNotification = id === undefined;
    try {
        if (method === "initialize") {
            const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : protocolVersion;
            return result(id, {
                protocolVersion: requested,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: packageInfo.name, version: packageInfo.version }
            });
        }
        if (method === "ping") {
            return result(id, {});
        }
        if (method === "tools/list") {
            const tools = await collectTools(options);
            return result(id, { tools: tools.map((tool) => tool.tool) });
        }
        if (method === "tools/call") {
            const name = typeof params?.name === "string" ? params.name : "";
            const args = extractArgs(params);
            const tools = await collectTools(options);
            const match = tools.find((tool) => tool.tool.name === name);
            if (!match) {
                return error(id, -32602, `Unknown tool: ${name}`);
            }
            const outcome = await callCommand(options, match.command, args);
            return result(id, outcome);
        }
        if (isNotification) {
            return null;
        }
        return error(id, -32601, `Method not found: ${method ?? "(none)"}`);
    }
    catch (cause) {
        if (isNotification) {
            return null;
        }
        return error(id, -32603, cause instanceof Error ? cause.message : String(cause));
    }
}
async function collectTools(options) {
    const env = options.env ?? process.env;
    const listing = await listCommands(options);
    const trustedOverlays = new Map();
    const tools = [];
    const usedNames = new Set();
    for (const entry of listing.commands) {
        if (entry.shadowed || entry.command.length === 0) {
            continue;
        }
        if (entry.scope === "local" && isTrustEnforced(env)) {
            const root = listing.roots.find((candidate) => entry.script.startsWith(candidate.path + path.sep));
            if (!root) {
                continue;
            }
            if (!trustedOverlays.has(root.path)) {
                trustedOverlays.set(root.path, await overlayTrustState(options, root.path) === "trusted");
            }
            if (!trustedOverlays.get(root.path)) {
                continue;
            }
        }
        const command = entry.command.split(" ");
        const name = uniqueToolName(command, usedNames);
        tools.push({
            command,
            tool: {
                name,
                description: entry.description
                    ? `${entry.description} (cli ${entry.command})`
                    : `Run "cli ${entry.command}"`,
                inputSchema: {
                    type: "object",
                    properties: {
                        args: {
                            type: "array",
                            items: { type: "string" },
                            description: "Arguments forwarded to the command script"
                        }
                    },
                    additionalProperties: false
                }
            }
        });
    }
    return tools;
}
async function callCommand(options, command, args) {
    let resolution;
    try {
        resolution = await resolveCommand(options, [...command, "--", ...args]);
    }
    catch (cause) {
        return toolError(cause instanceof Error ? cause.message : String(cause));
    }
    const callerCwd = path.resolve(options.cwd ?? process.cwd());
    const cwd = await resolveScriptCwd(resolution, callerCwd);
    const env = buildScriptEnv(resolution, callerCwd, { ...process.env, ...(options.env ?? {}) });
    return await new Promise((resolve) => {
        const child = spawn(process.execPath, [resolution.script, ...resolution.argv], {
            cwd,
            env,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            if (stdout.length < maxOutputBytes) {
                stdout += chunk.toString("utf8");
            }
        });
        child.stderr.on("data", (chunk) => {
            if (stderr.length < maxOutputBytes) {
                stderr += chunk.toString("utf8");
            }
        });
        child.once("error", (cause) => {
            resolve(toolError(cause.message));
        });
        child.once("exit", (code) => {
            const exitCode = typeof code === "number" ? code : 1;
            const text = [stdout, stderr.length > 0 ? `stderr:\n${stderr}` : ""].filter(Boolean).join("\n").trim();
            resolve({
                content: [{ type: "text", text: text.length > 0 ? text : `(exit ${exitCode})` }],
                isError: exitCode !== 0
            });
        });
    });
}
function toolError(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
function uniqueToolName(command, used) {
    const base = command
        .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, "-"))
        .join("__")
        .slice(0, 96) || "command";
    let name = base;
    let counter = 2;
    while (used.has(name)) {
        name = `${base}-${counter}`;
        counter += 1;
    }
    used.add(name);
    return name;
}
function extractArgs(params) {
    const raw = params?.arguments;
    if (typeof raw !== "object" || raw === null) {
        return [];
    }
    const args = raw.args;
    if (!Array.isArray(args)) {
        return [];
    }
    return args.map((value) => String(value));
}
function result(id, payload) {
    return { jsonrpc: "2.0", id: id ?? null, result: payload };
}
function error(id, code, message) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function writeMessage(io, message) {
    io.output.write(`${JSON.stringify(message)}\n`);
}
//# sourceMappingURL=mcp.js.map