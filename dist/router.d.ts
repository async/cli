export { CliError } from "./errors.js";
export type { CliErrorCode } from "./errors.js";
export interface DiscoverRootsOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    home?: string;
}
export interface ResolveCommandOptions extends DiscoverRootsOptions {
}
export interface ListCommandsOptions extends DiscoverRootsOptions {
}
export interface RunCommandOptions extends ResolveCommandOptions {
    stdio?: "inherit" | "pipe";
}
export interface CreateCommandOptions extends DiscoverRootsOptions {
    root?: "auto" | "root" | "local";
    template?: string;
}
export interface RemoveCommandOptions extends DiscoverRootsOptions {
    root?: "auto" | "root";
    force?: boolean;
}
export interface MoveCommandOptions extends DiscoverRootsOptions {
    to?: "root" | "local";
}
export interface CopyCommandOptions extends DiscoverRootsOptions {
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
export interface RemoveCommandResult {
    command: string[];
    directory: string;
    root: CommandRoot;
    nested: string[];
}
export type ScriptCwdMode = "caller" | "project-root" | "script-dir";
export interface CopyCommandResult {
    command: string[];
    from: string;
    to: string;
    warnings: string[];
}
export declare function discoverRoots(options?: DiscoverRootsOptions): Promise<CommandRoot[]>;
export declare function resolveCommand(options: ResolveCommandOptions | undefined, args: string[]): Promise<CommandResolution>;
export declare function listCommands(options?: ListCommandsOptions): Promise<CommandList>;
export declare function createCommand(options: CreateCommandOptions | undefined, commandPath: string[]): Promise<CreateCommandResult>;
export declare function removeCommand(options: RemoveCommandOptions | undefined, commandPath: string[]): Promise<RemoveCommandResult>;
export declare function resolveScopedRoot(options: DiscoverRootsOptions, scope: "root" | "local"): Promise<CommandRoot>;
export declare function moveCommand(options: MoveCommandOptions | undefined, commandPath: string[]): Promise<MoveCommandResult>;
export declare function copyCommand(options: CopyCommandOptions | undefined, commandPath: string[]): Promise<CopyCommandResult>;
export declare function findRunnableScript(directory: string): Promise<string | null>;
export declare function readDescription(script: string): Promise<string>;
export declare function readCwdPragma(script: string): Promise<ScriptCwdMode>;
export declare function resolveScriptCwd(resolution: CommandResolution, callerCwd: string): Promise<string>;
export declare function buildScriptEnv(resolution: CommandResolution, callerCwd: string, baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function executeResolution(resolution: CommandResolution, options?: RunCommandOptions): Promise<number>;
export declare function availableTemplates(roots: CommandRoot[]): Promise<string[]>;
export declare const scriptFileNames: readonly string[];
export declare function isIgnoredCommandSegment(segment: string): boolean;
export declare function scriptImportsEscape(script: string): Promise<boolean>;
//# sourceMappingURL=router.d.ts.map