# ADR 0: Filesystem Router CLI

Status: accepted
Package: cli
Date: 2026-07-02
Amended: 2026-07-06 (v0.2 surface: trust model, completions, --edit/--rm,
templates, cli-cwd pragma, --doctor, MCP server mode, command packs)

## Context

Projects need a low-friction way to keep small operational commands close to
the repository that owns them while still allowing proven commands to become
user-global tools. Package scripts, Makefiles, and one-off shell aliases all
cover parts of this need, but they do not provide one consistent local-first
lookup rule, a portable command directory shape, or a stable machine-readable
inventory for developer tools.

`@async/cli` will provide a small Node package and binary that treats command
directories as the CLI surface. The same command shape works in a repo-local
`.cli/` overlay and in the user-global `~/.cli` tree.

## Decision

Create `async/cli` as the package for `@async/cli`. It exposes a Node 24+ `cli`
binary that routes shell words to filesystem scripts.

```sh
cli gh pull
```

runs:

```text
.cli/gh/pull/script.ts
```

Commands are directory-backed. A command directory is runnable only when it
contains exactly one `script.{ts,mts,js,mjs}` file.

### Command Discovery

- Start from the caller's current working directory.
- Walk upward collecting `.cli/` directories, nearest first.
- Continue through the caller's home directory to the filesystem root. Git
  repositories do not bound command discovery.
- Never collect the configured user-global root during upward local discovery.
- Append `~/.cli` exactly once as the root command tree.
- Allow `ASYNC_CLI_GLOBAL_ROOT` to replace `~/.cli` for tests and advanced use.
- Allow `ASYNC_CLI_PROJECT_ROOT` to override script project context and the
  fallback destination for local writes. It does not bound discovery.

Each local `CommandRoot.projectRoot` is the explicit override when set,
otherwise the directory that owns that `.cli`. The user-global root uses the
override, otherwise the nearest local owner, then the caller's working
directory.

Ignored path segments during discovery, routing, help, listing, and suggestions:

```text
help
lib
node_modules
.*
_*
```

`script` is not reserved as a command segment. This is valid:

```text
.cli/foo/script.js
.cli/foo/script/script.js
```

Leading `_` marks private helper paths. Names containing underscores remain
valid command segments.

### Command Resolution

- Command words map to nested directories.
- In each root, resolution uses the longest runnable command prefix.
- A matching namespace with no runnable prefix does not capture the request;
  search continues to the next root.
- The first root with a runnable prefix wins. A nearer runnable command shadows
  parent and root matches, even if the shadowed command is deeper.
- If no local overlay has a runnable prefix, fall back to the root command tree.
- Remaining arguments are forwarded unchanged to the script.
- `--` ends command routing early and forwards everything after it.
- Multiple `script.*` files in one command directory fail as ambiguous.
- `--list` and `--which` show all shadowing layers, including nested local
  overlays.
- Resolution reads the live filesystem on every invocation. There is no
  persistent or time-based command-path cache.

Example:

```sh
cli gh pull 123 --rebase
```

resolves to:

```text
command: gh pull
script argv: ["123", "--rebase"]
```

Runnable-prefix shadowing is deliberate. If local `.cli/gh/script.ts` exists,
then:

```sh
cli gh clone x
```

runs the local `gh` command with:

```text
["clone", "x"]
```

even when `~/.cli/gh/clone/script.ts` exists.

By contrast, a local `.cli/gh/` directory without a runnable prefix does not
block the global `gh clone` command.

### Script Contract

Scripts are standalone Node ESM programs.

- Default scaffold is `script.ts`.
- `.js` and `.mjs` run directly with Node.
- `.ts` and `.mts` run through Node 24 native type stripping.
- TypeScript syntax that Node cannot strip, such as `enum` or `namespace`,
  fails with Node's own error.
- Scripts read arguments from `process.argv.slice(2)`.
- Scripts run from the caller's original working directory by default.
- Stdio is inherited.
- Exit codes and signals are propagated.
- Scripts own their own validation, prompts, and task-specific help.

The runner injects:

```text
CLI_SCRIPT
CLI_ROOT
CLI_SCOPE
CLI_PROJECT_ROOT
CLI_COMMAND
CLI_CALLER_CWD
```

### Working Directory Pragma

A head-of-file comment within the first 16 lines selects the script's working
directory:

```js
// cli-cwd: project-root
```

Values:

- `caller` (default): the caller's original working directory.
- `project-root`: `ASYNC_CLI_PROJECT_ROOT` when set; otherwise the selected
  local overlay's owning directory. For a global command, use the nearest
  local overlay owner, then the caller's working directory.
- `script-dir`: the command directory containing the script.

Unknown values fail with an actionable error. `CLI_CALLER_CWD` always carries
the caller's original working directory regardless of the pragma.

### Descriptions

If the first line of `script.*` is a comment of the form:

```js
// cli: Open a pull request against main
```

the one-line description appears in `help`, `--list`, `--list --json`, and the
managed context pointer output. Missing descriptions are represented as empty
strings in JSON.

### Built-In Commands

The built-in surface is:

```sh
cli
cli help
cli help gh
cli --list
cli --list --json
cli --which gh pull
cli --new gh pr
cli --new gh pr --root
cli --new gh pr --template worker
cli --edit gh pull
cli --rm gh pull
cli --rm gh pull --root
cli --rm gh --force
cli --cp gh pull
cli --cp gh pull --to root
cli --cp gh pull --to local
cli --mv gh pull
cli --mv gh pull --to root
cli --mv gh pull --to local
cli --add https://example.com/org/pack.git
cli --add https://example.com/org/pack.git --to local
cli --add https://example.com/org/pack.git --prefix vendor
cli --trust
cli --trust --status
cli --untrust
cli --doctor
cli --doctor --json
cli --completions bash
cli --complete -- gh pu
cli --mcp
cli --agents
cli --agents --write
cli --agents --check
cli --agents --claude
cli --version
```

- `cli` prints help and the available command tree.
- `cli help` prints usage.
- `cli help <prefix>` lists matching subcommands below that prefix.
- `cli --list` prints all visible commands and marks shadowed commands.
- `cli --list --json` prints the stable programmatic listing.
- `cli --which <cmd...>` prints the selected script and shadowed alternatives.
- `cli --new <cmd...>` creates a command directory with `script.ts`.
- `cli --new <cmd...> --root` creates under the root command tree.
- `cli --cp <cmd...>` defaults to `--to root`.
- `cli --cp <cmd...> --to root` copies the nearest matching local command
  directory into the root command tree.
- `cli --cp <cmd...> --to local` copies a root command directory into the
  nearest existing local `.cli`, or the local fallback target.
- `cli --mv <cmd...>` defaults to `--to root`.
- `cli --mv <cmd...> --to root` moves the nearest matching local command
  directory into the root command tree.
- `cli --mv <cmd...> --to local` moves a root command directory into the
  nearest existing local `.cli`, or the local fallback target.
- `cli --edit <cmd...>` opens the resolved script in `$VISUAL` or `$EDITOR`
  (falling back to `vi`).
- `cli --rm <cmd...>` removes the whole command directory from the nearest
  matching local overlay (or the root tree with `--root`) and prunes empty
  parents. Directories containing nested commands require `--force`.
- `cli --add <git-url>` installs a command pack (see Command Packs).
- `cli --trust`, `cli --untrust`, and `cli --trust --status` manage local
  overlay trust (see Trust Model).
- `cli --doctor` audits the command trees (see Doctor).
- `cli --completions <shell>` and the hidden `cli --complete` helper provide
  shell completions (see Completions).
- `cli --mcp` serves the command tree over MCP stdio (see MCP Server Mode).
- `cli --agents` manages repo context file discoverability.

`--new` target selection:

- Use the nearest existing local `.cli` if one exists.
- Otherwise create under `ASYNC_CLI_PROJECT_ROOT/.cli` when the override is
  set, or under the caller's `.cli`.
- `--root` explicitly selects the user-global tree.

The same local target selection applies to `--cp --to local`,
`--mv --to local`, and `--add --to local`.

### Templates

`cli --new <cmd...> --template <name>` copies a template directory instead of
writing the default scaffold:

- Templates live in `_templates/<name>/` under any command root, searched
  nearest-local first, then the user-global tree.
- The leading underscore keeps `_templates` out of routing, listing, and help.
- A template directory is copied verbatim and must produce exactly one
  top-level `script.{ts,mts,js,mjs}` in the new command directory.
- A missing template fails and lists the available template names.

Move rules:

- Move the whole command directory.
- Preserve the command path.
- Refuse to overwrite an existing target unless a future `--force` option is
  added.
- Remove empty source parents after moving.
- Do not copy sibling `lib/` or `_lib/` directories.
- Warn if `script.*` has relative imports escaping the command directory via
  `../`, because the command may not survive a move cleanly.

Copy rules:

- Copy the whole command directory.
- Preserve the command path.
- Refuse to overwrite an existing target unless a future `--force` option is
  added.
- Do not copy sibling `lib/` or `_lib/` directories.
- Warn if `script.*` has relative imports escaping the command directory via
  `../`, because the command may not survive a copy cleanly.

### Agent Integration

`.cli` commands are human-first, but coding tools working inside a repo should
discover and prefer them over ad-hoc equivalents. The committed pointer block is
how repo context files tell tools that the live command tree exists.

Default target is the Git repository root `AGENTS.md`. `--claude` explicitly
targets `CLAUDE.md`. Context-file placement is the only feature that searches
for a `.git` boundary; its doctor audit reuses that lookup. Command discovery
and local write selection do not. There is no arbitrary file target in v1.

```sh
cli --agents
cli --agents --write
cli --agents --check
cli --agents --claude
cli --agents --claude --write
cli --agents --claude --check
```

`cli --agents` prints the managed block for the selected target. `--write`
upserts it idempotently between markers in the selected file, creating the file
when missing. `--check` exits nonzero if the block is missing or outdated.

Managed block:

```md
<!-- async-cli:begin -->
## Project commands (async/cli)
This repo defines runnable commands under `.cli/` (plus user-global `~/.cli`),
executed via the `cli` binary from `@async/cli`.
- Discover: `cli --list --json` (commands, descriptions, script paths)
- Inspect:  `cli --which <words...>`
- Run:      `cli <words...> [args...]` (e.g. `cli gh pull 123`)
Prefer a matching `.cli` command over improvising the same task.
<!-- async-cli:end -->
```

The block is a static pointer by design. The live tree comes from `--list`, so
committed docs do not need to embed command listings.

### Completions

`cli --completions <bash|zsh|fish>` prints a completion script for the given
shell. The scripts delegate to the hidden helper:

```sh
cli --complete -- <words...>
```

which prints one candidate per line: next command segments below the typed
prefix, filtered to non-shadowed commands, or built-in flags when the first
word starts with `-`. Completion never executes scripts and never fails
loudly; errors produce no candidates.

### Doctor

`cli --doctor [--json]` audits every discovered command root and reports:

- errors: ambiguous command directories with multiple `script.*` files, and an
  unreadable trust store.
- warnings: scripts importing through `../`, empty command directories,
  untrusted or changed local overlays, and outdated managed context blocks.
- infos: missing `// cli:` descriptions, shadowed commands, and repos with no
  context pointer at all.

Exit code is 1 when any error is present, otherwise 0. `--json` emits
`{ version, problems, summary }` for tooling.

### MCP Server Mode

`cli --mcp` runs a Model Context Protocol server over stdio using
newline-delimited JSON-RPC 2.0, with zero runtime dependencies. It handles
`initialize`, `ping`, `tools/list`, and `tools/call`.

- Every non-shadowed command becomes a tool. Command words are joined with
  `__` and sanitized to MCP-safe names (`gh pull` becomes `gh__pull`).
- Tool descriptions come from the `// cli:` line.
- Each tool accepts `{ "args": ["..."] }` and forwards them to the script.
- `tools/call` captures stdout and stderr (capped at 1 MiB each) and reports
  nonzero exits as `isError: true`.
- Commands from untrusted local overlays are excluded from `tools/list` and
  refused at call time while trust enforcement is active. Trust is rechecked
  against the resolved local overlay immediately before execution.
- MCP stdio is a trusted-client boundary: starting the server authorizes the
  connected client to invoke every listed command and pass arguments. The MCP
  host owns any narrower per-call approval policy.

### Command Packs

`cli --add <git-url> [--to root|local] [--prefix <name>] [--force]` installs
commands from another repository:

- The source is anything `git clone` accepts. Cloning is shallow and lands in
  a temporary directory that is always cleaned up.
- The pack's command tree is its `.cli/` directory; a repo without `.cli/` is
  not a pack.
- Without `--prefix`, each top-level command directory installs under the
  target tree. A pack with a runnable command at its `.cli/` root requires
  `--prefix`.
- With `--prefix <name>`, the whole pack tree installs under that single
  namespace directory.
- Existing target directories are refused unless `--force`, which replaces
  them whole.
- The default target is the user-global tree. `--to local` installs into the
  nearest existing local `.cli`; when none exists, it uses
  `ASYNC_CLI_PROJECT_ROOT/.cli` or the caller's `.cli`. It records trust for
  that overlay, since the install is an explicit consent action.

### Machine-Readable Listing

`cli --list --json` is the stable machine-discovery surface. It inspects the
live filesystem without executing commands or requiring overlay trust:

```json
{
  "version": 1,
  "roots": [{ "path": "/repo/.cli", "scope": "local" }],
  "commands": [
    {
      "command": "gh pull",
      "script": "/repo/.cli/gh/pull/script.ts",
      "scope": "local",
      "description": "Open a PR against main",
      "shadows": []
    }
  ]
}
```

`shadows` lists script paths this command hides across overlays.

### Package Surface

- Repo: `async/cli`
- Package: `@async/cli`
- Binaries: `cli`, `async-cli`
- Exports:
  - `discoverRoots(options)`
  - `listCommands(options)`
  - `resolveCommand(options, args)`
  - `runCommand(options, args)`
  - `createCommand(options, commandPath)`
  - `copyCommand(options, commandPath)`
  - `moveCommand(options, commandPath)`
  - `removeCommand(options, commandPath)`
  - `addPack(options, source)`
  - `runDoctor(options)`
  - `complete(options, words)` and `completionScript(shell)`
  - `runMcpServer(options, io)`
  - trust helpers: `trustLocalOverlays`, `untrustLocalOverlays`,
    `localOverlayTrust`, `overlayTrustState`, `recordOverlayTrust`,
    `removeOverlayTrust`, `ensureOverlayTrusted`, `hashOverlayTree`,
    `isTrustEnforced`, `trustStorePath`

Environment overrides:

```text
ASYNC_CLI_GLOBAL_ROOT
ASYNC_CLI_PROJECT_ROOT
ASYNC_CLI_TRUST        (set to "off" to disable trust enforcement)
```

### Errors

- Unknown command: concise error, nearest suggestions, and `cli help` hint.
- Partial namespace: list available subcommands below the matched prefix.
- Ambiguous `script.*` directory: list the conflicting files.
- Unsafe path segment in routing, `--new`, `--rm`, `--cp`, `--mv`, or
  `--add --prefix`: reject empty segments, `.`, `..`, absolute paths, path
  separators, ignored names, hidden segments, and leading-underscore segments.
- No Git root for `--agents`: print an actionable message. Git is not required
  for command discovery or local lifecycle destinations.
- Untrusted or changed local overlay at execution time: exit 3 with a
  `cli --trust` hint.
- Missing template: exit nonzero listing available template names.
- Invalid pack or failed `git clone`: exit nonzero with the git error tail.
- `--agents --check` drift: exit nonzero with a `cli --agents --write` hint.
- Script failure: preserve the script's own exit code.

### Trust Model

`.cli` scripts are arbitrary code, equivalent to package scripts or Makefiles,
and local overlays arrive with cloned repositories. Because a nearer local
overlay can shadow user-global commands, running commands from an untrusted
overlay is refused by default — the direnv model.

- The user-global tree is always trusted.
- Local overlays must be trusted explicitly with `cli --trust`, which records
  a content hash of the whole overlay tree (scripts, `lib/`, everything) in
  `.trust.json` under the user-global root. Symlink paths and linked file or
  directory contents are covered; cyclic directory links are rejected.
- Any content change invalidates trust: execution fails with exit 3 until the
  user reviews and re-runs `cli --trust`.
- `cli --trust --status` reports `trusted`, `changed`, or `untrusted` per
  overlay. `cli --untrust` revokes trust.
- Read-only surfaces (`--list`, `--which`, `help`, completions) never require
  trust; execution surfaces (`cli <cmd>`, MCP `tools/call`) always check it.
- Mutations performed through the CLI are consent: `--new`, `--cp --to local`,
  `--mv --to local`, and `--add --to local` record or refresh trust for the
  target overlay when it is fresh or was already trusted. They never silently
  bless a pre-existing untrusted overlay.
- `ASYNC_CLI_TRUST=off` disables enforcement for tests and controlled
  environments.

## Non-Goals

- Argument parsing for user scripts.
- Generated per-command help from script metadata.
- Interactive trust prompts; trust is explicit via `cli --trust`.
- Non-JavaScript entrypoints such as `.sh` or `.py`.
- Runtime dependency management for scripts.
- Cross-platform shell launcher behavior beyond Node process spawning.
- Arbitrary context files for `--agents`; only `AGENTS.md` and explicit
  `--claude` are in scope.
- A hosted pack registry; packs are plain Git repositories.

## Allowed Files

- `_docs/cli/ADR_0.md`
- `_docs/cli/ADR_1_root_package.md`
- `_docs/cli/ADR_2_router_runtime.md`
- `_docs/cli/ADR_3_agent_integration.md`
- future `cli/**` files described by the later ADR slices

## Verification

- ADR review against this charter.
- Future package verification defined by ADR 1 through ADR 3.
- Public wording leakage scan before docs are treated as complete.

## Acceptance Criteria

- The active ADR set exists under `_docs/cli/`.
- ADR 0 defines the package charter and full v1 behavior.
- Later ADRs break implementation into scaffold, router/runtime, and agent
  integration slices.
- Each implementation slice names allowed files, verification commands, and stop
  conditions.

## Stop Conditions

- Stop if an existing active or archived CLI ADR conflicts with this charter.
- Stop if a real `async/cli` repository already exists with incompatible
  package scope or command semantics.
- Stop before adding runtime dependencies for TypeScript execution unless Node
  24 native type stripping cannot satisfy the accepted v1 contract.
