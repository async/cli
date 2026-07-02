export declare const packageInfo: Readonly<{
    name: "@async/cli";
    version: "0.1.1";
    node: ">=24";
    binaries: readonly ["cli", "async-cli"];
    specVersion: 1;
    routerStatus: "implemented";
    contextPointerStatus: "implemented";
}>;
export type AsyncCliPackageInfo = typeof packageInfo;
export { CliError, copyCommand, createCommand, discoverRoots, listCommands, moveCommand, resolveCommand, runCommand } from "./router.js";
export type { CliErrorCode, CommandEntry, CommandResolution, CommandRoot, CopyCommandOptions, CopyCommandResult, CreateCommandOptions, DiscoverRootsOptions, ListCommandsOptions, MoveCommandOptions, ResolveCommandOptions, RunCommandOptions } from "./router.js";
export declare function renderHelp(commands?: string[]): string;
//# sourceMappingURL=index.d.ts.map