export { packageInfo } from "./package-info.js";
export type { AsyncCliPackageInfo } from "./package-info.js";

export {
  CliError,
  availableTemplates,
  copyCommand,
  createCommand,
  discoverRoots,
  executeResolution,
  findRunnableScript,
  listCommands,
  moveCommand,
  readCwdPragma,
  removeCommand,
  resolveCommand,
  resolveScopedRoot,
  resolveScriptCwd
} from "./router.js";

export { runCommand } from "./run.js";

export type {
  CliErrorCode,
  CommandEntry,
  CommandList,
  CommandResolution,
  CommandRoot,
  CopyCommandOptions,
  CopyCommandResult,
  CreateCommandOptions,
  CreateCommandResult,
  DiscoverRootsOptions,
  ListCommandsOptions,
  MoveCommandOptions,
  MoveCommandResult,
  RemoveCommandOptions,
  RemoveCommandResult,
  ResolveCommandOptions,
  RunCommandOptions,
  ScriptCwdMode
} from "./router.js";

export {
  ensureOverlayTrusted,
  hashOverlayTree,
  isTrustEnforced,
  localOverlayTrust,
  overlayTrustState,
  recordOverlayTrust,
  removeOverlayTrust,
  trustLocalOverlays,
  trustStorePath,
  untrustLocalOverlays
} from "./trust.js";
export type { OverlayTrust, OverlayTrustState } from "./trust.js";

export { builtinFlags, complete, completionScript } from "./completions.js";
export type { CompletionShell } from "./completions.js";

export { renderDoctorReport, runDoctor } from "./doctor.js";
export type { DoctorProblem, DoctorReport, DoctorSeverity } from "./doctor.js";

export { runMcpServer } from "./mcp.js";
export type { McpIo } from "./mcp.js";

export { addPack } from "./packs.js";
export type { AddPackOptions, AddPackResult } from "./packs.js";

export function renderHelp(commands: string[] = []): string {
  const commandLines = commands.length > 0
    ? ["", "Available commands:", ...commands.map((command) => `  ${command}`)]
    : [];

  return [
    "@async/cli",
    "",
    "Usage:",
    "  cli",
    "  cli help",
    "  cli help <command-prefix>",
    "  cli --version",
    "  cli --list [--json]",
    "  cli --which <command...>",
    "  cli --new <command...> [--root] [--template <name>]",
    "  cli --edit <command...>",
    "  cli --rm <command...> [--root] [--force]",
    "  cli --cp <command...> [--to root|local]",
    "  cli --mv <command...> [--to root|local]",
    "  cli --add <git-url> [--to root|local] [--prefix <name>] [--force]",
    "  cli --trust [--status]",
    "  cli --untrust",
    "  cli --doctor [--json]",
    "  cli --completions <bash|zsh|fish>",
    "  cli --mcp",
    "  cli --agents [--write|--check] [--claude]",
    "  cli <command...> [args...]",
    "",
    "Commands live under .cli/ overlays and the user-global root.",
    ...commandLines,
    ""
  ].join("\n");
}
