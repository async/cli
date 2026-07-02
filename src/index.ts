export const packageInfo = Object.freeze({
  name: "@async/cli",
  version: "0.1.2",
  node: ">=24",
  binaries: ["cli", "async-cli"] as const,
  specVersion: 1,
  routerStatus: "implemented",
  contextPointerStatus: "implemented"
});

export type AsyncCliPackageInfo = typeof packageInfo;

export {
  CliError,
  copyCommand,
  createCommand,
  discoverRoots,
  listCommands,
  moveCommand,
  resolveCommand,
  runCommand
} from "./router.js";

export type {
  CliErrorCode,
  CommandEntry,
  CommandResolution,
  CommandRoot,
  CopyCommandOptions,
  CopyCommandResult,
  CreateCommandOptions,
  DiscoverRootsOptions,
  ListCommandsOptions,
  MoveCommandOptions,
  ResolveCommandOptions,
  RunCommandOptions
} from "./router.js";

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
    "  cli --new <command...> [--root]",
    "  cli --cp <command...> [--to root|local]",
    "  cli --mv <command...> [--to root|local]",
    "  cli --agents [--write|--check] [--claude]",
    "  cli <command...> [args...]",
    "",
    "Commands live under .cli/ overlays and the user-global root.",
    ...commandLines,
    ""
  ].join("\n");
}
