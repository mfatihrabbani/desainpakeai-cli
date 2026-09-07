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

## Start every task

1. Run `npm install --global desainpakeai-cli@latest` once. This checks npm and
   updates the global binary only when a newer release exists.
2. Run `<prefix> --version`, then use that binary for the rest of the task.
3. Run `<prefix> auth status --pretty`. If authentication is missing, ask the
   user to run `<prefix> auth login --api-url <url> --api-key <dpai_key>`.
4. Run `<prefix> project current --pretty` and confirm it is the target project.
5. Run `<prefix> context --pretty` and retain its latest revision.
6. Run `<prefix> guide get --topic prototype-authoring --raw` before the first
   mutation and follow the returned guide as the current source of truth.
7. Pull another guide only when the active guide says it applies. Never preload
   every guide.

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
```

For long HTML, CSS, JavaScript, or Markdown, use `--content-file <path>` or pipe
raw text through stdin. Repeat list flags or pass comma-separated values. Use
`--input @payload.json` only when a complex or bulk operation has no native
flags; generate the file programmatically and never compose JSON inline in the
shell.

Run every DesainPakeAI operation through `<prefix>` and follow the live CLI guide
for verification, completion, revision conflicts, and recovery.
