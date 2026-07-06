# @async/cli API Surface

## Package

- Package: `@async/cli`
- Runtime: Node `>=24`
- Module format: ESM
- Runtime dependencies: none

## Binaries

- `cli`
- `async-cli`

## Root Export

```js
import {
  addPack,
  complete,
  completionScript,
  copyCommand,
  createCommand,
  discoverRoots,
  listCommands,
  localOverlayTrust,
  moveCommand,
  overlayTrustState,
  recordOverlayTrust,
  removeCommand,
  removeOverlayTrust,
  resolveCommand,
  runCommand,
  runDoctor,
  runMcpServer,
  trustLocalOverlays,
  untrustLocalOverlays
} from "@async/cli";
```

### `discoverRoots(options)`

Discovers local `.cli/` overlays nearest-first and appends the user-global root
exactly once.

### `listCommands(options)`

Returns `{ version: 1, roots, commands }`, including descriptions, shadowed
commands, and the scripts shadowed by each selected command.

### `resolveCommand(options, args)`

Resolves command words to the selected script, command prefix, script argv, root,
and shadowed scripts.

### `runCommand(options, args)`

Executes the resolved script with inherited stdio by default, forwarded
arguments, and `CLI_*` environment values. The working directory follows the
script's `// cli-cwd:` pragma (caller by default). Local-overlay scripts are
refused with exit 3 unless the overlay is trusted.

### `createCommand(options, commandPath)`

Creates a command directory with a default `script.ts`, or copies
`_templates/<name>/` when `options.template` is set.

### `removeCommand(options, commandPath)`

Removes a whole command directory from the nearest local overlay (or the root
tree) and prunes empty parents. Nested commands require `options.force`.

### `copyCommand(options, commandPath)`

Copies a whole command directory between local and user-global roots and warns
when a script imports through `../`.

### `moveCommand(options, commandPath)`

Moves a whole command directory between local and user-global roots and warns
when a script imports through `../`.

### `addPack(options, source)`

Shallow-clones a Git source and installs its `.cli/` command directories into
the root or local tree, optionally under `options.prefix`, refusing conflicts
unless `options.force`.

### Trust

`trustLocalOverlays`, `untrustLocalOverlays`, `localOverlayTrust`,
`overlayTrustState`, `recordOverlayTrust`, `removeOverlayTrust`,
`ensureOverlayTrusted`, `hashOverlayTree`, `isTrustEnforced`, and
`trustStorePath` manage the content-hash trust store kept in `.trust.json`
under the user-global root. `ASYNC_CLI_TRUST=off` disables enforcement.

### `runDoctor(options)` / `renderDoctorReport(report)`

Audits all command roots and returns `{ version, problems, summary }` with
error, warning, and info findings.

### `complete(options, words)` / `completionScript(shell)`

Next-segment command completion and the bash, zsh, and fish completion
scripts that call it.

### `runMcpServer(options, io)`

Serves the command tree as MCP tools over newline-delimited JSON-RPC stdio.
Untrusted local overlays are excluded from listing and refused at call time.
