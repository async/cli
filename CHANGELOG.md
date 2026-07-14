# Changelog

## 0.4.0 - 2026-07-14

- Supports Deno 2.7+ as an explicit alternate host for the published CLI while
  keeping Node 24+ as the default for installed binaries.
- Verifies the packed package under Deno across `.js`, `.mjs`, `.ts`, and
  `.mts` commands, including arguments, environment, working directory, and
  nonzero exit propagation.
- Provisions Deno in generated CI and publishes the runtime security contract
  as a dedicated Pages document.

## 0.3.0 - 2026-07-11

- Walks `.cli` overlays from the caller's working directory to the filesystem
  root, nearest first, before falling back to the user-global command tree.
- Continues past namespace-only overlays until a runnable command is found,
  while preserving nearer runnable-prefix shadowing.
- Uses the nearest existing local overlay for command lifecycle operations,
  falling back to `ASYNC_CLI_PROJECT_ROOT` or the caller's working directory
  without requiring a Git root.
- Defines `CLI_PROJECT_ROOT` from the explicit override or the command overlay's
  owner, with the nearest local owner or caller directory for global commands.
- Removes the bundled MCP server, `cli --mcp`, `runMcpServer`, and `McpIo`.
  `cli --list --json` remains the machine-readable command discovery surface.

## 0.2.3 - 2026-07-11

- Covers symlinked file and directory contents in local-overlay trust hashes,
  includes symlinked `.cli` root identity, and rejects cyclic directory links.
- Rechecks the resolved local overlay immediately before MCP command execution.
- Documents the trusted-client boundary for the local MCP stdio server.

## 0.2.2 - 2026-07-06

- Updates the Pipeline devDependency to `@async/pipeline@0.9.35`; regenerated
  workflows now pin `async/actions@v0.1.24` and `@async/release@v0.1.6`.
- Adds the generated `dependency-bump` receiver job
  (`sync.github.dependencyBump`) so `async-dep-bump` dispatches from the
  pipeline release update train bump the pinned dependency, regenerate synced
  surfaces, verify with `release:check`, and land on `main` or open a pull
  request on failure.
- Documents the pipeline-generated CI, Pages, preview, and release automation
  in README.md and AGENTS.md.

## 0.2.1 - 2026-07-06

- Exports `CommandList`, `CreateCommandResult`, and `MoveCommandResult` from
  the root package type surface.
- Includes `API_SURFACE.md` and `ROUTING.md` in the published package and
  generated Pages documentation.

## 0.2.0 - 2026-07-06

- Adds a direnv-style trust model for repo-local overlays: `cli --trust`,
  `cli --untrust`, `cli --trust --status`, content-hash validation, exit 3 on
  untrusted or changed overlays, and `ASYNC_CLI_TRUST=off` for controlled
  environments. CLI mutations (`--new`, `--cp/--mv --to local`,
  `--add --to local`) record or refresh trust for the target overlay.
- Adds shell completions: `cli --completions bash|zsh|fish` and the hidden
  `cli --complete` helper that completes command segments and built-in flags.
- Adds `cli --edit <cmd...>` to open the resolved script in `$VISUAL`/`$EDITOR`
  and `cli --rm <cmd...> [--root] [--force]` with nested-command protection
  and empty-parent pruning.
- Adds `--new --template <name>`, copying command templates from
  `_templates/` in any command root, nearest-local first.
- Adds the `// cli-cwd: caller|project-root|script-dir` pragma plus a
  `CLI_CALLER_CWD` environment value for scripts.
- Adds `cli --doctor [--json]`: audits ambiguous script directories, escaping
  imports, empty command directories, trust state, descriptions, shadowing,
  and managed context-block drift.
- Adds `cli --mcp`, a zero-dependency MCP stdio server that exposes the
  command tree as tools (`gh pull` becomes `gh__pull`), excluding untrusted
  local overlays.
- Adds command packs: `cli --add <git-url> [--to root|local]
  [--prefix <name>] [--force]` installs `.cli/` trees from any Git source.
- Exports `removeCommand`, `addPack`, `runDoctor`, `complete`,
  `completionScript`, `runMcpServer`, and the trust helpers from the root
  export.

## 0.1.2 - 2026-07-02

- Adds `cli --cp <command...> [--to root|local]` and `copyCommand()` for
  non-destructive command directory transfers between local and user-global
  command trees.

## 0.1.1 - 2026-07-02

- Pins generated workflows to the publish action that repairs scoped package
  public access before registry verification.
- Updates the Pipeline devDependency used to generate committed workflow files.
- Normalizes binary paths to match npm package metadata.

## 0.1.0 - 2026-07-02

- Initial package scaffold for `@async/cli`.
- Declares `cli` and `async-cli` binaries.
- Adds maintainer local-link scripts for checkout-backed binaries.
- Adds the accepted filesystem router v1 spec, package docs, build harness, and
  scaffold tests.
