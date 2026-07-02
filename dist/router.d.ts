export type CliErrorCode = "AMBIGUOUS_SCRIPT" | "MISSING_GIT_ROOT" | "PARTIAL_NAMESPACE" | "UNKNOWN_COMMAND" | "UNSAFE_SEGMENT" | "TARGET_EXISTS" | "SOURCE_NOT_FOUND";
export declare class CliError extends Error {
    readonly code: CliErrorCode;
    readonly exitCode: number;
    readonly suggestions: string[];
    readonly subcommands: string[];
    readonly files: string[];
    constructor(code: CliErrorCode, message: string, details?: {
        exitCode?: number;
        suggestions?: string[];
        subcommands?: string[];
        files?: string[];
    });
}
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
export declare function discoverRoots(options?: DiscoverRootsOptions): Promise<CommandRoot[]>;
export declare function resolveCommand(options: ResolveCommandOptions | undefined, args: string[]): Promise<CommandResolution>;
export declare function listCommands(options?: ListCommandsOptions): Promise<CommandList>;
export declare function runCommand(options: RunCommandOptions | undefined, args: string[]): Promise<number>;
export declare function createCommand(options: CreateCommandOptions | undefined, commandPath: string[]): Promise<CreateCommandResult>;
export declare function moveCommand(options: MoveCommandOptions | undefined, commandPath: string[]): Promise<MoveCommandResult>;
//# sourceMappingURL=router.d.ts.map