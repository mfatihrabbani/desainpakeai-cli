# DesainPakeAI CLI

Standalone, agent-friendly CLI for the dependency-free DesainPakeAI prototype
workspace. It exposes the complete workspace operation surface as deterministic
CLI commands and packages the authoring workflow as a Codex skill.

## Install the CLI and skill

```powershell
npm install --global desainpakeai-cli@latest
npx skills add mfatihrabbani/desainpakeai-cli -g
dpai --version
```

If installation reports `EEXIST` for the `dpai` binary from an older beta,
run `npm uninstall --global @desainpakeai/cli`, then retry the install. Do not
use `--force`.

The global binary avoids repeated `npx` startup cost. Start with `dpai --version`.
Install the package only when the command is unavailable, or update it when the
user explicitly requests synchronization. Then use `dpai` for every operation
in the continuous task.

Log in once, then omit `--workspace` to target the active PostgreSQL project:

```powershell
dpai auth login --api-url https://desainpakeai.com --api-key dpai_REDACTED
dpai project current --pretty
dpai context --pretty
```

The bundled skill routes authoring through the CLI guide source of truth. It
fetches `dpai guide get --topic workspace-authoring --raw` once before the first
source mutation, then reuses it across follow-up tasks for the same session,
project, and runtime. Optional domain guides are fetched only when relevant,
for example `dpai guide get --topic design-quality --raw`. Explicit local
workspace mode and fallback for older applications use the matching guide
bundled with the selected CLI version.

Pass `--workspace` only for explicit filesystem-local work:

```bash
dpai context --workspace /path/to/workspace
dpai file read --workspace /path/to/workspace --path src/pages/home.page.html --full
```

## Comfortable authoring without JSON

Native authoring flags automatically read the latest workspace revision while
preserving the revision guard. Send long HTML or CSS as raw stdin with a Bash
heredoc:

```bash
dpai page create \
  --id activity \
  --name "Activity" \
  --route activity \
  --layout app-shell

dpai file edit \
  --path src/pages/activity.page.html \
  --before '<!-- agent:page-sections -->' <<'HTML'
<section data-node-id="activity.feed">
  <h2>Recent activity</h2>
</section>
HTML

dpai preview verify --page activity --pretty
dpai work finish --page activity --pretty
```

For native `page create`, the leading route slash is optional and the CLI adds
it automatically. Prefer `--route activity` in shell commands: unlike
`--route /activity`, it cannot be rewritten into a Windows path by Git
Bash/MSYS. The CLI also repairs the standard MSYS-converted form when the MSYS
installation root is available, and rejects other Windows paths with a targeted
error instead of creating a malformed route.

Use `--content-file section.html` instead of a heredoc when a file-based flow
is more convenient. `--content` handles short inline changes.

For exact multiline replacement, keep the old and new text in UTF-8 files:

```bash
dpai file edit \
  --path src/pages/activity.page.html \
  --replace-file old-section.html \
  --content-file new-section.html
```

For several related replacements, apply one standard unified diff atomically:

```bash
dpai file patch \
  --path src/pages/activity.page.html \
  --patch-file activity.diff
```

`file patch` converts each hunk into a guarded partial replacement. It accepts
one source file and at most 50 hunks; each hunk needs context so its anchor stays
unique. Raw stdin also works: `dpai file patch --path <path> < changes.diff`.
On Windows PowerShell 5.1, prefer UTF-8 files for non-ASCII content because the
shell may replace characters before they reach a native program through stdin.

Design and component work also has native commands:

```bash
dpai design context --detail compact --section Overview,Components --pretty
dpai token list --type color,spacing --format css
dpai token create --name --color-accent --type color --value "#635bff"
dpai token set --name --color-accent --value "#574ee8"
dpai token delete --name --color-legacy
dpai design set-section --heading Overview --content-file overview.md
dpai component create --id status-pill --tag x-status-pill \
  --prop tone="Visual tone" --default tone=neutral
dpai review get --review 00000000-0000-4000-8000-000000000000 --output review.png
```

List flags may be repeated or comma-separated. File reads and searches support
native line, depth, regex, case, and result-limit flags; run `--help` for the
complete reference.

## Login and active project

Use the `dpai_...` access key created from **Siapkan CLI** in DesainPakeAI:

```powershell
dpai auth login --api-url https://desainpakeai.com --api-key dpai_REDACTED
dpai auth status --pretty
dpai project current --pretty
```

The key is validated through `/api/cli/session`. Workspace commands use
`/api/cli/workspace/:operation` and do not require a persistent connection. The live
response identifies the active project by ID, name, and role. Switching the
active project in DesainPakeAI is reflected by the next `project current` call.
Credentials are stored outside the repository in the user configuration
directory. Use the same release URL with `auth logout` to remove them.

Remote requests send the CLI version and a non-sensitive harness label for the
DesainPakeAI admin activity monitor. Codex, Claude Code, Cursor Agent, Gemini
CLI, OpenCode, Windsurf, and VS Code are detected from their process
environment. Other harnesses can identify themselves without changing request
payloads:

```powershell
$env:DPAI_AGENT_HARNESS = "my-harness"
$env:DPAI_AGENT_VERSION = "1.0.0"
dpai context --pretty
```

These values are labels only. The CLI never sends environment contents,
credentials, prompts, file contents, or command payloads as telemetry.

Every operation is also available through the stable tool-name interface:

```bash
dpai tools
dpai call get_project_context
dpai call create_page --input @create-page.json
```

Do not handwrite JSON in the shell. Native commands cover ordinary reads,
single-file writes and edits, unified patches, page/layout/component creation,
tokens, design sections and metadata, verification, progress, review download,
and export.

JSON input remains only as an advanced escape hatch:

| Remaining case | Prefer without JSON | Use JSON only when |
| --- | --- | --- |
| Mixed atomic file edits | `file edit` or `file patch` | one transaction must mix insert, delete, prepend, and append operations |
| Token batches | repeated `token create`, `token set`, or `token delete` | many token changes must succeed or fail as one atomic batch |
| Full design-system structures | `design update` for metadata and `design set-section` for guidance | updating component recipes or the complete omissions list |
| Low-level integration/debugging | the named native command | exercising the stable operation API directly |

For those cases, generate a UTF-8 payload file and pass `--input @file.json`;
`--input -` accepts generated JSON from stdin. Results remain JSON by default.
Use `--pretty` for formatted output or `--raw` for guide and other string
results. `design context --cursor <value>` paginates long requested sections.

## Scope

Remote mode is the default and targets the active project selected in the
DesainPakeAI application. It preserves project access checks, revision guards,
database persistence, Canvas events, and page-working state through an
authenticated command API.

Local mode remains available with `--workspace <path>` or `DPAI_WORKSPACE`.
`get_review` always uses the stored API key and active project, then writes the
downloaded image to the requested local output path.
