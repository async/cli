import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, readlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CliError } from "./errors.js";
import { discoverRoots } from "./router.js";
import type { DiscoverRootsOptions } from "./router.js";

export type OverlayTrustState = "trusted" | "changed" | "untrusted";

export interface OverlayTrust {
  path: string;
  state: OverlayTrustState;
}

interface TrustStore {
  version: 1;
  overlays: Record<string, { hash: string; trustedAt: string }>;
}

const emptyStore: TrustStore = { version: 1, overlays: {} };

export function isTrustEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASYNC_CLI_TRUST !== "off";
}

export function trustStorePath(options: DiscoverRootsOptions = {}): string {
  const env = options.env ?? process.env;
  const home = path.resolve(options.home ?? env.HOME ?? os.homedir());
  const globalRoot = path.resolve(env.ASYNC_CLI_GLOBAL_ROOT ?? path.join(home, ".cli"));
  return path.join(globalRoot, ".trust.json");
}

export async function hashOverlayTree(overlayPath: string): Promise<string> {
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

export async function overlayTrustState(
  options: DiscoverRootsOptions,
  overlayPath: string
): Promise<OverlayTrustState> {
  const store = await readTrustStore(options);
  const entry = store.overlays[path.resolve(overlayPath)];
  if (!entry) {
    return "untrusted";
  }
  return entry.hash === await hashOverlayTree(overlayPath) ? "trusted" : "changed";
}

export async function ensureOverlayTrusted(
  options: DiscoverRootsOptions,
  overlayPath: string
): Promise<void> {
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

export async function recordOverlayTrust(
  options: DiscoverRootsOptions,
  overlayPath: string
): Promise<void> {
  const resolved = path.resolve(overlayPath);
  const store = await readTrustStore(options);
  store.overlays[resolved] = {
    hash: await hashOverlayTree(resolved),
    trustedAt: new Date().toISOString()
  };
  await writeTrustStore(options, store);
}

export async function removeOverlayTrust(
  options: DiscoverRootsOptions,
  overlayPath: string
): Promise<boolean> {
  const resolved = path.resolve(overlayPath);
  const store = await readTrustStore(options);
  if (!(resolved in store.overlays)) {
    return false;
  }
  delete store.overlays[resolved];
  await writeTrustStore(options, store);
  return true;
}

export async function refreshOverlayTrustIfKnown(
  options: DiscoverRootsOptions,
  overlayPath: string
): Promise<void> {
  const store = await readTrustStore(options);
  if (path.resolve(overlayPath) in store.overlays) {
    await recordOverlayTrust(options, overlayPath);
  }
}

export async function trustLocalOverlays(options: DiscoverRootsOptions = {}): Promise<OverlayTrust[]> {
  const locals = await discoverLocalOverlays(options);
  for (const overlay of locals) {
    await recordOverlayTrust(options, overlay);
  }
  return locals.map((overlay) => ({ path: overlay, state: "trusted" as const }));
}

export async function untrustLocalOverlays(options: DiscoverRootsOptions = {}): Promise<OverlayTrust[]> {
  const locals = await discoverLocalOverlays(options);
  const removed: OverlayTrust[] = [];
  for (const overlay of locals) {
    if (await removeOverlayTrust(options, overlay)) {
      removed.push({ path: overlay, state: "untrusted" });
    }
  }
  return removed;
}

export async function localOverlayTrust(options: DiscoverRootsOptions = {}): Promise<OverlayTrust[]> {
  const locals = await discoverLocalOverlays(options);
  const overlays: OverlayTrust[] = [];
  for (const overlay of locals) {
    overlays.push({ path: overlay, state: await overlayTrustState(options, overlay) });
  }
  return overlays;
}

async function discoverLocalOverlays(options: DiscoverRootsOptions): Promise<string[]> {
  const roots = await discoverRoots(options);
  return roots.filter((root) => root.scope === "local").map((root) => root.path);
}

async function readTrustStore(options: DiscoverRootsOptions): Promise<TrustStore> {
  try {
    const raw = await readFile(trustStorePath(options), "utf8");
    const parsed = JSON.parse(raw) as TrustStore;
    if (parsed.version !== 1 || typeof parsed.overlays !== "object" || parsed.overlays === null) {
      return structuredClone(emptyStore);
    }
    return parsed;
  } catch (error) {
    if (isMissing(error)) {
      return structuredClone(emptyStore);
    }
    if (error instanceof SyntaxError) {
      throw new CliError("INVALID_ARGS", `Trust store is not valid JSON: ${trustStorePath(options)}`);
    }
    throw error;
  }
}

async function writeTrustStore(options: DiscoverRootsOptions, store: TrustStore): Promise<void> {
  const file = trustStorePath(options);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function collectFiles(directory: string): Promise<Array<{ relative: string; digest: string }>> {
  const results: Array<{ relative: string; digest: string }> = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
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
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(absolute);
        results.push({ relative, digest: sha256(`link:${target}`) });
      } else if (entry.isFile()) {
        results.push({ relative, digest: sha256(await readFile(absolute)) });
      }
    }
  }

  await walk(directory);
  return results;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
