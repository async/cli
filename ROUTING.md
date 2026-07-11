# Routing

How `cli <words...>` picks a script. This is the normative description of the
router; `SPEC.md` is the underlying contract and [API_SURFACE.md](API_SURFACE.md)
documents the same behavior as a library.

## Mental model

There is no registry and no config file. The filesystem is the router:

```text
cli gh pull 123 --rebase
    ^^ ^^^^ ^^^^^^^^^^^^
    |  |    argv forwarded to the script
    |  +--- command word -> directory "pull"
    +------ command word -> directory "gh"
```

Command words map to nested directories inside a command root. A directory is
a runnable command when it contains exactly one `script.ts`, `script.mts`,
`script.js`, or `script.mjs`. Everything after the matched command words is
passed to that script untouched.

```text
.cli/
  gh/
    pull/
      script.ts      <- "cli gh pull"
      lib/           <- helpers, never routed
  deploy/
    script.js        <- "cli deploy"
    staging/
      script.js      <- "cli deploy staging"
```

## Command roots

A command root is a directory tree of commands. Two kinds exist:

| Kind | Location | Scope value | Trust |
| --- | --- | --- | --- |
| Local overlay | `.cli/` inside a project | `local` | Must be trusted to run |
| User-global root | `~/.cli` | `root` | Always trusted |

### Discovery order

Given the caller's working directory, roots are discovered in this exact
order:

1. Resolve the working directory (`options.cwd` for the API, `process.cwd()`
   for the binary).
2. Walk upward one directory at a time. Every directory that contains a
   `.cli/` directory contributes a local overlay, nearest first.
3. Stop the walk after the nearest ancestor that contains `.git` (the project
   root). If no project root exists, walk until `$HOME` or the filesystem
   root, whichever comes first.
4. `~/.cli` is never collected by the walk, even when the walk passes through
   `$HOME`.
5. Append the user-global root exactly once, last.
6. Drop duplicate paths, keeping the first occurrence.

Example. With this layout:

```text
~/work/app/.cli/            <- project root (~/work/app has .git)
~/work/app/packages/web/.cli/
~/.cli/
```

running `cli` from `~/work/app/packages/web/src` discovers, in order:

```text
1. ~/work/app/packages/web/.cli   (local)
2. ~/work/app/.cli                (local)
3. ~/.cli                         (root)
```

Order is precedence: 1 beats 2 beats 3.

### Environment overrides

| Variable | Effect |
| --- | --- |
| `ASYNC_CLI_GLOBAL_ROOT` | Replaces `~/.cli` as the user-global root |
| `ASYNC_CLI_PROJECT_ROOT` | Pins the project root instead of searching for `.git` |
| `ASYNC_CLI_TRUST` | `off` disables trust enforcement |

The first two exist for tests and controlled launchers; most setups never set
them.

## Ignored segments

These names are invisible to routing, listing, help, completion, and
suggestions, at every depth:

```text
help          reserved by "cli help"
lib           conventional helper directory
node_modules
.*            any hidden directory (".git", ".cache", ...)
_*            any leading-underscore directory ("_templates", "_lib", ...)
```

Two consequences worth knowing:

- Put shared helper code in `lib/` or any `_*` directory next to your scripts;
  it can never become a command or collide with one.
- `script` is not reserved as a command word. `.cli/foo/script/script.js`
  defines the command `foo script`. Only the `script.*` filename is special.

Names containing underscores elsewhere are ordinary command words: `foo_bar`
is routable, `_foo` is not.

## Resolution rules

`cli <words...> [args...]` resolves in these steps:

1. Split words at the first bare `--`. Words before it are candidate command
   words; everything after it is forwarded to the script verbatim and never
   interpreted as command words.
2. Validate every candidate word. Empty strings, `.`, `..`, absolute paths,
   anything containing `/` or `\`, ignored names (`help`, `lib`,
   `node_modules`), hidden names (`.x`), and leading-underscore names (`_x`)
   are rejected before the filesystem is touched.
3. Visit command roots in discovery order. The first root that contains any
   directory prefix of the command words captures the command. Later roots
   are not consulted, even if they hold a longer or "better" match. This is
   the first-overlay-wins rule.
4. Inside the capturing root, select the longest prefix of the command words
   whose directory contains a runnable `script.*`. Shorter runnable prefixes
   lose to longer ones within the same root.
5. Words beyond the selected prefix, plus everything after `--`, become the
   script's argv in that order.
6. If the capturing root has matching directories but no runnable script along
   the prefix, resolution fails: with subdirectories it is a partial-namespace
   error listing the available subcommands; without them it is an unknown
   command.
7. If no root captures, the command is unknown; the error suggests up to five
   near matches by first word.
8. A command directory with two or more `script.*` files is ambiguous and
   fails, listing the conflicting files. Ambiguity is never resolved by
   extension priority.
9. Before execution (and only execution — inspection is always allowed), the
   trust gate applies: scripts selected from a `local` root run only if that
   overlay is trusted (see Trust below).

### Worked examples

Layout:

```text
~/work/app/.cli/gh/script.ts             (project overlay)
~/.cli/gh/clone/script.ts                (user-global)
~/.cli/deploy/script.js                  (user-global)
```

From inside `~/work/app`:

| Invocation | Result |
| --- | --- |
| `cli gh clone x` | Runs local `gh` with argv `["clone", "x"]` |
| `cli deploy` | Runs global `deploy` (no local `deploy` prefix exists) |
| `cli gh -- --list` | Runs local `gh` with argv `["--list"]` |
| `cli ghx` | Unknown command; suggests `gh` |

The first row is the important one. The local overlay contains the directory
`gh`, so it captures every command starting with `gh` — including `gh clone`,
which only exists as a runnable script in the global tree. The local `gh`
script receives `clone x` as arguments. The global `gh clone` is shadowed.

From outside any project, `cli gh clone x` runs the global `~/.cli/gh/clone`
script with argv `["x"]` — nothing shadows it there.

## Shadowing

Shadowing is deliberate: a repo can override your personal command with a
project-specific version by defining the same path (or any prefix of it)
closer to the caller.

- A nearer overlay shadows farther overlays and the global root for the whole
  namespace it captures, even where the nearer tree is shallower.
- Within one root, deeper runnable prefixes win; across roots, nearer roots
  win. Nearness beats depth.
- Nothing is merged. Namespaces do not union across roots; the capturing root
  is authoritative for everything under the captured prefix.

Shadowing is always visible:

- `cli --list` marks shadowed entries with `(shadowed)`.
- `cli --list --json` gives each command a `shadows` array (script paths it
  hides) and a `shadowed` boolean.
- `cli --which gh clone` prints the selected script plus every shadowed
  alternative.
- `cli --doctor` reports shadowed commands as info-level findings.

Because a cloned repository can use shadowing to capture commands you run by
habit, execution from local overlays is gated by trust.

## Trust gate

- Commands from the user-global root always run.
- Commands from a local overlay run only when that overlay is trusted:
  `cli --trust` records a content hash of the entire overlay; any change to
  any file under it, including linked file or directory contents, invalidates
  the trust; cyclic directory links are rejected. Untrusted or changed
  overlays fail with exit code 3 and a `cli --trust` hint.
- `--list`, `--which`, `help`, completion, and `--doctor` never require trust.
  `cli <cmd>` and MCP `tools/call` always check it.
- `ASYNC_CLI_TRUST=off` disables the gate for controlled environments.
- MCP stdio is a trusted-client boundary. The connected client may invoke any
  listed command; narrower per-call approval belongs in the MCP host.

## Execution contract

Once resolved and trusted, the script runs as a plain Node process:

- argv: resolved extra words then `--`-forwarded words, at
  `process.argv.slice(2)`.
- cwd: the caller's working directory, unless the script opts out with a
  `// cli-cwd: project-root` or `// cli-cwd: script-dir` comment in its first
  16 lines.
- stdio: inherited. Exit code: the script's own. Fatal signals map to
  `128 + signal`.
- `.js`/`.mjs` run directly; `.ts`/`.mts` rely on Node 24 native type
  stripping (TypeScript syntax that Node cannot strip, like `enum`, fails
  with Node's own error).

Injected environment:

| Variable | Value |
| --- | --- |
| `CLI_SCRIPT` | Absolute path of the running script |
| `CLI_ROOT` | Command root that captured the command |
| `CLI_SCOPE` | `local` or `root` |
| `CLI_PROJECT_ROOT` | Project root, or empty string outside a repo |
| `CLI_COMMAND` | The matched command words, space-joined |
| `CLI_CALLER_CWD` | The caller's working directory, regardless of pragma |

## Rules, distilled

1. Words map to directories; a directory with exactly one `script.*` is a
   command.
2. Roots are searched nearest-local first, user-global last.
3. The first root containing any prefix directory captures the command
   entirely.
4. Within the capturing root, the longest runnable prefix wins.
5. Leftover words plus `--`-forwarded words become the script's argv.
6. `help`, `lib`, `node_modules`, `.x`, and `_x` never route.
7. Two `script.*` files in one directory is an error, never a preference.
8. Nearness beats depth; nothing merges across roots.
9. Local overlays need `cli --trust` to execute; the global root does not.
10. Everything above is inspectable without running anything: `--list`,
    `--which`, `--doctor`.
