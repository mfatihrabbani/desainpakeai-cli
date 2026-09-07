---
name: desainpakeai-prototype
description: Build, inspect, edit, verify, and export dependency-free DesainPakeAI prototype workspaces with the dpai CLI. Use for prototype pages, layouts, components, design tokens, DESIGN.md guidance, visual-review retrieval, canvas working state, or single-HTML export. Do not use for the TanStack host UI or legacy prototype templates.
---

# DesainPakeAI Prototype

Use the latest `dpai` CLI through this command prefix:

```text
npx --yes --prefer-online @desainpakeai/cli@latest
```

Do not initialize or call a DesainPakeAI MCP server. Do not use a globally
installed `dpai` binary.

## Start every task

1. Run `<prefix> auth status --pretty`. If authentication is missing, ask the
   user to run `<prefix> auth login --api-url <url> --api-key <dpai_key>`.
2. Run `<prefix> project current --pretty` and confirm it is the target project.
3. Run `<prefix> context --pretty` and retain its latest revision.
4. Run `<prefix> guide get --topic prototype-authoring --raw` before the first
   mutation and follow the returned guide as the current source of truth.
5. Pull another guide only when the active guide says it applies. Never preload
   every guide.

Use `--workspace <path>` only when the user explicitly requests filesystem-local
work. Pass complex inputs with `--input @file.json` or `--input -`. Carry forward
the revision returned by every successful mutation.

Run every DesainPakeAI operation through `<prefix>` and follow the live CLI guide
for verification, completion, revision conflicts, and recovery.
