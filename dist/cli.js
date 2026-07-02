#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handleAgentsCommand } from "./agents.js";
import { CliError, copyCommand, createCommand, listCommands, moveCommand, packageInfo, renderHelp, resolveCommand, runCommand } from "./index.js";
export async function main(argv = process.argv.slice(2), io = process) {
    const [first] = argv;
    try {
        if (!first || first === "--help" || first === "-h") {
            const listing = await listCommands();
            io.stdout.write(renderHelp(listing.commands.filter((command) => !command.shadowed).map((command) => command.command)));
            return 0;
        }
        if (first === "help") {
            const prefix = argv.slice(1);
            await printHelp(prefix, io);
            return 0;
        }
        if (first === "--version" || first === "version") {
            io.stdout.write(`${packageInfo.version}\n`);
            return 0;
        }
        if (first === "--list") {
            const listing = await listCommands();
            if (argv.includes("--json")) {
                io.stdout.write(`${JSON.stringify(listing, null, 2)}\n`);
            }
            else {
                io.stdout.write(renderList(listing.commands));
            }
            return 0;
        }
        if (first === "--which") {
            const resolution = await resolveCommand({}, argv.slice(1));
            io.stdout.write([
                `command: ${resolution.command.join(" ")}`,
                `script: ${resolution.script}`,
                `scope: ${resolution.root.scope}`,
                `argv: ${JSON.stringify(resolution.argv)}`,
                ...resolution.shadows.map((script) => `shadows: ${script}`),
                ""
            ].join("\n"));
            return 0;
        }
        if (first === "--new") {
            const result = await createCommand({ root: argv.includes("--root") ? "root" : "auto" }, cleanFlagArgs(argv.slice(1), ["--root"]));
            io.stdout.write(`created ${result.script}\n`);
            return 0;
        }
        if (first === "--mv") {
            const { target, commandPath } = parseTransferArgs("--mv", argv, io);
            if (!target) {
                return 2;
            }
            const result = await moveCommand({ to: target }, commandPath);
            io.stdout.write(`moved ${result.from} -> ${result.to}\n`);
            for (const warning of result.warnings) {
                io.stderr.write(`warning: ${warning}\n`);
            }
            return 0;
        }
        if (first === "--cp") {
            const { target, commandPath } = parseTransferArgs("--cp", argv, io);
            if (!target) {
                return 2;
            }
            const result = await copyCommand({ to: target }, commandPath);
            io.stdout.write(`copied ${result.from} -> ${result.to}\n`);
            for (const warning of result.warnings) {
                io.stderr.write(`warning: ${warning}\n`);
            }
            return 0;
        }
        if (first === "--agents") {
            return await handleAgentsCommand(argv.slice(1), io);
        }
        return await runCommand({}, argv);
    }
    catch (error) {
        if (error instanceof CliError) {
            io.stderr.write(renderCliError(error));
            return error.exitCode;
        }
        throw error;
    }
}
async function printHelp(prefix, io) {
    if (prefix.length === 0) {
        const listing = await listCommands();
        io.stdout.write(renderHelp(listing.commands.filter((command) => !command.shadowed).map((command) => command.command)));
        return;
    }
    const prefixText = prefix.join(" ");
    const listing = await listCommands();
    const matches = listing.commands
        .filter((command) => !command.shadowed && command.command.startsWith(prefixText))
        .map((command) => command.description ? `${command.command} - ${command.description}` : command.command);
    io.stdout.write(matches.length > 0
        ? `${matches.join("\n")}\n`
        : `No commands found below ${prefixText}\n`);
}
function cleanFlagArgs(args, flags) {
    return args.filter((arg) => !flags.includes(arg));
}
function parseTransferArgs(flag, argv, io) {
    const toIndex = argv.indexOf("--to");
    const target = toIndex >= 0 ? argv[toIndex + 1] : "root";
    if (target !== "root" && target !== "local") {
        io.stderr.write(`${flag} --to must be root or local\n`);
        return { target: null, commandPath: [] };
    }
    const commandPath = toIndex >= 0
        ? argv.slice(1, toIndex)
        : argv.slice(1);
    return { target, commandPath };
}
function renderList(commands) {
    if (commands.length === 0) {
        return "No commands found.\n";
    }
    return `${commands.map((command) => {
        const suffix = command.shadowed ? " (shadowed)" : "";
        const description = command.description ? ` - ${command.description}` : "";
        return `${command.command}${suffix}${description}`;
    }).join("\n")}\n`;
}
function renderCliError(error) {
    const lines = [error.message];
    if (error.suggestions.length > 0) {
        lines.push(`Suggestions: ${error.suggestions.join(", ")}`);
    }
    if (error.subcommands.length > 0) {
        lines.push("Available subcommands:");
        lines.push(...error.subcommands.map((command) => `  ${command}`));
    }
    if (error.files.length > 0) {
        lines.push("Files:");
        lines.push(...error.files.map((file) => `  ${file}`));
    }
    lines.push("Run cli help for usage.");
    return `${lines.join("\n")}\n`;
}
function isCliEntrypoint() {
    if (!process.argv[1]) {
        return false;
    }
    const moduleUrl = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
    const entryUrl = pathToFileURL(realpathSync(process.argv[1])).href;
    return moduleUrl === entryUrl;
}
if (isCliEntrypoint()) {
    process.exitCode = await main();
}
//# sourceMappingURL=cli.js.map