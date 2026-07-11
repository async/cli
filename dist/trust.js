import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, readlink, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";
import { discoverRoots } from "./router.js";
const emptyStore = { version: 1, overlays: {} };
export function isTrustEnforced(env = process.env) {
    return env.ASYNC_CLI_TRUST !== "off";
}
export function trustStorePath(options = {}) {
    const env = options.env ?? process.env;
    const home = path.resolve(options.home ?? env.HOME ?? os.homedir());
    const globalRoot = path.resolve(env.ASYNC_CLI_GLOBAL_ROOT ?? path.join(home, ".cli"));
    return path.join(globalRoot, ".trust.json");
}
export async function hashOverlayTree(overlayPath) {
    const hash = createHash("sha256");
    const files = await collectFiles(overlayPath);
    files.sort((a, b) => a.relative.localeCompare(b.relative));
    for (const file of files) {
        hash.update(file.relative);
        hash.update("\0");
        hash.update(file.digest);
        hash.update("\n");
    }
    return `sha256:${hash.digest("hex")}`;
}
export async function overlayTrustState(options, overlayPath) {
    const store = await readTrustStore(options);
    const entry = store.overlays[path.resolve(overlayPath)];
    if (!entry) {
        return "untrusted";
    }
    return entry.hash === await hashOverlayTree(overlayPath) ? "trusted" : "changed";
}
export async function ensureOverlayTrusted(options, overlayPath) {
    const env = options.env ?? process.env;
    if (!isTrustEnforced(env)) {
        return;
    }
    const state = await overlayTrustState(options, overlayPath);
    if (state === "trusted") {
        return;
    }
    const reason = state === "changed"
        ? `Local overlay changed since it was trusted: ${overlayPath}`
        : `Local overlay is not trusted: ${overlayPath}`;
    throw new CliError("UNTRUSTED_OVERLAY", reason, {
        exitCode: 3,
        suggestions: ["cli --trust"]
    });
}
export async function recordOverlayTrust(options, overlayPath) {
    const resolved = path.resolve(overlayPath);
    const store = await readTrustStore(options);
    store.overlays[resolved] = {
        hash: await hashOverlayTree(resolved),
        trustedAt: new Date().toISOString()
    };
    await writeTrustStore(options, store);
}
export async function removeOverlayTrust(options, overlayPath) {
    const resolved = path.resolve(overlayPath);
    const store = await readTrustStore(options);
    if (!(resolved in store.overlays)) {
        return false;
    }
    delete store.overlays[resolved];
    await writeTrustStore(options, store);
    return true;
}
export async function refreshOverlayTrustIfKnown(options, overlayPath) {
    const store = await readTrustStore(options);
    if (path.resolve(overlayPath) in store.overlays) {
        await recordOverlayTrust(options, overlayPath);
    }
}
export async function trustLocalOverlays(options = {}) {
    const locals = await discoverLocalOverlays(options);
    for (const overlay of locals) {
        await recordOverlayTrust(options, overlay);
    }
    return locals.map((overlay) => ({ path: overlay, state: "trusted" }));
}
export async function untrustLocalOverlays(options = {}) {
    const locals = await discoverLocalOverlays(options);
    const removed = [];
    for (const overlay of locals) {
        if (await removeOverlayTrust(options, overlay)) {
            removed.push({ path: overlay, state: "untrusted" });
        }
    }
    return removed;
}
export async function localOverlayTrust(options = {}) {
    const locals = await discoverLocalOverlays(options);
    const overlays = [];
    for (const overlay of locals) {
        overlays.push({ path: overlay, state: await overlayTrustState(options, overlay) });
    }
    return overlays;
}
async function discoverLocalOverlays(options) {
    const roots = await discoverRoots(options);
    return roots.filter((root) => root.scope === "local").map((root) => root.path);
}
async function readTrustStore(options) {
    try {
        const raw = await readFile(trustStorePath(options), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1 || typeof parsed.overlays !== "object" || parsed.overlays === null) {
            return structuredClone(emptyStore);
        }
        return parsed;
    }
    catch (error) {
        if (isMissing(error)) {
            return structuredClone(emptyStore);
        }
        if (error instanceof SyntaxError) {
            throw new CliError("INVALID_ARGS", `Trust store is not valid JSON: ${trustStorePath(options)}`);
        }
        throw error;
    }
}
async function writeTrustStore(options, store) {
    const file = trustStorePath(options);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
async function collectFiles(directory) {
    const results = [];
    const activeDirectories = new Set();
    try {
        if ((await lstat(directory)).isSymbolicLink()) {
            const target = await readlink(directory);
            const linked = await inspectSymlink(directory, target);
            results.push({ relative: ".", digest: linked.digest });
            if (linked.kind !== "directory") {
                return results;
            }
        }
    }
    catch (error) {
        if (isMissing(error)) {
            return results;
        }
        throw error;
    }
    async function walk(current) {
        let resolvedDirectory;
        try {
            resolvedDirectory = await realpath(current);
        }
        catch (error) {
            if (isMissing(error)) {
                return;
            }
            throw error;
        }
        if (activeDirectories.has(resolvedDirectory)) {
            const relative = path.relative(directory, current) || ".";
            throw new CliError("INVALID_ARGS", `Cannot trust overlay with a cyclic directory symlink: ${relative}`);
        }
        activeDirectories.add(resolvedDirectory);
        try {
            let entries;
            try {
                entries = await readdir(current, { withFileTypes: true });
            }
            catch (error) {
                if (isMissing(error)) {
                    return;
                }
                throw error;
            }
            for (const entry of entries) {
                const absolute = path.join(current, entry.name);
                const relative = path.relative(directory, absolute);
                if (entry.isDirectory()) {
                    await walk(absolute);
                }
                else if (entry.isSymbolicLink()) {
                    const target = await readlink(absolute);
                    const linked = await inspectSymlink(absolute, target);
                    results.push({ relative, digest: linked.digest });
                    if (linked.kind === "directory") {
                        await walk(absolute);
                    }
                }
                else if (entry.isFile()) {
                    results.push({ relative, digest: sha256(await readFile(absolute)) });
                }
            }
        }
        finally {
            activeDirectories.delete(resolvedDirectory);
        }
    }
    await walk(directory);
    return results;
}
async function inspectSymlink(file, target) {
    try {
        const targetStat = await stat(file);
        if (targetStat.isFile()) {
            return {
                digest: sha256(`link:${target}\0file:${sha256(await readFile(file))}`),
                kind: "file"
            };
        }
        if (targetStat.isDirectory()) {
            return { digest: sha256(`link:${target}\0directory`), kind: "directory" };
        }
        throw new CliError("INVALID_ARGS", `Cannot trust unsupported symlink target: ${file}`);
    }
    catch (error) {
        if (isMissing(error)) {
            return { digest: sha256(`link:${target}\0missing`), kind: "missing" };
        }
        throw error;
    }
}
function sha256(content) {
    return createHash("sha256").update(content).digest("hex");
}
function isMissing(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
//# sourceMappingURL=trust.js.map