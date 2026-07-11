# @async/cli API Reference

The complete public API. Everything documented here is importable from the
root export; there are no other entry points (`@async/cli/cli` is the binary
implementation and not a stable API). Routing semantics are specified in
[ROUTING.md](ROUTING.md).

## Package

| | |
| --- | --- |
| Package | `@async/cli` |
| Runtime | Node `>=24`, ESM only |
| Runtime dependencies | none |
| Types | shipped (`.d.ts`) |
| Binaries | `cli`, `async-cli` (identical) |

```js
import {
  discoverRoots, listCommands, resolveCommand, runCommand,
  createCommand, removeCommand, copyCommand, moveCommand, addPack,
  trustLocalOverlays, untrustLocalOverlays, localOverlayTrust,
  runDoctor, complete, completionScript, runMcpServer,
  CliError, packageInfo
} from "@async/cli";
```

## Conventions

- Every function that touches the filesystem is async and takes an options
  object as its first parameter.
- All options objects extend `DiscoverRootsOptions`; the three base fields
  control where discovery happens and default to the real process context:

```ts
interface DiscoverRootsOptions {
  cwd?: string;              // default process.cwd()
  env?: NodeJS.ProcessEnv;   // default process.env
  home?: string;             // default env.HOME, then os.homedir()
}
```

- Expected failures throw `CliError`; anything else (I/O errors, bugs) throws
  natively. Catch `CliError` to handle user-facing failures:

```js
try {
  await runCommand({}, ["gh", "pull"]);
} catch (error) {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
```

## Errors

### `CliError`

```ts
class CliError extends Error {
  code: CliErrorCode;     // machine-readable discriminator
  exitCode: number;       // suggested process exit code (default 2)
  suggestions: string[];  // near-miss commands or fix-it commands
  subcommands: string[];  // children of a partial namespace
  files: string[];        // conflicting or affected file paths
}
```

### `CliErrorCode`

| Code | Meaning | Exit |
| --- | --- | --- |
| `UNKNOWN_COMMAND` | No root has a runnable prefix; `suggestions` may help | 2 |
| `PARTIAL_NAMESPACE` | Prefix exists but is not runnable; see `subcommands` | 2 |
| `AMBIGUOUS_SCRIPT` | More than one `script.*` in a directory; see `files` | 2 |
| `UNSAFE_SEGMENT` | Rejected command word, template name, or prefix | 2 |
| `MISSING_GIT_ROOT` | Context-file placement needs a Git root and none was found | 2 |
| `TARGET_EXISTS` | Refusing to overwrite; `--force`-gated where supported | 2 |
| `SOURCE_NOT_FOUND` | No matching command directory to act on | 2 |
| `UNTRUSTED_OVERLAY` | Execution blocked by the trust gate | 3 |
| `TEMPLATE_NOT_FOUND` | `--template` name unknown; `suggestions` lists known | 2 |
| `TEMPLATE_INVALID` | Template produced no runnable `script.*` | 2 |
| `PACK_INVALID` | Source is not a command pack | 2 |
| `GIT_FAILED` | `git clone` failed; message carries the git error tail | 2 |
| `EDITOR_FAILED` | `$VISUAL`/`$EDITOR` could not be launched | 2 |
| `INVALID_ARGS` | Bad flag value, bad `cli-cwd` pragma, corrupt trust store | 2 |

## Core types

```ts
interface CommandRoot {
  path: string;                  // absolute path of the command tree
  scope: "local" | "root";       // overlay vs user-global
  projectRoot: string | null;    // explicit override or overlay-derived context
}

interface CommandEntry {
  command: string;               // words joined with spaces, e.g. "gh pull"
  script: string;                // absolute script path
  scope: "local" | "root";
  description: string;           // first-line "// cli:" text, or ""
  shadows: string[];             // script paths this command hides
  shadowed: boolean;             // true when a nearer overlay hides this one
}

interface CommandList {
  version: 1;
  roots: CommandRoot[];          // in discovery (precedence) order
  commands: CommandEntry[];      // sorted by command, then script
}

interface CommandResolution {
  command: string[];             // matched command words
  script: string;                // selected script
  argv: string[];                // words the script will receive
  root: CommandRoot;             // root that selected the command
  shadows: string[];             // scripts hidden by this selection
}
```

## Discovery and inspection

### `discoverRoots(options?)`

```ts
discoverRoots(options?: DiscoverRootsOptions): Promise<CommandRoot[]>
```

Returns command roots in precedence order: local overlays nearest-first from
`cwd` through the filesystem root, then the configured user-global root
exactly once. The global root is excluded from the local walk even when it is
an ancestor. Pure discovery — never throws for missing directories and never
consults `.git`.

For a local root, `projectRoot` is `ASYNC_CLI_PROJECT_ROOT` when set, otherwise
the directory that owns `.cli`. For the global root it is the override,
otherwise the nearest local owner, then `cwd`.

### `listCommands(options?)`

```ts
listCommands(options?: ListCommandsOptions): Promise<CommandList>
```

The machine-readable inventory behind `cli --list --json`. Includes shadowed
entries (marked, with `shadows` cross-references) so tools can render the
full picture. Throws `AMBIGUOUS_SCRIPT` if any directory in any root has
multiple `script.*` files.

```json
{
  "version": 1,
  "roots": [
    { "path": "/repo/.cli", "scope": "local", "projectRoot": "/repo" },
    { "path": "/home/u/.cli", "scope": "root", "projectRoot": "/repo" }
  ],
  "commands": [
    {
      "command": "gh pull",
      "script": "/repo/.cli/gh/pull/script.ts",
      "scope": "local",
      "description": "Open a PR against main",
      "shadows": ["/home/u/.cli/gh/pull/script.ts"],
      "shadowed": false
    }
  ]
}
```

### `resolveCommand(options, args)`

```ts
resolveCommand(options: ResolveCommandOptions, args: string[]): Promise<CommandResolution>
```

Applies the routing rules (nearest root with a runnable prefix, longest
runnable prefix within that root, `--` forwarding) without executing anything
and without checking trust. Namespace-only matches fall through to later
roots. Resolution reads the live filesystem every time; there is no persistent
or time-based command-path cache. Use it for "what would run?" tooling;
`cli --which` is a thin wrapper.

Throws `UNKNOWN_COMMAND`, `PARTIAL_NAMESPACE`, `AMBIGUOUS_SCRIPT`, or
`UNSAFE_SEGMENT`.

### `complete(options, words)` / `completionScript(shell)` / `builtinFlags`

```ts
complete(options: ListCommandsOptions, words: string[]): Promise<string[]>
completionScript(shell: string): string   // "bash" | "zsh" | "fish"
builtinFlags: readonly string[]
```

`complete` treats the last word as the partial being typed (may be `""`) and
returns sorted next-segment candidates below the preceding words, hiding
shadowed commands. A single word starting with `-` completes against
`builtinFlags` instead. `completionScript` returns the shell script that
delegates to `cli --complete`; unknown shells throw `INVALID_ARGS`.

## Execution

### `runCommand(options?, args)`

```ts
interface RunCommandOptions extends DiscoverRootsOptions {
  stdio?: "inherit" | "pipe";   // default "inherit"
}
runCommand(options: RunCommandOptions, args: string[]): Promise<number>
```

Resolve, check trust, execute. Returns the script's exit code (`128 + signal`
for fatal signals); SIGINT/SIGTERM received by the runner are forwarded to
the child. The script's working directory honors its `// cli-cwd:` pragma;
`CLI_*` environment values are injected (see ROUTING.md for the table).
`options.env` entries are added to — not a replacement for — the runner's
environment.

Throws everything `resolveCommand` throws, plus `UNTRUSTED_OVERLAY` (exit
code 3) when the selected overlay is local and not trusted, and
`INVALID_ARGS` for an unknown `cli-cwd` pragma value.

### `executeResolution(resolution, options?)`

```ts
executeResolution(resolution: CommandResolution, options?: RunCommandOptions): Promise<number>
```

The execution half of `runCommand` for callers that already resolved (and
made their own trust decision). Skips the trust gate — prefer `runCommand`
unless that is what you want.

### `readCwdPragma(script)` / `resolveScriptCwd(resolution, callerCwd)`

```ts
type ScriptCwdMode = "caller" | "project-root" | "script-dir";
readCwdPragma(script: string): Promise<ScriptCwdMode>
resolveScriptCwd(resolution: CommandResolution, callerCwd: string): Promise<string>
```

`readCwdPragma` scans the first 16 lines for `// cli-cwd: <mode>` and returns
`"caller"` when absent; unknown values throw `INVALID_ARGS`.
`resolveScriptCwd` turns the pragma into an absolute directory
(`project-root` uses the explicit override, selected local overlay owner, or
for a global command the nearest local owner then `callerCwd`).

## Authoring and lifecycle

### `createCommand(options?, commandPath)`

```ts
interface CreateCommandOptions extends DiscoverRootsOptions {
  root?: "auto" | "root" | "local";  // default "auto"
  template?: string;                 // copy _templates/<name> instead of scaffold
}
interface CreateCommandResult {
  command: string[]; directory: string; script: string; root: CommandRoot;
}
createCommand(options: CreateCommandOptions, commandPath: string[]): Promise<CreateCommandResult>
```

Target selection under `"auto"`: the nearest existing local overlay; when none
exists, `ASYNC_CLI_PROJECT_ROOT/.cli` or `cwd/.cli`. Pass `root: "root"` for
the user-global tree. Default scaffold writes `script.ts`. With `template`,
`_templates/<name>/` is searched across roots nearest-local first and copied
verbatim; the copy must yield exactly one top-level `script.*`.

Throws `UNSAFE_SEGMENT`, `TARGET_EXISTS`, `TEMPLATE_NOT_FOUND` (with
`suggestions`), `TEMPLATE_INVALID`.

### `removeCommand(options?, commandPath)`

```ts
interface RemoveCommandOptions extends DiscoverRootsOptions {
  root?: "auto" | "root";   // default "auto" = nearest local match
  force?: boolean;          // required when nested commands exist
}
interface RemoveCommandResult {
  command: string[]; directory: string; root: CommandRoot; nested: string[];
}
removeCommand(options: RemoveCommandOptions, commandPath: string[]): Promise<RemoveCommandResult>
```

Removes the whole command directory and prunes now-empty parents up to the
root. When the directory contains nested runnable commands, throws
`TARGET_EXISTS` listing them in `files` unless `force`. Also throws
`UNSAFE_SEGMENT`, `SOURCE_NOT_FOUND`.

### `copyCommand(options?, commandPath)` / `moveCommand(options?, commandPath)`

```ts
interface CopyCommandOptions extends DiscoverRootsOptions { to?: "root" | "local"; }
interface CopyCommandResult {
  command: string[]; from: string; to: string; warnings: string[];
}
copyCommand(options: CopyCommandOptions, commandPath: string[]): Promise<CopyCommandResult>
moveCommand(options: MoveCommandOptions, commandPath: string[]): Promise<MoveCommandResult>
```

Transfer a whole command directory between the nearest matching local overlay
and the user-global tree (`to` defaults to `"root"`). The command path is
preserved; existing targets are refused; sibling `lib/`/`_lib/` directories
are not carried along; `warnings` flags scripts importing through `../`,
which may not survive the transfer. `moveCommand` additionally prunes empty
source parents.

For `to: "local"`, the destination is the nearest existing local overlay;
when none exists, `ASYNC_CLI_PROJECT_ROOT/.cli` or `cwd/.cli`.

Throws `UNSAFE_SEGMENT`, `SOURCE_NOT_FOUND`, `TARGET_EXISTS`.

### `findRunnableScript(directory)`

```ts
findRunnableScript(directory: string): Promise<string | null>
```

Returns the directory's single `script.{ts,mts,js,mjs}`, `null` when there is
none, and throws `AMBIGUOUS_SCRIPT` when there are several.

### `availableTemplates(roots)`

```ts
availableTemplates(roots: CommandRoot[]): Promise<string[]>
```

Sorted union of `_templates/` entries across the given roots (pass the result
of `discoverRoots`).

### `resolveScopedRoot(options, scope)`

```ts
resolveScopedRoot(options: DiscoverRootsOptions, scope: "root" | "local"): Promise<CommandRoot>
```

The user-global root, or the nearest existing local `.cli`. When no local root
exists, the local result is `ASYNC_CLI_PROJECT_ROOT/.cli` or `cwd/.cli`.
Useful for computing install targets the same way `--cp`, `--mv`, and `--add`
do.

## Trust

Trust state lives in `.trust.json` under the user-global root, keyed by
absolute overlay path:

```json
{
  "version": 1,
  "overlays": {
    "/repo/.cli": { "hash": "sha256:...", "trustedAt": "2026-07-06T00:00:00.000Z" }
  }
}
```

The hash covers every file under the overlay (scripts, `lib/`, templates —
everything), so any content change invalidates trust.

```ts
type OverlayTrustState = "trusted" | "changed" | "untrusted";
interface OverlayTrust { path: string; state: OverlayTrustState; }

trustLocalOverlays(options?): Promise<OverlayTrust[]>    // trust all discovered local overlays
untrustLocalOverlays(options?): Promise<OverlayTrust[]>  // revoke; returns what was removed
localOverlayTrust(options?): Promise<OverlayTrust[]>     // report state per local overlay
overlayTrustState(options, overlayPath): Promise<OverlayTrustState>
ensureOverlayTrusted(options, overlayPath): Promise<void> // throws UNTRUSTED_OVERLAY (exit 3)
recordOverlayTrust(options, overlayPath): Promise<void>   // hash now and store
removeOverlayTrust(options, overlayPath): Promise<boolean>
hashOverlayTree(overlayPath): Promise<string>             // "sha256:<hex>"
isTrustEnforced(env?): boolean                            // false when ASYNC_CLI_TRUST=off
trustStorePath(options?): string
```

`ensureOverlayTrusted` is a no-op when enforcement is off. A corrupt store
throws `INVALID_ARGS` rather than failing open.

## Doctor

```ts
type DoctorSeverity = "error" | "warning" | "info";
interface DoctorProblem {
  severity: DoctorSeverity;
  code: string;        // e.g. "ambiguous-script", "untrusted-overlay"
  message: string;
  path?: string;
}
interface DoctorReport {
  version: 1;
  problems: DoctorProblem[];
  summary: { errors: number; warnings: number; infos: number };
}

runDoctor(options?: DiscoverRootsOptions): Promise<DoctorReport>
renderDoctorReport(report: DoctorReport): string
```

Problem codes: `ambiguous-script` and `trust-store` (errors);
`escaping-import`, `empty-command-dir`, `untrusted-overlay`,
`changed-overlay`, `agents-drift` (warnings); `missing-description`,
`shadowed-command`, `agents-missing` (infos). `runDoctor` never throws for
tree problems — it reports them. The CLI exits 1 when `summary.errors > 0`.

## MCP

```ts
interface McpIo {
  input: NodeJS.ReadableStream;              // default process.stdin
  output: Pick<NodeJS.WriteStream, "write">; // default process.stdout
}
runMcpServer(options?: DiscoverRootsOptions, io?: McpIo): Promise<number>
```

A zero-dependency Model Context Protocol server over newline-delimited
JSON-RPC 2.0. Handles `initialize`, `ping`, `tools/list`, and `tools/call`;
resolves when the input stream ends. Non-shadowed commands become tools named
by joining words with `__` and sanitizing to `[a-zA-Z0-9_-]` (`gh pull` →
`gh__pull`; collisions get `-2`, `-3`, ...). Each tool accepts
`{ "args": string[] }`. Calls capture stdout/stderr (1 MiB cap each) and
report nonzero exits as `isError: true`. Untrusted local overlays are
excluded from listing and refused at call time, with trust rechecked against
the resolved overlay before execution. The connected stdio client is trusted
to invoke every listed command; narrower tool approval belongs in the MCP
host.

## Packs

```ts
interface AddPackOptions extends DiscoverRootsOptions {
  to?: "root" | "local";  // default "root"
  prefix?: string;        // install the whole pack under one namespace
  force?: boolean;        // replace conflicting command directories
}
interface AddPackResult {
  source: string; root: CommandRoot; installed: string[];
}
addPack(options: AddPackOptions, source: string): Promise<AddPackResult>
```

Shallow-clones `source` (anything `git clone` accepts) into a temp directory,
takes its `.cli/` tree, and installs each top-level command directory into
the target root — or the whole tree under `prefix`. The conflict check is
all-or-nothing before anything is copied. The temp clone is always removed.

Throws `INVALID_ARGS`, `UNSAFE_SEGMENT` (bad prefix), `GIT_FAILED`,
`PACK_INVALID` (no `.cli/`, nothing installable, or a root-level command
without `prefix`), `TARGET_EXISTS` (with conflicting paths in `files`),
and clone-related I/O failures. For `to: "local"`, target selection follows
`resolveScopedRoot` and does not require Git.

Note: `addPack` does not record trust. The `cli --add --to local` command
layers that on as an explicit consent action.

## Metadata and rendering

```ts
packageInfo: {
  name: "@async/cli"; version: string; node: ">=24";
  binaries: ["cli", "async-cli"]; specVersion: number;
  routerStatus: "implemented"; contextPointerStatus: "implemented";
}
renderHelp(commands?: string[]): string  // the "cli help" text
```

## CLI to API mapping

| CLI | API |
| --- | --- |
| `cli <words...>` | `runCommand({}, words)` |
| `cli --list --json` | `listCommands()` |
| `cli --which <words...>` | `resolveCommand({}, words)` |
| `cli --new <words...> [--template t]` | `createCommand({ template }, words)` |
| `cli --rm <words...> [--force]` | `removeCommand({ force }, words)` |
| `cli --cp <words...> --to local` | `copyCommand({ to: "local" }, words)` |
| `cli --mv <words...> --to local` | `moveCommand({ to: "local" }, words)` |
| `cli --add <src> [--prefix p]` | `addPack({ prefix }, src)` |
| `cli --trust` | `trustLocalOverlays()` |
| `cli --trust --status` | `localOverlayTrust()` |
| `cli --untrust` | `untrustLocalOverlays()` |
| `cli --doctor --json` | `runDoctor()` |
| `cli --complete -- <words...>` | `complete({}, words)` |
| `cli --completions <shell>` | `completionScript(shell)` |
| `cli --mcp` | `runMcpServer()` |

`cli --edit` and `cli --agents` are CLI-only conveniences.

## Environment variables

| Variable | Read by | Effect |
| --- | --- | --- |
| `ASYNC_CLI_GLOBAL_ROOT` | discovery, trust store | Replaces `~/.cli` |
| `ASYNC_CLI_PROJECT_ROOT` | project context, local write targets | Overrides `projectRoot` and the no-overlay local fallback; does not bound discovery |
| `ASYNC_CLI_TRUST` | trust gate | `off` disables enforcement |
| `VISUAL`, `EDITOR` | `cli --edit` | Editor command (first non-empty wins) |
| `CLI_*` | injected into scripts | See ROUTING.md |
