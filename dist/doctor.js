import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { managedAgentsBlock } from "./agents.js";
import { CliError } from "./errors.js";
import { discoverRoots, findRunnableScript, isIgnoredCommandSegment, listCommands, readDescription, scriptImportsEscape } from "./router.js";
import { isTrustEnforced, localOverlayTrust } from "./trust.js";
export async function runDoctor(options = {}) {
    const env = options.env ?? process.env;
    const problems = [];
    const roots = await discoverRoots(options);
    for (const root of roots) {
        await auditTree(root.path, problems);
    }
    await auditShadows(options, problems);
    await auditTrust(options, env, problems);
    await auditAgentsPointer(roots.find((root) => root.scope === "local")?.projectRoot ?? null, problems);
    const summary = {
        errors: problems.filter((problem) => problem.severity === "error").length,
        warnings: problems.filter((problem) => problem.severity === "warning").length,
        infos: problems.filter((problem) => problem.severity === "info").length
    };
    return { version: 1, problems, summary };
}
export function renderDoctorReport(report) {
    if (report.problems.length === 0) {
        return "No problems found.\n";
    }
    const lines = [];
    for (const severity of ["error", "warning", "info"]) {
        for (const problem of report.problems.filter((entry) => entry.severity === severity)) {
            lines.push(`${severity}: [${problem.code}] ${problem.message}`);
            if (problem.path) {
                lines.push(`  ${problem.path}`);
            }
        }
    }
    lines.push(`${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.infos} info(s)`);
    return `${lines.join("\n")}\n`;
}
async function auditTree(directory, problems) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch {
        return;
    }
    let script = null;
    try {
        script = await findRunnableScript(directory);
    }
    catch (error) {
        if (error instanceof CliError && error.code === "AMBIGUOUS_SCRIPT") {
            problems.push({
                severity: "error",
                code: "ambiguous-script",
                message: `Multiple script.* files in one command directory: ${error.files.map((file) => path.basename(file)).join(", ")}`,
                path: directory
            });
        }
        else {
            throw error;
        }
    }
    const childDirectories = entries.filter((entry) => entry.isDirectory() && !isIgnoredCommandSegment(entry.name));
    if (script) {
        if (await scriptImportsEscape(script)) {
            problems.push({
                severity: "warning",
                code: "escaping-import",
                message: "Script imports through ../ and will not survive --cp/--mv cleanly.",
                path: script
            });
        }
        if (await readDescription(script) === "") {
            problems.push({
                severity: "info",
                code: "missing-description",
                message: "Script has no first-line // cli: description.",
                path: script
            });
        }
    }
    for (const child of childDirectories) {
        await auditTree(path.join(directory, child.name), problems);
    }
}
async function auditShadows(options, problems) {
    let listing;
    try {
        listing = await listCommands(options);
    }
    catch (error) {
        if (error instanceof CliError) {
            return;
        }
        throw error;
    }
    for (const entry of listing.commands) {
        if (entry.shadowed) {
            problems.push({
                severity: "info",
                code: "shadowed-command",
                message: `Command "${entry.command}" is shadowed by a nearer overlay.`,
                path: entry.script
            });
        }
    }
    for (const root of listing.roots) {
        await auditEmptyDirectories(root.path, problems, true);
    }
}
async function auditEmptyDirectories(directory, problems, isRoot) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch {
        return;
    }
    const childDirectories = entries.filter((entry) => entry.isDirectory() && !isIgnoredCommandSegment(entry.name));
    let script = null;
    try {
        script = await findRunnableScript(directory);
    }
    catch {
        script = "ambiguous";
    }
    if (!isRoot && !script && childDirectories.length === 0) {
        problems.push({
            severity: "warning",
            code: "empty-command-dir",
            message: "Directory has no script.* and no subcommands.",
            path: directory
        });
    }
    for (const child of childDirectories) {
        await auditEmptyDirectories(path.join(directory, child.name), problems, false);
    }
}
async function auditTrust(options, env, problems) {
    if (!isTrustEnforced(env)) {
        return;
    }
    let overlays;
    try {
        overlays = await localOverlayTrust(options);
    }
    catch (error) {
        if (error instanceof CliError) {
            problems.push({ severity: "error", code: "trust-store", message: error.message });
            return;
        }
        throw error;
    }
    for (const overlay of overlays) {
        if (overlay.state === "untrusted") {
            problems.push({
                severity: "warning",
                code: "untrusted-overlay",
                message: "Local overlay is not trusted; its commands will not run. Run cli --trust.",
                path: overlay.path
            });
        }
        else if (overlay.state === "changed") {
            problems.push({
                severity: "warning",
                code: "changed-overlay",
                message: "Local overlay changed since it was trusted. Review and re-run cli --trust.",
                path: overlay.path
            });
        }
    }
}
async function auditAgentsPointer(projectRoot, problems) {
    if (!projectRoot) {
        return;
    }
    let pointerSeen = false;
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        const file = path.join(projectRoot, name);
        let content;
        try {
            content = await readFile(file, "utf8");
        }
        catch {
            continue;
        }
        if (content.includes(managedAgentsBlock.trim())) {
            pointerSeen = true;
        }
        else if (content.includes("<!-- async-cli:begin -->")) {
            pointerSeen = true;
            problems.push({
                severity: "warning",
                code: "agents-drift",
                message: `Outdated async-cli block. Run cli --agents${name === "CLAUDE.md" ? " --claude" : ""} --write.`,
                path: file
            });
        }
    }
    if (!pointerSeen) {
        problems.push({
            severity: "info",
            code: "agents-missing",
            message: "No context file points at the command tree. Run cli --agents --write.",
            path: projectRoot
        });
    }
}
//# sourceMappingURL=doctor.js.map