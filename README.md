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

The v1 contract is defined in `SPEC.md`. The package implements local and
user-global command discovery, command resolution, script execution,
machine-readable listing, `--which`, `--new`, `--mv`, context-file pointers,
help, and version output.

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
cli --mv gh pull
cli --mv gh pull --to local
cli --agents
cli --agents --write
cli --agents --check
cli --agents --claude --write
cli --version
```

Command scripts run from the caller's original working directory. `.js` and
`.mjs` scripts run directly with Node; `.ts` and `.mts` scripts use Node 24
native type stripping.

## Development

```sh
pnpm run build
pnpm test
pnpm run pack:check
pnpm run release:check
```
