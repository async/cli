export const packageInfo = Object.freeze({
    name: "@async/cli",
    version: "0.1.0",
    node: ">=24",
    binaries: ["cli", "async-cli"],
    specVersion: 1,
    routerStatus: "implemented",
    contextPointerStatus: "implemented"
});
export { CliError, createCommand, discoverRoots, listCommands, moveCommand, resolveCommand, runCommand } from "./router.js";
export function renderHelp(commands = []) {
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
        "  cli --mv <command...> [--to root|local]",
        "  cli --agents [--write|--check] [--claude]",
        "  cli <command...> [args...]",
        "",
        "Commands live under .cli/ overlays and the user-global root.",
        ...commandLines,
        ""
    ].join("\n");
}
//# sourceMappingURL=index.js.map