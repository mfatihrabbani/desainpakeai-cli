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

Treat a successful authenticated CLI command as the connection signal. Creating
or copying an API key alone does not prove that the coding agent is connected.
Do not initialize, call, or wait for an MCP handshake endpoint.

Use `--workspace <path>` only when the user explicitly requests filesystem-local
work. Carry forward the revision returned by every successful mutation.

This skill owns the core authoring workflow; do not fetch a separate baseline
authoring guide.

## Guide catalog and timing

Guides are optional task-specific references. Pull only one immediately before
the first decision it covers, reuse it for that continuous task, and fetch
another only when a new unresolved risk appears. Never preload all guides.

- `design-quality` - substantive visual design decisions.
- `accessibility` - keyboard, focus, forms, ARIA, or zoom.
- `layout-responsive` - responsive layout, overflow, RTL, or long content.
- `typography` - typography, wrapping, truncation, or bidirectional text.
- `color-system` - tokens, themes, status colors, or contrast.
- `product-writing` - labels, errors, empty states, or localization.
- `ui-polish-motion` - surfaces, icons, motion, or visual states.
- `prototype-interactions` - modals, selects, filters, forms, or stateful UI.
- `evidence-and-reference` - external pages, screenshots, or supplied references.
- `image-to-prototype` - reconstructing a supplied UI image or screenshot.
- `interface-review` - only for a user-requested interface review.
- `component-stress-test` - only for a user-requested stress test.
- `variant-exploration` - only for user-requested design variants.
- `prototype-to-codebase` - only for a user-requested codebase handoff.

Fetch a guide with `<prefix> guide get --topic <topic> --raw` only when its
trigger matches the current task. Fetch `design-quality` before substantive
visual design, but skip it for non-visual maintenance, canvas positioning,
export-only work, manifest inspection, and narrow fixes. Do not fetch user-gated
guides based on inference.

## Authoring contract

- Keep workspace source dependency-free HTML, CSS, and JavaScript. Never add
  React, JSX, TSX, framework or package imports, runtime dependencies, Tailwind
  directives, or host-only utility classes.
- Before visual UI work, run `<prefix> design context --pretty` and
  `<prefix> token list`. Treat DESIGN.md guidance, registered components, and
  runtime tokens as constraints when present. Keep exploratory values
  page-local when they are absent.
- Reuse a registered component when available. Create or register a component
  only when the user explicitly requests it or asks for reusable extraction;
  otherwise keep the implementation page-owned.
- Work on one page at a time. A page-create command only creates its skeleton
  and Canvas frame. Add one visual or workflow group per initial file edit and
  never run page mutations in parallel.
- Create or change persistent tokens only after the user selects a direction or
  explicitly asks to save them.
- Preserve stable `data-node-id`, `data-component`, `data-part`, `data-action`,
  bridge attributes, and public props. Prefer an existing token over a
  hardcoded reusable value.
- Use `<iconify-icon icon="collection:name">` directly without adding a loader
  or wrapper. Give icon-only controls an `aria-label` and mark decorative icons
  `aria-hidden="true"`.
- After completing a page, run `<prefix> preview verify --page <page-id>`, fix
  applicable diagnostics, verify again if needed, then run
  `<prefix> work finish --page <page-id>`.

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

## Show page progress section by section

For a new page, expose real Canvas progress with two sequential commands per
section. First insert only one visible section shell before
`<!-- agent:page-sections -->`. Give it the final semantic element, stable
`data-node-id`, outer inline layout or surface, enough block size to render, and
a unique nested `<!-- agent:<page>.<section>-content -->` anchor. Then insert
that section's content before its nested anchor and keep the anchor for future
partial edits.

Finish one section before creating the next, carry forward the revision from
every command, and never run page mutations in parallel. Each successful edit
is persisted and becomes a Canvas progress update. Run `preview verify` only
after the page is complete unless a mutation reports a problem.

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

Run every DesainPakeAI operation through `<prefix>` and use command output for
verification, completion, revision conflicts, and recovery.
