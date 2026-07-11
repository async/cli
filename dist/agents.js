import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliError } from "./router.js";
export const managedAgentsBlock = [
    "<!-- async-cli:begin -->",
    "## Project commands (async/cli)",
    "This repo defines runnable commands under `.cli/` (plus user-global `~/.cli`),",
    "executed via the `cli` binary from `@async/cli`.",
    "- Discover: `cli --list --json` (commands, descriptions, script paths)",
    "- Inspect:  `cli --which <words...>`",
    "- Run:      `cli <words...> [args...]` (e.g. `cli gh pull 123`)",
    "Prefer a matching `.cli` command over improvising the same task.",
    "<!-- async-cli:end -->",
    ""
].join("\n");
const blockPattern = /<!-- async-cli:begin -->[\s\S]*?<!-- async-cli:end -->\n?/;
export async function handleAgentsCommand(args, io, options = {}) {
    const parsed = parseAgentsArgs(args);
    const target = await resolveContextTarget(parsed.claude, options);
    if (parsed.mode === "print") {
        io.stdout.write(managedAgentsBlock);
        return 0;
    }
    if (parsed.mode === "write") {
        const current = await readOptional(target);
        const next = upsertManagedBlock(current);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, next, "utf8");
        io.stdout.write(`updated ${path.basename(target)}\n`);
        return 0;
    }
    const current = await readOptional(target);
    if (hasCurrentManagedBlock(current)) {
        io.stdout.write(`${path.basename(target)} is current\n`);
        return 0;
    }
    const writeHint = parsed.claude
        ? "cli --agents --claude --write"
        : "cli --agents --write";
    io.stderr.write(`${path.basename(target)} is missing or has an outdated async-cli block. Run ${writeHint}.\n`);
    return 1;
}
function parseAgentsArgs(args) {
    let mode = "print";
    let claude = false;
    for (const arg of args) {
        if (arg === "--write") {
            if (mode === "check") {
                throw new CliError("UNSAFE_SEGMENT", "--agents --write and --check cannot be combined.");
            }
            mode = "write";
        }
        else if (arg === "--check") {
            if (mode === "write") {
                throw new CliError("UNSAFE_SEGMENT", "--agents --write and --check cannot be combined.");
            }
            mode = "check";
        }
        else if (arg === "--claude") {
            claude = true;
        }
        else {
            throw new CliError("UNSAFE_SEGMENT", `Unsupported --agents option: ${arg}`);
        }
    }
    return { mode, claude };
}
async function resolveContextTarget(claude, options) {
    const root = await findContextRoot(options);
    if (!root) {
        throw new CliError("MISSING_GIT_ROOT", "No Git root found for the selected context file.");
    }
    const file = claude ? "CLAUDE.md" : "AGENTS.md";
    return path.join(root, file);
}
export async function findContextRoot(options = {}) {
    const env = options.env ?? process.env;
    if (env.ASYNC_CLI_PROJECT_ROOT) {
        return path.resolve(env.ASYNC_CLI_PROJECT_ROOT);
    }
    let current = path.resolve(options.cwd ?? process.cwd());
    const home = path.resolve(env.HOME ?? os.homedir());
    while (true) {
        if (await exists(path.join(current, ".git"))) {
            return current;
        }
        if (current === home || current === path.dirname(current)) {
            return null;
        }
        current = path.dirname(current);
    }
}
function upsertManagedBlock(current) {
    const normalized = current.endsWith("\n") || current.length === 0 ? current : `${current}\n`;
    if (blockPattern.test(normalized)) {
        return normalized.replace(blockPattern, managedAgentsBlock);
    }
    return normalized.length === 0 ? managedAgentsBlock : `${normalized}\n${managedAgentsBlock}`;
}
function hasCurrentManagedBlock(current) {
    return current.includes(managedAgentsBlock.trim());
}
async function readOptional(file) {
    try {
        return await readFile(file, "utf8");
    }
    catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return "";
        }
        throw error;
    }
}
async function exists(candidate) {
    try {
        await access(candidate);
        return true;
    }
    catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
//# sourceMappingURL=agents.js.map