#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handleAgentsCommand } from "./agents.js";
import { complete, completionScript } from "./completions.js";
import { renderDoctorReport, runDoctor } from "./doctor.js";
import {
  CliError,
  addPack,
  copyCommand,
  createCommand,
  discoverRoots,
  listCommands,
  moveCommand,
  packageInfo,
  removeCommand,
  renderHelp,
  resolveCommand,
  resolveScopedRoot,
  runCommand
} from "./index.js";
import type { CommandEntry, OverlayTrustState } from "./index.js";
import {
  localOverlayTrust,
  overlayTrustState,
  recordOverlayTrust,
  refreshOverlayTrustIfKnown,
  trustLocalOverlays,
  untrustLocalOverlays
} from "./trust.js";

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export async function main(argv = process.argv.slice(2), io: CliIo = process): Promise<number> {
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
      } else {
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
      const template = extractValueFlag(argv.slice(1), "--template");
      const preLocals = await snapshotLocalTrust();
      const result = await createCommand(
        {
          root: template.rest.includes("--root") ? "root" : "auto",
          template: template.value ?? undefined
        },
        cleanFlagArgs(template.rest, ["--root"])
      );
      io.stdout.write(`created ${result.script}\n`);
      if (result.root.scope === "local") {
        await settleTrustAfterMutation(io, preLocals, result.root.path);
      }
      return 0;
    }

    if (first === "--edit") {
      const resolution = await resolveCommand({}, argv.slice(1));
      return runEditor(resolution.script, io);
    }

    if (first === "--rm") {
      const preLocals = await snapshotLocalTrust();
      const result = await removeCommand(
        {
          root: argv.includes("--root") ? "root" : "auto",
          force: argv.includes("--force")
        },
        cleanFlagArgs(argv.slice(1), ["--root", "--force"])
      );
      io.stdout.write(`removed ${result.directory}\n`);
      if (result.root.scope === "local") {
        await settleTrustAfterMutation(io, preLocals, null);
      }
      return 0;
    }

    if (first === "--mv") {
      const { target, commandPath } = parseTransferArgs("--mv", argv, io);
      if (!target) {
        return 2;
      }
      const preLocals = await snapshotLocalTrust();
      const result = await moveCommand({ to: target }, commandPath);
      io.stdout.write(`moved ${result.from} -> ${result.to}\n`);
      for (const warning of result.warnings) {
        io.stderr.write(`warning: ${warning}\n`);
      }
      await settleTrustAfterMutation(io, preLocals, target === "local" ? (await resolveScopedRoot({}, "local")).path : null);
      return 0;
    }

    if (first === "--cp") {
      const { target, commandPath } = parseTransferArgs("--cp", argv, io);
      if (!target) {
        return 2;
      }
      const preLocals = await snapshotLocalTrust();
      const result = await copyCommand({ to: target }, commandPath);
      io.stdout.write(`copied ${result.from} -> ${result.to}\n`);
      for (const warning of result.warnings) {
        io.stderr.write(`warning: ${warning}\n`);
      }
      await settleTrustAfterMutation(io, preLocals, target === "local" ? (await resolveScopedRoot({}, "local")).path : null);
      return 0;
    }

    if (first === "--trust") {
      if (argv.includes("--status")) {
        return await printTrustStatus(io);
      }
      const trusted = await trustLocalOverlays();
      if (trusted.length === 0) {
        io.stdout.write("No local overlays found.\n");
        return 0;
      }
      for (const overlay of trusted) {
        io.stdout.write(`trusted ${overlay.path}\n`);
      }
      return 0;
    }

    if (first === "--untrust") {
      const removed = await untrustLocalOverlays();
      if (removed.length === 0) {
        io.stdout.write("No trusted local overlays found.\n");
        return 0;
      }
      for (const overlay of removed) {
        io.stdout.write(`untrusted ${overlay.path}\n`);
      }
      return 0;
    }

    if (first === "--doctor") {
      const report = await runDoctor();
      if (argv.includes("--json")) {
        io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        io.stdout.write(renderDoctorReport(report));
      }
      return report.summary.errors > 0 ? 1 : 0;
    }

    if (first === "--completions") {
      const shell = argv[1];
      if (!shell) {
        throw new CliError("INVALID_ARGS", "--completions requires a shell: bash, zsh, or fish.");
      }
      io.stdout.write(completionScript(shell));
      return 0;
    }

    if (first === "--complete") {
      const words = argv[1] === "--" ? argv.slice(2) : argv.slice(1);
      try {
        const candidates = await complete({}, words);
        if (candidates.length > 0) {
          io.stdout.write(`${candidates.join("\n")}\n`);
        }
      } catch {
        return 1;
      }
      return 0;
    }

    if (first === "--add") {
      const toFlag = extractValueFlag(argv.slice(1), "--to");
      const prefixFlag = extractValueFlag(toFlag.rest, "--prefix");
      const rest = prefixFlag.rest.filter((arg) => arg !== "--force");
      const to = toFlag.value ?? "root";
      if (to !== "root" && to !== "local") {
        io.stderr.write("--add --to must be root or local\n");
        return 2;
      }
      const source = rest[0];
      if (!source) {
        throw new CliError("INVALID_ARGS", "cli --add requires a Git URL or path.");
      }
      const preLocals = await snapshotLocalTrust();
      const result = await addPack(
        {
          to,
          prefix: prefixFlag.value ?? undefined,
          force: prefixFlag.rest.includes("--force")
        },
        source
      );
      io.stdout.write(`installed ${result.installed.join(", ")} -> ${result.root.path}\n`);
      if (result.root.scope === "local") {
        await settleTrustAfterMutation(io, preLocals, result.root.path);
      }
      return 0;
    }

    if (first === "--agents") {
      return await handleAgentsCommand(argv.slice(1), io);
    }

    return await runCommand({}, argv);
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr.write(renderCliError(error));
      return error.exitCode;
    }
    throw error;
  }
}

async function printHelp(prefix: string[], io: CliIo): Promise<void> {
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

async function printTrustStatus(io: CliIo): Promise<number> {
  const overlays = await localOverlayTrust();
  const roots = await discoverRoots();
  const globalRoot = roots.find((root) => root.scope === "root");

  if (overlays.length === 0) {
    io.stdout.write("No local overlays found.\n");
  }
  for (const overlay of overlays) {
    io.stdout.write(`${overlay.state} ${overlay.path}\n`);
  }
  if (globalRoot) {
    io.stdout.write(`trusted ${globalRoot.path} (user-global root)\n`);
  }
  return 0;
}

async function snapshotLocalTrust(): Promise<Map<string, OverlayTrustState>> {
  const snapshot = new Map<string, OverlayTrustState>();
  const roots = await discoverRoots();
  for (const root of roots.filter((candidate) => candidate.scope === "local")) {
    snapshot.set(root.path, await overlayTrustState({}, root.path));
  }
  return snapshot;
}

async function settleTrustAfterMutation(
  io: CliIo,
  preLocals: Map<string, OverlayTrustState>,
  destinationOverlay: string | null
): Promise<void> {
  if (destinationOverlay) {
    const before = preLocals.get(destinationOverlay);
    if (before === undefined || before === "trusted") {
      await recordOverlayTrust({}, destinationOverlay);
    } else {
      io.stderr.write(`note: ${destinationOverlay} remains untrusted. Run cli --trust to trust it.\n`);
    }
  }

  for (const [overlay, state] of preLocals) {
    if (overlay !== destinationOverlay && state === "trusted") {
      await refreshOverlayTrustIfKnown({}, overlay);
    }
  }
}

function runEditor(script: string, io: CliIo): number {
  const editor = [process.env.VISUAL, process.env.EDITOR]
    .find((candidate) => candidate !== undefined && candidate.trim().length > 0) ?? "vi";
  const parts = editor.trim().split(/\s+/).filter((part) => part.length > 0);
  const command = parts[0];
  if (!command) {
    throw new CliError("EDITOR_FAILED", "No editor found. Set $VISUAL or $EDITOR.");
  }

  const result = spawnSync(command, [...parts.slice(1), script], { stdio: "inherit" });
  if (result.error) {
    throw new CliError("EDITOR_FAILED", `Failed to launch editor "${editor}": ${result.error.message}`);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    io.stderr.write(`editor exited with ${result.status}\n`);
    return result.status;
  }
  return 0;
}

function cleanFlagArgs(args: string[], flags: string[]): string[] {
  return args.filter((arg) => !flags.includes(arg));
}

function extractValueFlag(args: string[], flag: string): { value: string | null; rest: string[] } {
  const index = args.indexOf(flag);
  if (index === -1) {
    return { value: null, rest: args };
  }
  const value = args[index + 1];
  if (value === undefined) {
    throw new CliError("INVALID_ARGS", `${flag} requires a value.`);
  }
  return { value, rest: [...args.slice(0, index), ...args.slice(index + 2)] };
}

function parseTransferArgs(
  flag: "--cp" | "--mv",
  argv: string[],
  io: CliIo
): { target: "root" | "local" | null; commandPath: string[] } {
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

function renderList(commands: CommandEntry[]): string {
  if (commands.length === 0) {
    return "No commands found.\n";
  }

  return `${commands.map((command) => {
    const suffix = command.shadowed ? " (shadowed)" : "";
    const description = command.description ? ` - ${command.description}` : "";
    return `${command.command}${suffix}${description}`;
  }).join("\n")}\n`;
}

function renderCliError(error: CliError): string {
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

function isCliEntrypoint(): boolean {
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
