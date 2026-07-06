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
two trees: a repo-local `.cli/` overlay that travels with the project, and a
user-global `~/.cli` for your personal tools. Proven commands get promoted
from one to the other with a single command.

Docs map: this README is the guided tour. [ROUTING.md](ROUTING.md) is the
normative routing rules. [API_SURFACE.md](API_SURFACE.md) is the complete API
reference. `SPEC.md` is the design contract.

## Install

```sh
pnpm add -D @async/cli    # per project
pnpm add -g @async/cli    # or globally
```

Requires Node 24+. The package ships two identical binaries, `cli` and
`async-cli`, for setups where `cli` is taken.

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

1. Starting at your working directory, walk upward and collect every `.cli/`
   directory, nearest first, stopping at the Git root. Append `~/.cli` last.
2. The first tree that contains any directory matching your first words
   captures the command — nearer beats farther, always.
3. Inside that tree, the longest path of words with a runnable `script.*`
   wins; leftover words become the script's argv. `--` stops word matching
   early.
4. `help`, `lib`, `node_modules`, hidden (`.x`), and underscore-prefixed
   (`_x`) names never route, so helper code can sit next to scripts.

Rule 2 is what makes overlays powerful: a repo can define `.cli/gh/script.ts`
and take over the whole `gh ...` namespace while you work in that repo, even
though your `~/.cli/gh/clone` exists. That is deliberate — and it is exactly
why local overlays are trust-gated. `cli --list` marks anything shadowed,
`cli --which` shows what was hidden.

## Writing commands

A command script is a plain Node ESM program — no SDK, no wrapper:

```ts
// cli: Open a pull request against main
// cli-cwd: project-root
const [id, ...rest] = process.argv.slice(2);
console.log(`pulling ${id} in ${process.cwd()}`);
```

| Contract | Detail |
| --- | --- |
| Arguments | `process.argv.slice(2)`, exactly as typed after the command |
| Description | First line `// cli: ...` shows in `--list`, `help`, MCP |
| Working dir | Caller's cwd; `// cli-cwd: project-root` or `script-dir` to change |
| Stdio / exit | Inherited; your exit code is the command's exit code |
| Languages | `.js`/`.mjs` run directly; `.ts`/`.mts` via Node 24 type stripping |
| Helpers | Put shared code in `lib/` or `_anything/` — never routed |
| Environment | `CLI_SCRIPT`, `CLI_ROOT`, `CLI_SCOPE`, `CLI_PROJECT_ROOT`, `CLI_COMMAND`, `CLI_CALLER_CWD` |

Templates: keep reusable starting points in `_templates/<name>/` in any
command tree and scaffold from them with `cli --new api users --template
worker`.

## Managing commands

```sh
cli --new gh pr                 # scaffold (nearest local overlay, or --root)
cli --edit gh pr                # open the script in $VISUAL / $EDITOR
cli --rm gh pr                  # delete (nested commands require --force)
cli --cp gh pr --to root        # copy local -> user-global
cli --mv gh pr --to local       # move user-global -> this repo
```

Transfers move whole command directories, preserve the command path, refuse
to overwrite, and warn when a script imports through `../` (such imports may
break outside their original tree).

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

## Agents and tooling

The same command tree is discoverable by machines:

```sh
cli --agents --write   # pin a pointer block into AGENTS.md (--claude for CLAUDE.md)
cli --list --json      # stable inventory: commands, descriptions, scripts, shadows
cli --mcp              # MCP stdio server: commands become callable tools
```

`--mcp` needs zero dependencies and exposes each non-shadowed command as a
tool (`gh pull` becomes `gh__pull`) taking `{ "args": [...] }`. Untrusted
overlays are excluded.

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
| `cli --mcp` | Serve commands over MCP stdio |
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

Maintainers who want the shell to prefer this checkout over an npm-installed
copy can link the local binaries:

```sh
pnpm run local:link
pnpm run local:status
pnpm run local:unlink
```
