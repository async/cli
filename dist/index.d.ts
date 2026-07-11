export { packageInfo } from "./package-info.js";
export type { AsyncCliPackageInfo } from "./package-info.js";
export { CliError, availableTemplates, copyCommand, createCommand, discoverRoots, executeResolution, findRunnableScript, listCommands, moveCommand, readCwdPragma, removeCommand, resolveCommand, resolveScopedRoot, resolveScriptCwd } from "./router.js";
export { runCommand } from "./run.js";
export type { CliErrorCode, CommandEntry, CommandList, CommandResolution, CommandRoot, CopyCommandOptions, CopyCommandResult, CreateCommandOptions, CreateCommandResult, DiscoverRootsOptions, ListCommandsOptions, MoveCommandOptions, MoveCommandResult, RemoveCommandOptions, RemoveCommandResult, ResolveCommandOptions, RunCommandOptions, ScriptCwdMode } from "./router.js";
export { ensureOverlayTrusted, hashOverlayTree, isTrustEnforced, localOverlayTrust, overlayTrustState, recordOverlayTrust, removeOverlayTrust, trustLocalOverlays, trustStorePath, untrustLocalOverlays } from "./trust.js";
export type { OverlayTrust, OverlayTrustState } from "./trust.js";
export { builtinFlags, complete, completionScript } from "./completions.js";
export type { CompletionShell } from "./completions.js";
export { renderDoctorReport, runDoctor } from "./doctor.js";
export type { DoctorProblem, DoctorReport, DoctorSeverity } from "./doctor.js";
export { addPack } from "./packs.js";
export type { AddPackOptions, AddPackResult } from "./packs.js";
export declare function renderHelp(commands?: string[]): string;
//# sourceMappingURL=index.d.ts.map