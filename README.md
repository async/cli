# @async/cli

Filesystem-routed commands for local projects and user-global tools.

`@async/cli` treats command directories as the CLI surface. A command such as:

```sh
cli gh pull
```

maps to a command directory like:

```text
.cli/gh/pull/script.ts
```

The contract is defined in `SPEC.md`. The package implements local and
user-global command discovery, command resolution, script execution with a
trust model for local overlays, machine-readable listing, `--which`, command
scaffolding with templates, command copy/move/remove, `--edit`, command packs
via `--add`, shell completions, a tree doctor, an MCP server mode,
context-file pointers, help, and version output.

## Install

```sh
pnpm add -D @async/cli
```

## Binaries

The package declares two equivalent binaries:

```sh
cli
async-cli
```

## Command Roots

`cli` discovers local `.cli/` overlays from the current working directory upward
to the nearest Git root, then appends the user-global command tree. Use
`ASYNC_CLI_GLOBAL_ROOT` to replace the user-global tree and
`ASYNC_CLI_PROJECT_ROOT` to pin project-root behavior in tests or controlled
launchers.

## Built-Ins

```sh
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
cli --cp gh pull
cli --cp gh pull --to local
cli --mv gh pull
cli --mv gh pull --to local
cli --add https://example.com/org/pack.git
cli --trust
cli --trust --status
cli --untrust
cli --doctor
cli --completions bash
cli --mcp
cli --agents
cli --agents --write
cli --agents --check
cli --agents --claude --write
cli --version
```

Command scripts run from the caller's original working directory by default;
a `// cli-cwd: project-root` or `// cli-cwd: script-dir` head comment changes
that per script. `.js` and `.mjs` scripts run directly with Node; `.ts` and
`.mts` scripts use Node 24 native type stripping.

Use `--cp` to clone a command directory between local and user-global command
trees without removing the source. Use `--mv` when the source should be
transferred instead, and `--rm` to delete a command directory.

## Trust

Repo-local `.cli/` overlays are refused at execution time until you trust
them, because cloned repositories can shadow your user-global commands:

```sh
cli --trust           # trust the local overlays discovered from here
cli --trust --status  # trusted | changed | untrusted per overlay
cli --untrust         # revoke
```

Trust records a content hash of the overlay; any change requires re-trusting.
Listing and `--which` never require trust. Set `ASYNC_CLI_TRUST=off` to
disable enforcement in controlled environments.

## Completions

```sh
eval "$(cli --completions bash)"   # or zsh
cli --completions fish | source    # fish
```

## Doctor

`cli --doctor [--json]` audits every command root: ambiguous script
directories, `../` imports that break `--cp`/`--mv`, empty command
directories, untrusted overlays, missing descriptions, shadowed commands, and
stale `--agents` pointer blocks.

## MCP

`cli --mcp` serves the command tree as MCP tools over stdio (JSON-RPC 2.0,
zero dependencies), so agent runtimes can discover and call the same commands
humans use. Untrusted local overlays are excluded.

## Packs

Install commands from any Git repository that carries a `.cli/` tree:

```sh
cli --add https://example.com/org/pack.git             # into ~/.cli
cli --add https://example.com/org/pack.git --prefix vendor
cli --add https://example.com/org/pack.git --to local  # into this repo
```

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
