# Changelog

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
