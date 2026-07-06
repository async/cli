import { spawn } from "node:child_process";
import { constants as fsConstants, statSync } from "node:fs";
import { access, cp, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";
export { CliError } from "./errors.js";
const scriptFiles = ["script.ts", "script.mts", "script.js", "script.mjs"];
const ignoredNames = new Set(["help", "lib", "node_modules"]);
export async function discoverRoots(options = {}) {
    const env = options.env ?? process.env;
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const home = path.resolve(options.home ?? env.HOME ?? os.homedir());
    const globalRoot = path.resolve(env.ASYNC_CLI_GLOBAL_ROOT ?? path.join(home, ".cli"));
    const projectRoot = env.ASYNC_CLI_PROJECT_ROOT
        ? path.resolve(env.ASYNC_CLI_PROJECT_ROOT)
        : await findNearestGitRoot(cwd, home);
    const roots = [];
    const localDirs = projectRoot
        ? directoriesFromCwdToRoot(cwd, projectRoot)
        : directoriesUntilHomeOrRoot(cwd, home);
    for (const directory of localDirs) {
        const candidate = path.join(directory, ".cli");
        if (candidate !== globalRoot && await isDirectory(candidate)) {
            roots.push({ path: candidate, scope: "local", projectRoot });
        }
    }
    roots.push({ path: globalRoot, scope: "root", projectRoot });
    return dedupeRoots(roots);
}
export async function resolveCommand(options = {}, args) {
    const parsed = parseCommandArgs(args);
    if (parsed.command.length === 0) {
        throw new CliError("UNKNOWN_COMMAND", "No command provided.");
    }
    validateCommandPath(parsed.command);
    const roots = await discoverRoots(options);
    const candidates = await collectCandidates(roots);
    for (const root of roots) {
        const match = await findLongestExistingPrefix(root, parsed.command);
        if (!match) {
            continue;
        }
        const candidate = await findLongestRunnablePrefix(root, parsed.command);
        if (candidate) {
            return {
                command: candidate.command,
                script: candidate.script,
                argv: [...parsed.command.slice(candidate.command.length), ...parsed.forwarded],
                root,
                shadows: candidates
                    .filter((other) => other.script !== candidate.script)
                    .filter((other) => isShadowedBy(candidate, other))
                    .map((other) => other.script)
            };
        }
        const subcommands = await listSubcommands(match.directory, match.prefix);
        throw new CliError(subcommands.length > 0 ? "PARTIAL_NAMESPACE" : "UNKNOWN_COMMAND", subcommands.length > 0
            ? `${match.prefix.join(" ")} is a command namespace, not a runnable command.`
            : `Unknown command: ${parsed.command.join(" ")}`, { subcommands });
    }
    throw new CliError("UNKNOWN_COMMAND", `Unknown command: ${parsed.command.join(" ")}`, {
        suggestions: nearestSuggestions(parsed.command.join(" "), candidates)
    });
}
export async function listCommands(options = {}) {
    const roots = await discoverRoots(options);
    const candidates = await collectCandidates(roots);
    const shadowedScripts = new Set();
    const shadowMap = new Map();
    for (const candidate of candidates) {
        const selected = await tryResolve(options, candidate.command);
        if (selected && selected.script !== candidate.script) {
            shadowedScripts.add(candidate.script);
            shadowMap.set(selected.script, [...(shadowMap.get(selected.script) ?? []), candidate.script]);
        }
    }
    const commands = candidates.map((candidate) => ({
        command: candidate.command.join(" "),
        script: candidate.script,
        scope: candidate.root.scope,
        description: candidate.description,
        shadowed: shadowedScripts.has(candidate.script),
        shadows: shadowMap.get(candidate.script) ?? []
    }));
    return {
        version: 1,
        roots,
        commands: commands.sort((a, b) => a.command.localeCompare(b.command) || a.script.localeCompare(b.script))
    };
}
export async function createCommand(options = {}, commandPath) {
    validateCommandPath(commandPath);
    const roots = await discoverRoots(options);
    const targetRoot = await selectCreateRoot(options, roots);
    const directory = path.join(targetRoot.path, ...commandPath);
    if (await pathExists(directory)) {
        throw new CliError("TARGET_EXISTS", `Command directory already exists: ${directory}`);
    }
    if (options.template) {
        const template = await findTemplate(roots, options.template);
        await mkdir(path.dirname(directory), { recursive: true });
        await cp(template, directory, { recursive: true, errorOnExist: true, force: false });
        const script = await findRunnableScript(directory);
        if (!script) {
            await rm(directory, { recursive: true, force: true });
            throw new CliError("TEMPLATE_INVALID", `Template has no script.{ts,mts,js,mjs}: ${template}`);
        }
        return { command: commandPath, directory, script, root: targetRoot };
    }
    const script = path.join(directory, "script.ts");
    await mkdir(directory, { recursive: true });
    await writeFile(script, scaffoldScript(commandPath), "utf8");
    return { command: commandPath, directory, script, root: targetRoot };
}
export async function removeCommand(options = {}, commandPath) {
    validateCommandPath(commandPath);
    const roots = await discoverRoots(options);
    const searched = options.root === "root"
        ? roots.filter((root) => root.scope === "root")
        : roots.filter((root) => root.scope === "local");
    const targetRoot = searched.find((root) => pathExistsSync(path.join(root.path, ...commandPath)));
    if (!targetRoot) {
        throw new CliError("SOURCE_NOT_FOUND", `No ${options.root === "root" ? "root" : "local"} command directory found for ${commandPath.join(" ")}.`);
    }
    const directory = path.join(targetRoot.path, ...commandPath);
    if (!await isDirectory(directory)) {
        throw new CliError("SOURCE_NOT_FOUND", `Command directory not found: ${directory}`);
    }
    const nested = await nestedRunnableScripts(directory);
    if (nested.length > 0 && !options.force) {
        throw new CliError("TARGET_EXISTS", `Command directory contains nested commands: ${directory}. Re-run with --force to remove them.`, { files: nested });
    }
    await rm(directory, { recursive: true, force: true });
    await removeEmptyParents(path.dirname(directory), targetRoot.path);
    return { command: commandPath, directory, root: targetRoot, nested };
}
export async function resolveScopedRoot(options, scope) {
    const roots = await discoverRoots(options);
    if (scope === "root") {
        const globalRoot = roots.find((root) => root.scope === "root");
        if (!globalRoot) {
            throw new CliError("SOURCE_NOT_FOUND", "No root command tree is configured.");
        }
        return globalRoot;
    }
    return await selectLocalRootForMove(options, roots);
}
export async function moveCommand(options = {}, commandPath) {
    validateCommandPath(commandPath);
    const { from, to, sourceRoot } = await resolveTransfer(options, commandPath);
    const warnings = await escapingImportWarnings(from, "move");
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    await removeEmptyParents(path.dirname(from), sourceRoot.path);
    return { command: commandPath, from, to, warnings };
}
export async function copyCommand(options = {}, commandPath) {
    validateCommandPath(commandPath);
    const { from, to } = await resolveTransfer(options, commandPath);
    const warnings = await escapingImportWarnings(from, "copy");
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    return { command: commandPath, from, to, warnings };
}
async function resolveTransfer(options, commandPath) {
    const roots = await discoverRoots(options);
    const target = options.to ?? "root";
    const globalRoot = roots.find((root) => root.scope === "root");
    if (!globalRoot) {
        throw new CliError("SOURCE_NOT_FOUND", "No root command tree is configured.");
    }
    const localRoot = await selectLocalRootForMove(options, roots);
    const sourceRoot = target === "root"
        ? roots.find((root) => root.scope === "local" && pathExistsSync(path.join(root.path, ...commandPath)))
        : globalRoot;
    const destinationRoot = target === "root" ? globalRoot : localRoot;
    if (!sourceRoot) {
        throw new CliError("SOURCE_NOT_FOUND", `No ${target === "root" ? "local" : "root"} command directory found for ${commandPath.join(" ")}.`);
    }
    const from = path.join(sourceRoot.path, ...commandPath);
    const to = path.join(destinationRoot.path, ...commandPath);
    if (!await isDirectory(from)) {
        throw new CliError("SOURCE_NOT_FOUND", `Command directory not found: ${from}`);
    }
    if (await pathExists(to)) {
        throw new CliError("TARGET_EXISTS", `Refusing to overwrite existing command directory: ${to}`);
    }
    return { from, to, sourceRoot };
}
async function collectCandidates(roots) {
    const nested = await Promise.all(roots.map((root) => collectCandidatesForRoot(root, root.path, [])));
    return nested.flat();
}
async function collectCandidatesForRoot(root, directory, command) {
    if (!await isDirectory(directory)) {
        return [];
    }
    const candidates = [];
    const script = await findRunnableScript(directory);
    if (script) {
        candidates.push({
            command,
            directory,
            script,
            root,
            description: await readDescription(script)
        });
    }
    const children = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(children
        .filter((child) => child.isDirectory())
        .filter((child) => !isIgnoredSegment(child.name))
        .map((child) => collectCandidatesForRoot(root, path.join(directory, child.name), [...command, child.name])));
    candidates.push(...nested.flat());
    return candidates;
}
export async function findRunnableScript(directory) {
    const found = [];
    for (const scriptFile of scriptFiles) {
        const candidate = path.join(directory, scriptFile);
        if (await isFile(candidate)) {
            found.push(candidate);
        }
    }
    if (found.length > 1) {
        throw new CliError("AMBIGUOUS_SCRIPT", `Ambiguous command directory: ${directory}`, {
            files: found
        });
    }
    return found[0] ?? null;
}
async function findLongestRunnablePrefix(root, command) {
    for (let length = command.length; length > 0; length -= 1) {
        const prefix = command.slice(0, length);
        const directory = path.join(root.path, ...prefix);
        if (!await isDirectory(directory)) {
            continue;
        }
        const script = await findRunnableScript(directory);
        if (script) {
            return {
                command: prefix,
                directory,
                script,
                root,
                description: await readDescription(script)
            };
        }
    }
    return null;
}
async function findLongestExistingPrefix(root, command) {
    for (let length = command.length; length > 0; length -= 1) {
        const prefix = command.slice(0, length);
        const directory = path.join(root.path, ...prefix);
        if (await isDirectory(directory)) {
            return { root, prefix, directory };
        }
    }
    return null;
}
async function listSubcommands(directory, prefix) {
    const children = await readdir(directory, { withFileTypes: true });
    return children
        .filter((child) => child.isDirectory())
        .filter((child) => !isIgnoredSegment(child.name))
        .map((child) => [...prefix, child.name].join(" "))
        .sort();
}
export async function readDescription(script) {
    const text = await readFile(script, "utf8");
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const match = /^\/\/\s*cli:\s*(.*)$/.exec(firstLine);
    return match?.[1]?.trim() ?? "";
}
function parseCommandArgs(args) {
    const cutoff = args.indexOf("--");
    if (cutoff === -1) {
        return { command: args, forwarded: [] };
    }
    return {
        command: args.slice(0, cutoff),
        forwarded: args.slice(cutoff + 1)
    };
}
function validateCommandPath(commandPath) {
    if (commandPath.length === 0) {
        throw new CliError("UNSAFE_SEGMENT", "Command path is required.");
    }
    for (const segment of commandPath) {
        if (segment.length === 0 ||
            segment === "." ||
            segment === ".." ||
            path.isAbsolute(segment) ||
            segment.includes("/") ||
            segment.includes("\\") ||
            isIgnoredSegment(segment)) {
            throw new CliError("UNSAFE_SEGMENT", `Unsafe command path segment: ${segment}`);
        }
    }
}
function isIgnoredSegment(segment) {
    return ignoredNames.has(segment) || segment.startsWith(".") || segment.startsWith("_");
}
async function selectCreateRoot(options, roots) {
    if (options.root === "root") {
        return roots.find((root) => root.scope === "root") ?? roots[roots.length - 1];
    }
    const existingLocal = roots.find((root) => root.scope === "local");
    if (existingLocal) {
        return existingLocal;
    }
    const projectRoot = await requireProjectRoot(options);
    return { path: path.join(projectRoot, ".cli"), scope: "local", projectRoot };
}
async function selectLocalRootForMove(options, roots) {
    const projectRoot = await requireProjectRoot(options);
    const existing = roots.find((root) => root.scope === "local" && root.path === path.join(projectRoot, ".cli"));
    return existing ?? { path: path.join(projectRoot, ".cli"), scope: "local", projectRoot };
}
async function requireProjectRoot(options) {
    const env = options.env ?? process.env;
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const home = path.resolve(options.home ?? env.HOME ?? os.homedir());
    const projectRoot = env.ASYNC_CLI_PROJECT_ROOT
        ? path.resolve(env.ASYNC_CLI_PROJECT_ROOT)
        : await findNearestGitRoot(cwd, home);
    if (!projectRoot) {
        throw new CliError("MISSING_GIT_ROOT", "No Git root found. Use --root for the user-global command tree.");
    }
    return projectRoot;
}
async function findNearestGitRoot(cwd, home) {
    for (const directory of directoriesUntilHomeOrRoot(cwd, home)) {
        if (await pathExists(path.join(directory, ".git"))) {
            return directory;
        }
    }
    return null;
}
function directoriesFromCwdToRoot(cwd, root) {
    const directories = [];
    let current = path.resolve(cwd);
    const resolvedRoot = path.resolve(root);
    if (!isInsideOrEqual(current, resolvedRoot)) {
        return [resolvedRoot];
    }
    while (true) {
        directories.push(current);
        if (current === resolvedRoot) {
            return directories;
        }
        current = path.dirname(current);
    }
}
function directoriesUntilHomeOrRoot(cwd, home) {
    const directories = [];
    let current = path.resolve(cwd);
    const resolvedHome = path.resolve(home);
    while (true) {
        if (current !== resolvedHome) {
            directories.push(current);
        }
        if (current === resolvedHome || current === path.dirname(current)) {
            return directories;
        }
        current = path.dirname(current);
    }
}
function dedupeRoots(roots) {
    const seen = new Set();
    return roots.filter((root) => {
        if (seen.has(root.path)) {
            return false;
        }
        seen.add(root.path);
        return true;
    });
}
function isShadowedBy(selected, other) {
    return startsWithSegments(other.command, selected.command) || selected.command.join("\0") === other.command.join("\0");
}
async function tryResolve(options, command) {
    try {
        return await resolveCommand(options, command);
    }
    catch (error) {
        if (error instanceof CliError) {
            return null;
        }
        throw error;
    }
}
function nearestSuggestions(input, candidates) {
    const firstWord = input.split(/\s+/, 1)[0] ?? "";
    return candidates
        .map((candidate) => candidate.command.join(" "))
        .filter((command) => command.startsWith(firstWord) || firstWord.startsWith(command.split(/\s+/, 1)[0] ?? ""))
        .slice(0, 5);
}
export async function readCwdPragma(script) {
    const text = await readFile(script, "utf8");
    for (const line of text.split(/\r?\n/, 16)) {
        const match = /^\/\/\s*cli-cwd:\s*(\S+)\s*$/.exec(line);
        if (!match) {
            continue;
        }
        const value = match[1];
        if (value === "caller" || value === "project-root" || value === "script-dir") {
            return value;
        }
        throw new CliError("INVALID_ARGS", `Unknown cli-cwd value "${value}" in ${script}. Use caller, project-root, or script-dir.`);
    }
    return "caller";
}
export async function resolveScriptCwd(resolution, callerCwd) {
    const mode = await readCwdPragma(resolution.script);
    if (mode === "project-root") {
        return resolution.root.projectRoot ?? callerCwd;
    }
    if (mode === "script-dir") {
        return path.dirname(resolution.script);
    }
    return callerCwd;
}
export function buildScriptEnv(resolution, callerCwd, baseEnv = process.env) {
    return {
        ...baseEnv,
        CLI_SCRIPT: resolution.script,
        CLI_ROOT: resolution.root.path,
        CLI_SCOPE: resolution.root.scope,
        CLI_PROJECT_ROOT: resolution.root.projectRoot ?? "",
        CLI_COMMAND: resolution.command.join(" "),
        CLI_CALLER_CWD: callerCwd
    };
}
export async function executeResolution(resolution, options = {}) {
    const callerCwd = path.resolve(options.cwd ?? process.cwd());
    const child = spawn(process.execPath, [resolution.script, ...resolution.argv], {
        cwd: await resolveScriptCwd(resolution, callerCwd),
        env: buildScriptEnv(resolution, callerCwd, { ...process.env, ...(options.env ?? {}) }),
        stdio: options.stdio ?? "inherit"
    });
    const forwardSignal = (signal) => {
        if (!child.killed) {
            child.kill(signal);
        }
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    return await new Promise((resolve) => {
        child.once("exit", (code, signal) => {
            process.off("SIGINT", forwardSignal);
            process.off("SIGTERM", forwardSignal);
            if (typeof code === "number") {
                resolve(code);
            }
            else if (signal) {
                resolve(128 + signalNumber(signal));
            }
            else {
                resolve(1);
            }
        });
    });
}
function signalNumber(signal) {
    return signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1;
}
function scaffoldScript(commandPath) {
    return [
        `// cli: ${commandPath.join(" ")} command`,
        "",
        `console.log(${JSON.stringify(`${commandPath.join(" ")} command`)});`,
        ""
    ].join("\n");
}
async function nestedRunnableScripts(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    const nested = [];
    for (const child of children) {
        if (!child.isDirectory() || isIgnoredSegment(child.name)) {
            continue;
        }
        const childDirectory = path.join(directory, child.name);
        const script = await findRunnableScript(childDirectory);
        if (script) {
            nested.push(script);
        }
        nested.push(...await nestedRunnableScripts(childDirectory));
    }
    return nested;
}
async function findTemplate(roots, name) {
    if (name.length === 0 ||
        name === "." ||
        name === ".." ||
        path.isAbsolute(name) ||
        name.includes("/") ||
        name.includes("\\")) {
        throw new CliError("UNSAFE_SEGMENT", `Unsafe template name: ${name}`);
    }
    for (const root of roots) {
        const candidate = path.join(root.path, "_templates", name);
        if (await isDirectory(candidate)) {
            return candidate;
        }
    }
    throw new CliError("TEMPLATE_NOT_FOUND", `Template not found: ${name}`, {
        suggestions: await availableTemplates(roots)
    });
}
export async function availableTemplates(roots) {
    const names = new Set();
    for (const root of roots) {
        const templatesDirectory = path.join(root.path, "_templates");
        if (!await isDirectory(templatesDirectory)) {
            continue;
        }
        const children = await readdir(templatesDirectory, { withFileTypes: true });
        for (const child of children) {
            if (child.isDirectory()) {
                names.add(child.name);
            }
        }
    }
    return [...names].sort();
}
export const scriptFileNames = scriptFiles;
export function isIgnoredCommandSegment(segment) {
    return isIgnoredSegment(segment);
}
async function escapingImportWarnings(commandDirectory, operation) {
    const warnings = [];
    for (const scriptFile of scriptFiles) {
        const script = path.join(commandDirectory, scriptFile);
        if (!await isFile(script)) {
            continue;
        }
        if (await scriptImportsEscape(script)) {
            warnings.push(`${scriptFile} imports through ../ and may not survive the ${operation} unchanged.`);
        }
    }
    return warnings;
}
export async function scriptImportsEscape(script) {
    const text = await readFile(script, "utf8");
    return /\bfrom\s+["']\.\.\//.test(text) || /\bimport\s*\(\s*["']\.\.\//.test(text);
}
async function removeEmptyParents(start, stop) {
    let current = start;
    const resolvedStop = path.resolve(stop);
    while (isInsideOrEqual(current, resolvedStop) && current !== resolvedStop) {
        const entries = await readdir(current);
        if (entries.length > 0) {
            return;
        }
        await rmdir(current);
        current = path.dirname(current);
    }
}
function startsWithSegments(candidate, prefix) {
    return prefix.every((segment, index) => candidate[index] === segment);
}
function isInsideOrEqual(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
async function isDirectory(candidate) {
    try {
        return (await stat(candidate)).isDirectory();
    }
    catch (error) {
        if (isMissing(error)) {
            return false;
        }
        throw error;
    }
}
async function isFile(candidate) {
    try {
        return (await stat(candidate)).isFile();
    }
    catch (error) {
        if (isMissing(error)) {
            return false;
        }
        throw error;
    }
}
async function pathExists(candidate) {
    try {
        await access(candidate, fsConstants.F_OK);
        return true;
    }
    catch (error) {
        if (isMissing(error)) {
            return false;
        }
        throw error;
    }
}
function pathExistsSync(candidate) {
    try {
        statSync(candidate);
        return true;
    }
    catch {
        return false;
    }
}
function isMissing(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
//# sourceMappingURL=router.js.map