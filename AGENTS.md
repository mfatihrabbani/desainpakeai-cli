# DesainPakeAI CLI agent contract

- Keep the CLI transport-independent. Domain behavior belongs in `src/core`.
- Preserve revision guards, safe-path checks, atomic writes, manifest validation,
  canvas synchronization, and page-working state behavior.
- Commands must remain non-interactive and machine-readable.
- JSON mode writes only result data to stdout; diagnostics belong on stderr.
- Do not add an MCP dependency or call an MCP endpoint from the CLI.
- Run `pnpm test`, `pnpm check`, `pnpm build`, and `pnpm skill:validate` before handoff.
