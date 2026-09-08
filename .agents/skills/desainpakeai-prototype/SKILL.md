---
name: desainpakeai-prototype
description: Build, inspect, edit, verify, and export dependency-free DesainPakeAI prototype workspaces with the dpai CLI. Use for prototype pages, layouts, components, design tokens, DESIGN.md guidance, visual-review retrieval, canvas working state, or single-HTML export. Do not use for the TanStack host UI or legacy prototype templates.
---

# DesainPakeAI Prototype

Use the globally installed CLI through this command:

```text
dpai
```

Do not initialize or call a DesainPakeAI MCP server. Do not use `npx` for each
workspace operation.

## Start a continuous task

Reuse confirmed setup across follow-up edits while the session, target project,
and connection stay unchanged.

1. Run `<prefix> --version` first. If the command is unavailable, run
   `npm install --global desainpakeai-cli@latest`, then check the version again.
   Do not reinstall or update during every ordinary task.
2. Use that binary for the rest of the continuous task.
3. Run `<prefix> auth status --pretty` once. If authentication is missing, ask
   the user to run `<prefix> auth login --api-url <url> --api-key <dpai_key>`,
   then run `<prefix> auth status --pretty` once more to verify the login.
4. Run `<prefix> project current --pretty` and confirm it is the target project.
5. Run `<prefix> context --pretty` and retain its latest revision.
6. Run `<prefix> guide get --topic prototype-authoring --raw` before the first
   mutation and follow the returned guide as the current source of truth.
7. Pull another guide only when the active guide says it applies. Never preload
   every guide.

Treat a successful authenticated CLI command as the connection signal. Creating
or copying an API key alone does not prove that the coding agent is connected.
Do not initialize, call, or wait for an MCP handshake endpoint.

Use `--workspace <path>` only when the user explicitly requests filesystem-local
work. Carry forward the revision returned by every successful mutation.

## Prefer native commands

Do not handwrite inline JSON. Use native flags for normal work; the CLI builds
and validates the operation payload and reads the latest revision automatically.

```text
<prefix> design context --detail compact --section Overview,Components --pretty
<prefix> token list --type color,spacing --format css
<prefix> token create --name --color-accent --type color --value "#635bff"
<prefix> token set --name --color-accent --value "#574ee8"
<prefix> token delete --name --color-legacy
<prefix> design set-section --heading Overview --content-file overview.md
<prefix> component create --id status-pill --tag x-status-pill --prop tone="Visual tone" --default tone=neutral
<prefix> review get --review <uuid> --output review.png
<prefix> work status --pretty
<prefix> preview verify --page <page-id>
<prefix> work finish --page <page-id>
```

For long HTML, CSS, JavaScript, or Markdown, use `--content-file <path>` or pipe
raw text through stdin. For exact multiline replacement, use `--replace-file`
with `--content-file`. For several related replacements, use
`file patch --patch-file <diff>` or pipe a standard unified diff through stdin.
Prefer UTF-8 files for non-ASCII content on Windows PowerShell 5.1.

## Author HTML and CSS together

Write the markup and its styling in the same edit. Prefer `style="..."`
attributes for element-specific prototype styling; do not create a separate
CSS-first pass before writing the HTML. Keep design-token references such as
`var(--color-accent)` inside those inline declarations when available.

Use a local `<style>` block only for behavior that inline declarations cannot
express: pseudo-classes or pseudo-elements, media queries, keyframes, or rules
shared by several elements. When a `<style>` block is necessary, submit it with
the related markup in the same CLI mutation instead of editing styles and HTML
in separate rounds.

Repeat list flags or pass comma-separated values. Use `--input @payload.json`
only for an atomic batch that mixes edit modes, an atomic multi-token batch,
component recipes, the complete omissions list, or low-level integration
debugging. Generate the file programmatically and never compose JSON inline in
the shell.

Run every DesainPakeAI operation through `<prefix>` and follow the live CLI guide
for verification, completion, revision conflicts, and recovery.
