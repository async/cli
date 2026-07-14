# @async/cli

Filesystem-routed commands for local projects and user-global tools.

`@async/cli` turns directories into a CLI. A command like:

```sh
cli gh pull 123 --rebase
```

is routed to a directory, and the words that did not match become the
script's arguments:

```text
.cli/gh/pull/script.ts        argv: ["123", "--rebase"]
```

No registry, no config file, no argument framework. One lookup rule covers
local `.cli/` overlays found from the current directory up to the filesystem
root, plus a user-global `~/.cli` for your personal tools. Proven commands get
promoted from one to the other with a single command.

Docs map: this README is the guided tour. [ROUTING.md](ROUTING.md) is the
normative routing rules. [API_SURFACE.md](API_SURFACE.md) is the complete API
reference. `SPEC.md` is the design contract.

## Install

```sh
pnpm add -D @async/cli    # per project
pnpm add -g @async/cli    # or globally
```

The installed `cli` and `async-cli` binaries require Node 24+. Deno 2.7+ is an
alternate host for the published package:

```sh
deno run -A npm:@async/cli/cli --version
```

`-A` gives the Deno-hosted CLI the same current-user privileges as the Node
binary; it is not a sandbox. See [SECURITY.md](SECURITY.md).

## Quick start

```sh
# scaffold .cli/gh/pull/script.ts in this repo
cli --new gh pull

# it is immediately runnable (scaffolded overlays are auto-trusted)
cli gh pull 123 --rebase      # script.ts gets ["123", "--rebase"]

# see what exists, and what would run
cli --list
cli --which gh pull

# promote it to your personal ~/.cli once it earns it
cli --mv gh pull --to root
```

Cloned a repo that ships its own `.cli/`? Commands are visible immediately
but refuse to run until you approve them once:

```sh
cli --list          # inspection never needs trust
cli --trust         # approve this repo's overlay, then run normally
```

## How routing works

The full rules with worked examples live in [ROUTING.md](ROUTING.md). The
short version:

1. Starting at your working directory, walk upward to the filesystem root and
   collect every `.cli/` directory, nearest first. Append `~/.cli` once, last.
2. In each tree, look for the longest runnable prefix. A namespace-only match
   does not stop the search; the first tree with a runnable command wins.
3. Leftover words become the script's argv. `--` stops word matching early.
4. `help`, `lib`, `node_modules`, hidden (`.x`), and underscore-prefixed
   (`_x`) names never route, so helper code can sit next to scripts.

A runnable prefix still shadows farther commands. A local `.cli/gh/script.ts`
takes over `gh ...` while you work below that overlay, even when
`~/.cli/gh/clone` exists. A directory such as `.cli/gh/` with no runnable
prefix does not block a farther `gh clone`. Local overlays remain trust-gated;
`cli --list` marks anything shadowed and `cli --which` shows what was hidden.
Resolution reads the current filesystem on every invocation; there is no
command-path cache.

## Writing commands

A command script is a plain ESM program — no SDK, no wrapper. The installed
binaries run commands through Node; an explicit Deno invocation runs the same
command tree through Deno:

```ts
// cli: Open a pull request against main
// cli-cwd: project-root
const [id, ...rest] = process.argv.slice(2);
console.log(`pulling ${id} in ${process.cwd()}`);
```

| Contract | Detail |
| --- | --- |
| Arguments | `process.argv.slice(2)` on both hosts; `Deno.args` is also available under Deno |
| Description | First line `// cli: ...` shows in `--list`, `--list --json`, and `help` |
| Working dir | Caller's cwd; `// cli-cwd: project-root` or `script-dir` to change |
| Stdio / exit | Inherited; your exit code is the command's exit code |
| Runtime | Node 24+ by default; `deno run -A npm:@async/cli/cli ...` uses Deno 2.7+ |
| Languages | `.js`/`.mjs` run directly; `.ts`/`.mts` use the selected host's TypeScript support |
| Helpers | Put shared code in `lib/` or `_anything/` — never routed |
| Environment | `CLI_SCRIPT`, `CLI_ROOT`, `CLI_SCOPE`, `CLI_PROJECT_ROOT`, `CLI_COMMAND`, `CLI_CALLER_CWD` |

Runtime selection applies to the whole CLI invocation. The router does not
infer Deno from a file extension, shebang, or `deno.json`, so the ordinary npm
binary remains fully compatible with existing Node commands.

Templates: keep reusable starting points in `_templates/<name>/` in any
command tree and scaffold from them with `cli --new api users --template
worker`.

## Managing commands

```sh
cli --new gh pr                 # nearest local overlay; otherwise ./.cli
cli --edit gh pr                # open the script in $VISUAL / $EDITOR
cli --rm gh pr                  # delete (nested commands require --force)
cli --cp gh pr --to root        # copy local -> user-global
cli --mv gh pr --to local       # move user-global -> nearest local overlay
```

Transfers move whole command directories, preserve the command path, refuse
to overwrite, and warn when a script imports through `../` (such imports may
break outside their original tree).

Local destinations use the nearest existing `.cli`. If none exists, they use
`ASYNC_CLI_PROJECT_ROOT/.cli` when configured, or `.cli` in the caller's
working directory. Git is not required for command creation or transfers.

## Trust

Local overlays are arbitrary code that arrives with a `git clone`, and
shadowing means they can capture commands you type from muscle memory. So
execution is gated, direnv-style:

```sh
cli --trust           # approve the overlays discovered from here
cli --trust --status  # trusted | changed | untrusted, per overlay
cli --untrust         # revoke
```

Trust records a content hash of the whole overlay; any change flips it to
`changed` and blocks execution (exit 3) until you re-approve. Your own
actions count as consent: `--new`, `--cp/--mv --to local`, and
`--add --to local` keep the target overlay trusted without ceremony.
`~/.cli` is always trusted. Set `ASYNC_CLI_TRUST=off` to disable the gate in
controlled environments (such as CI).

## Sharing commands

Any Git repository with a `.cli/` tree is a command pack:

```sh
cli --add https://github.com/org/pack.git                # into ~/.cli
cli --add https://github.com/org/pack.git --prefix vendor # namespaced: cli vendor <cmd>
cli --add https://github.com/org/pack.git --to local      # into this repo
```

Installs are all-or-nothing: conflicts are listed and nothing is written
unless you pass `--force`.

## Context files and tooling

The same command tree is discoverable by machines:

```sh
cli --agents --write   # pin a pointer block into AGENTS.md (--claude for CLAUDE.md)
cli --list --json      # stable inventory: commands, descriptions, scripts, shadows
```

`cli --list --json` is the supported machine-discovery surface. It reports the
live roots, descriptions from `// cli: ...`, script paths, and shadowing without
executing a command or requiring overlay trust.

The `--agents` context-file subsystem is the only feature that searches for a
Git repository boundary: it uses the repository root to place or check
`AGENTS.md` or `CLAUDE.md`, including during doctor audits. Command discovery
itself does not consult `.git`.

## Completions

```sh
eval "$(cli --completions bash)"    # bash
eval "$(cli --completions zsh)"     # zsh
cli --completions fish | source     # fish
```

Tab-completion covers command segments (shadow-aware) and built-in flags.

## Doctor

```sh
cli --doctor          # human report, exit 1 on errors
cli --doctor --json   # { problems, summary } for tooling
```

Finds ambiguous script directories, `../` imports that break transfers,
empty command directories, untrusted or drifted overlays, stale `--agents`
blocks, missing descriptions, and shadowed commands.

## CLI reference

| Command | Does |
| --- | --- |
| `cli <words...> [args...]` | Route and run a command |
| `cli help [prefix]` | Usage, or commands below a prefix |
| `cli --list [--json]` | Inventory, including shadowed entries |
| `cli --which <words...>` | Selected script and what it shadows |
| `cli --new <words...> [--root] [--template <name>]` | Scaffold a command |
| `cli --edit <words...>` | Open the script in `$VISUAL`/`$EDITOR` |
| `cli --rm <words...> [--root] [--force]` | Remove a command directory |
| `cli --cp <words...> [--to root\|local]` | Copy between trees |
| `cli --mv <words...> [--to root\|local]` | Move between trees |
| `cli --add <git-url> [--to root\|local] [--prefix <name>] [--force]` | Install a command pack |
| `cli --trust [--status]` / `cli --untrust` | Manage overlay trust |
| `cli --doctor [--json]` | Audit the command trees |
| `cli --completions <bash\|zsh\|fish>` | Emit shell completions |
| `cli --agents [--write\|--check] [--claude]` | Manage the context pointer block |
| `cli --version` | Print the package version |

Exit codes: the script's own for command runs; `2` for usage and routing
errors; `3` for trust refusals; `1` for `--doctor` with errors and
`--agents --check` drift.

## Development

```sh
pnpm run build
pnpm test
pnpm run pack:check
pnpm run release:check
```

## Pipeline

This repo's CI, Pages, previews, and release lifecycle are generated by
[`@async/pipeline`](https://github.com/async/pipeline) from
[`pipeline.ts`](./pipeline.ts). Do not hand-edit
`.github/workflows/async-pipeline.yml` or the locks under `.locks/pipeline/`.
Edit `pipeline.ts`, then regenerate and check:

```sh
pnpm run pipeline:sync:generate
pnpm run pipeline:sync:check
pnpm run pipeline:github:check
```

Common pipeline commands:

```sh
pnpm run pipeline:verify        # local run of the verify job
pnpm run pipeline:pages         # build the docs site task
pnpm run release:check          # forced full verify used before releases
```

Releases ride the pipeline update train: when `@async/pipeline` publishes a
release, it dispatches an `async-dep-bump` event to this repo, and the
generated `dependency-bump` job bumps the pinned dependency, regenerates the
synced surfaces, verifies with `release:check`, and lands on `main` when green
or opens a pull request when not.

Maintainers who want the shell to prefer this checkout over an npm-installed
copy can link the local binaries:

```sh
pnpm run local:link
pnpm run local:status
pnpm run local:unlink
```
