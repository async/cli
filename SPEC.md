# ADR 0: Filesystem Router CLI

Status: accepted
Package: cli
Date: 2026-07-02

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
- Stop after the nearest ancestor containing `.git`.
- If no Git root exists, walk only until `$HOME` or filesystem root.
- Never collect `~/.cli` during upward local discovery.
- Append `~/.cli` exactly once as the root command tree.
- Allow `ASYNC_CLI_GLOBAL_ROOT` to replace `~/.cli` for tests and advanced use.
- Allow `ASYNC_CLI_PROJECT_ROOT` to replace discovered Git-root behavior for
  tests and controlled launchers.

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
- Resolution uses the longest matching command prefix inside the first overlay
  that has any match.
- A nearer local match shadows parent and root matches, even if the shadowed
  command is deeper.
- If no local overlay matches the command path, fall back to the root command
  tree.
- Remaining arguments are forwarded unchanged to the script.
- `--` ends command routing early and forwards everything after it.
- Multiple `script.*` files in one command directory fail as ambiguous.
- `--list` and `--which` show all shadowing layers, including nested local
  overlays.

Example:

```sh
cli gh pull 123 --rebase
```

resolves to:

```text
command: gh pull
script argv: ["123", "--rebase"]
```

Namespace shadowing is deliberate. If local `.cli/gh/script.ts` exists, then:

```sh
cli gh clone x
```

runs the local `gh` command with:

```text
["clone", "x"]
```

even when `~/.cli/gh/clone/script.ts` exists.

### Script Contract

Scripts are standalone Node ESM programs.

- Default scaffold is `script.ts`.
- `.js` and `.mjs` run directly with Node.
- `.ts` and `.mts` run through Node 24 native type stripping.
- TypeScript syntax that Node cannot strip, such as `enum` or `namespace`,
  fails with Node's own error.
- Scripts read arguments from `process.argv.slice(2)`.
- Scripts run from the caller's original working directory.
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
```

### Descriptions

If the first line of `script.*` is a comment of the form:

```js
// cli: Open a pull request against main
```

the one-line description appears in `help`, `--list`, `--list --json`, and the
managed agent pointer output. Missing descriptions are represented as empty
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
cli --mv gh pull
cli --mv gh pull --to root
cli --mv gh pull --to local
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
- `cli --mv <cmd...>` defaults to `--to root`.
- `cli --mv <cmd...> --to root` moves the nearest matching local command
  directory into the root command tree.
- `cli --mv <cmd...> --to local` moves a root command directory into the
  current Git root's `.cli`.
- `cli --agents` manages repo context file discoverability.

`--new` target selection:

- Use the nearest existing local `.cli` if one exists.
- Otherwise create under the Git root `.cli`.
- Outside a Git repo, require `--root`.

Move rules:

- Move the whole command directory.
- Preserve the command path.
- Refuse to overwrite an existing target unless a future `--force` option is
  added.
- Remove empty source parents after moving.
- Do not copy sibling `lib/` or `_lib/` directories.
- Warn if `script.*` has relative imports escaping the command directory via
  `../`, because the command may not survive a move cleanly.

### Agent Integration

`.cli` commands are human-first, but coding tools working inside a repo should
discover and prefer them over ad-hoc equivalents. The committed pointer block is
how repo context files tell tools that the live command tree exists.

Default target is the repo root `AGENTS.md`. `--claude` explicitly targets
`CLAUDE.md`. There is no arbitrary file target in v1.

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

### Machine-Readable Listing

`cli --list --json` is the stable programmatic surface:

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
  - `moveCommand(options, commandPath)`

Environment overrides:

```text
ASYNC_CLI_GLOBAL_ROOT
ASYNC_CLI_PROJECT_ROOT
```

### Errors

- Unknown command: concise error, nearest suggestions, and `cli help` hint.
- Partial namespace: list available subcommands below the matched prefix.
- Ambiguous `script.*` directory: list the conflicting files.
- Unsafe path segment in routing, `--new`, or `--mv`: reject empty segments,
  `.`, `..`, absolute paths, path separators, ignored names, hidden segments,
  and leading-underscore segments.
- No Git root for `--new` without `--root` or `--mv --to local`: print an
  actionable message.
- `--agents --check` drift: exit nonzero with a `cli --agents --write` hint.
- Script failure: preserve the script's own exit code.

### Trust Model

`.cli` scripts are arbitrary code, equivalent to package scripts or Makefiles.
Nothing runs without an explicit `cli <cmd>` invocation. Trust prompts are a
future candidate and are default-off if added later.

## Non-Goals

- Argument parsing for user scripts.
- Generated per-command help from script metadata.
- Shell completions.
- MCP server mode.
- Trust prompts in v1.
- Non-JavaScript entrypoints such as `.sh` or `.py`.
- Runtime dependency management for scripts.
- Cross-platform shell launcher behavior beyond Node process spawning.
- Arbitrary context files for `--agents`; only `AGENTS.md` and explicit
  `--claude` are in scope.

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
