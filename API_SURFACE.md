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
  createCommand,
  discoverRoots,
  listCommands,
  moveCommand,
  resolveCommand,
  runCommand
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

Executes the resolved script with inherited stdio by default, caller cwd,
forwarded arguments, and `CLI_*` environment values.

### `createCommand(options, commandPath)`

Creates a command directory with a default `script.ts`.

### `moveCommand(options, commandPath)`

Moves a whole command directory between local and user-global roots and warns
when a script imports through `../`.
