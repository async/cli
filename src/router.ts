import { spawn } from "node:child_process";
import { constants as fsConstants, statSync } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CliErrorCode =
  | "AMBIGUOUS_SCRIPT"
  | "MISSING_GIT_ROOT"
  | "PARTIAL_NAMESPACE"
  | "UNKNOWN_COMMAND"
  | "UNSAFE_SEGMENT"
  | "TARGET_EXISTS"
  | "SOURCE_NOT_FOUND";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;
  readonly suggestions: string[];
  readonly subcommands: string[];
  readonly files: string[];

  constructor(
    code: CliErrorCode,
    message: string,
    details: {
      exitCode?: number;
      suggestions?: string[];
      subcommands?: string[];
      files?: string[];
    } = {}
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = details.exitCode ?? 2;
    this.suggestions = details.suggestions ?? [];
    this.subcommands = details.subcommands ?? [];
    this.files = details.files ?? [];
  }
}

export interface DiscoverRootsOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export interface ResolveCommandOptions extends DiscoverRootsOptions {}
export interface ListCommandsOptions extends DiscoverRootsOptions {}

export interface RunCommandOptions extends ResolveCommandOptions {
  stdio?: "inherit" | "pipe";
}

export interface CreateCommandOptions extends DiscoverRootsOptions {
  root?: "auto" | "root" | "local";
}

export interface MoveCommandOptions extends DiscoverRootsOptions {
  to?: "root" | "local";
}

export interface CommandRoot {
  path: string;
  scope: "local" | "root";
  projectRoot: string | null;
}

export interface CommandEntry {
  command: string;
  script: string;
  scope: "local" | "root";
  description: string;
  shadows: string[];
  shadowed: boolean;
}

export interface CommandList {
  version: 1;
  roots: CommandRoot[];
  commands: CommandEntry[];
}

export interface CommandResolution {
  command: string[];
  script: string;
  argv: string[];
  root: CommandRoot;
  shadows: string[];
}

export interface CreateCommandResult {
  command: string[];
  directory: string;
  script: string;
  root: CommandRoot;
}

export interface MoveCommandResult {
  command: string[];
  from: string;
  to: string;
  warnings: string[];
}

interface Candidate {
  command: string[];
  directory: string;
  script: string;
  root: CommandRoot;
  description: string;
}

interface PrefixMatch {
  root: CommandRoot;
  prefix: string[];
  directory: string;
}

const scriptFiles = ["script.ts", "script.mts", "script.js", "script.mjs"] as const;
const ignoredNames = new Set(["help", "lib", "node_modules"]);

export async function discoverRoots(options: DiscoverRootsOptions = {}): Promise<CommandRoot[]> {
  const env = options.env ?? process.env;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const home = path.resolve(options.home ?? env.HOME ?? os.homedir());
  const globalRoot = path.resolve(env.ASYNC_CLI_GLOBAL_ROOT ?? path.join(home, ".cli"));
  const projectRoot = env.ASYNC_CLI_PROJECT_ROOT
    ? path.resolve(env.ASYNC_CLI_PROJECT_ROOT)
    : await findNearestGitRoot(cwd, home);

  const roots: CommandRoot[] = [];
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

export async function resolveCommand(options: ResolveCommandOptions = {}, args: string[]): Promise<CommandResolution> {
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
    throw new CliError(
      subcommands.length > 0 ? "PARTIAL_NAMESPACE" : "UNKNOWN_COMMAND",
      subcommands.length > 0
        ? `${match.prefix.join(" ")} is a command namespace, not a runnable command.`
        : `Unknown command: ${parsed.command.join(" ")}`,
      { subcommands }
    );
  }

  throw new CliError("UNKNOWN_COMMAND", `Unknown command: ${parsed.command.join(" ")}`, {
    suggestions: nearestSuggestions(parsed.command.join(" "), candidates)
  });
}

export async function listCommands(options: ListCommandsOptions = {}): Promise<CommandList> {
  const roots = await discoverRoots(options);
  const candidates = await collectCandidates(roots);
  const shadowedScripts = new Set<string>();
  const shadowMap = new Map<string, string[]>();

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

export async function runCommand(options: RunCommandOptions = {}, args: string[]): Promise<number> {
  const resolution = await resolveCommand(options, args);
  return await spawnScript(resolution, options);
}

export async function createCommand(options: CreateCommandOptions = {}, commandPath: string[]): Promise<CreateCommandResult> {
  validateCommandPath(commandPath);
  const roots = await discoverRoots(options);
  const targetRoot = await selectCreateRoot(options, roots);
  const directory = path.join(targetRoot.path, ...commandPath);
  const script = path.join(directory, "script.ts");

  if (await pathExists(directory)) {
    throw new CliError("TARGET_EXISTS", `Command directory already exists: ${directory}`);
  }

  await mkdir(directory, { recursive: true });
  await writeFile(script, scaffoldScript(commandPath), "utf8");
  return { command: commandPath, directory, script, root: targetRoot };
}

export async function moveCommand(options: MoveCommandOptions = {}, commandPath: string[]): Promise<MoveCommandResult> {
  validateCommandPath(commandPath);
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

  const warnings = await escapingImportWarnings(from);
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
  await removeEmptyParents(path.dirname(from), sourceRoot.path);
  return { command: commandPath, from, to, warnings };
}

async function collectCandidates(roots: CommandRoot[]): Promise<Candidate[]> {
  const nested = await Promise.all(roots.map((root) => collectCandidatesForRoot(root, root.path, [])));
  return nested.flat();
}

async function collectCandidatesForRoot(root: CommandRoot, directory: string, command: string[]): Promise<Candidate[]> {
  if (!await isDirectory(directory)) {
    return [];
  }

  const candidates: Candidate[] = [];
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

async function findRunnableScript(directory: string): Promise<string | null> {
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

async function findLongestRunnablePrefix(root: CommandRoot, command: string[]): Promise<Candidate | null> {
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

async function findLongestExistingPrefix(root: CommandRoot, command: string[]): Promise<PrefixMatch | null> {
  for (let length = command.length; length > 0; length -= 1) {
    const prefix = command.slice(0, length);
    const directory = path.join(root.path, ...prefix);
    if (await isDirectory(directory)) {
      return { root, prefix, directory };
    }
  }
  return null;
}

async function listSubcommands(directory: string, prefix: string[]): Promise<string[]> {
  const children = await readdir(directory, { withFileTypes: true });
  return children
    .filter((child) => child.isDirectory())
    .filter((child) => !isIgnoredSegment(child.name))
    .map((child) => [...prefix, child.name].join(" "))
    .sort();
}

async function readDescription(script: string): Promise<string> {
  const text = await readFile(script, "utf8");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const match = /^\/\/\s*cli:\s*(.*)$/.exec(firstLine);
  return match?.[1]?.trim() ?? "";
}

function parseCommandArgs(args: string[]): { command: string[]; forwarded: string[] } {
  const cutoff = args.indexOf("--");
  if (cutoff === -1) {
    return { command: args, forwarded: [] };
  }
  return {
    command: args.slice(0, cutoff),
    forwarded: args.slice(cutoff + 1)
  };
}

function validateCommandPath(commandPath: string[]): void {
  if (commandPath.length === 0) {
    throw new CliError("UNSAFE_SEGMENT", "Command path is required.");
  }

  for (const segment of commandPath) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      path.isAbsolute(segment) ||
      segment.includes("/") ||
      segment.includes("\\") ||
      isIgnoredSegment(segment)
    ) {
      throw new CliError("UNSAFE_SEGMENT", `Unsafe command path segment: ${segment}`);
    }
  }
}

function isIgnoredSegment(segment: string): boolean {
  return ignoredNames.has(segment) || segment.startsWith(".") || segment.startsWith("_");
}

async function selectCreateRoot(options: CreateCommandOptions, roots: CommandRoot[]): Promise<CommandRoot> {
  if (options.root === "root") {
    return roots.find((root) => root.scope === "root") ?? roots[roots.length - 1]!;
  }

  const existingLocal = roots.find((root) => root.scope === "local");
  if (existingLocal) {
    return existingLocal;
  }

  const projectRoot = await requireProjectRoot(options);
  return { path: path.join(projectRoot, ".cli"), scope: "local", projectRoot };
}

async function selectLocalRootForMove(options: DiscoverRootsOptions, roots: CommandRoot[]): Promise<CommandRoot> {
  const projectRoot = await requireProjectRoot(options);
  const existing = roots.find((root) => root.scope === "local" && root.path === path.join(projectRoot, ".cli"));
  return existing ?? { path: path.join(projectRoot, ".cli"), scope: "local", projectRoot };
}

async function requireProjectRoot(options: DiscoverRootsOptions): Promise<string> {
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

async function findNearestGitRoot(cwd: string, home: string): Promise<string | null> {
  for (const directory of directoriesUntilHomeOrRoot(cwd, home)) {
    if (await pathExists(path.join(directory, ".git"))) {
      return directory;
    }
  }
  return null;
}

function directoriesFromCwdToRoot(cwd: string, root: string): string[] {
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

function directoriesUntilHomeOrRoot(cwd: string, home: string): string[] {
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

function dedupeRoots(roots: CommandRoot[]): CommandRoot[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    if (seen.has(root.path)) {
      return false;
    }
    seen.add(root.path);
    return true;
  });
}

function isShadowedBy(selected: Candidate, other: Candidate): boolean {
  return startsWithSegments(other.command, selected.command) || selected.command.join("\0") === other.command.join("\0");
}

async function tryResolve(options: ResolveCommandOptions, command: string[]): Promise<CommandResolution | null> {
  try {
    return await resolveCommand(options, command);
  } catch (error) {
    if (error instanceof CliError) {
      return null;
    }
    throw error;
  }
}

function nearestSuggestions(input: string, candidates: Candidate[]): string[] {
  const firstWord = input.split(/\s+/, 1)[0] ?? "";
  return candidates
    .map((candidate) => candidate.command.join(" "))
    .filter((command) => command.startsWith(firstWord) || firstWord.startsWith(command.split(/\s+/, 1)[0] ?? ""))
    .slice(0, 5);
}

async function spawnScript(resolution: CommandResolution, options: RunCommandOptions): Promise<number> {
  const projectRoot = resolution.root.projectRoot ?? "";
  const child = spawn(process.execPath, [resolution.script, ...resolution.argv], {
    cwd: path.resolve(options.cwd ?? process.cwd()),
    env: {
      ...process.env,
      ...(options.env ?? {}),
      CLI_SCRIPT: resolution.script,
      CLI_ROOT: resolution.root.path,
      CLI_SCOPE: resolution.root.scope,
      CLI_PROJECT_ROOT: projectRoot,
      CLI_COMMAND: resolution.command.join(" ")
    },
    stdio: options.stdio ?? "inherit"
  });

  const forwardSignal = (signal: NodeJS.Signals): void => {
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
      } else if (signal) {
        resolve(128 + signalNumber(signal));
      } else {
        resolve(1);
      }
    });
  });
}

function signalNumber(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1;
}

function scaffoldScript(commandPath: string[]): string {
  return [
    `// cli: ${commandPath.join(" ")} command`,
    "",
    `console.log(${JSON.stringify(`${commandPath.join(" ")} command`)});`,
    ""
  ].join("\n");
}

async function escapingImportWarnings(commandDirectory: string): Promise<string[]> {
  const warnings = [];
  for (const scriptFile of scriptFiles) {
    const script = path.join(commandDirectory, scriptFile);
    if (!await isFile(script)) {
      continue;
    }
    const text = await readFile(script, "utf8");
    if (/\bfrom\s+["']\.\.\//.test(text) || /\bimport\s*\(\s*["']\.\.\//.test(text)) {
      warnings.push(`${scriptFile} imports through ../ and may not survive the move unchanged.`);
    }
  }
  return warnings;
}

async function removeEmptyParents(start: string, stop: string): Promise<void> {
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

function startsWithSegments(candidate: string[], prefix: string[]): boolean {
  return prefix.every((segment, index) => candidate[index] === segment);
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

function pathExistsSync(candidate: string): boolean {
  try {
    statSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
