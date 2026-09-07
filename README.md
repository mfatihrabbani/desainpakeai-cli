# DesainPakeAI CLI

Standalone, agent-friendly CLI for the dependency-free DesainPakeAI prototype
workspace. It exposes the complete workspace operation surface as deterministic
CLI commands and packages the authoring workflow as a Codex skill.

## Install the CLI and skill

```powershell
npm install --global desainpakeai-cli@latest
npx skills add mfatihrabbani/desainpakeai-cli -g -y
dpai --version
```

If installation reports `EEXIST` for the `dpai` binary from an older beta,
run `npm uninstall --global @desainpakeai/cli`, then retry the install. Do not
use `--force`.

The global binary avoids repeated `npx` startup cost. At the beginning of a new
agent task, run `npm install --global desainpakeai-cli@latest` once to check for
and install a newer release. Then use `dpai` for every operation in that task.

Log in once, then omit `--workspace` to target the active PostgreSQL project:

```powershell
dpai auth login --api-url https://desainpakeai.com --api-key dpai_REDACTED
dpai project current --pretty
dpai context --pretty
dpai guide get --topic prototype-authoring --raw
```

Remote guides are served by the DesainPakeAI application, so guide updates do
not require a new CLI or skill release. Explicit local workspace mode uses the
guide bundled with the selected CLI version as an offline fallback.

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
  --route /activity \
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

Use `--content-file section.html` instead of a heredoc when a file-based flow
is more convenient. `--content` handles short inline changes.

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

Every operation is also available through the stable tool-name interface:

```bash
dpai tools
dpai call get_project_context
dpai call create_page --input @create-page.json
```

Do not handwrite JSON in the shell. `--input @file.json` remains an escape hatch
for complex or bulk operations that do not have native flags; `--input -` can
read a generated JSON payload from stdin. Results are JSON by default. Use
`--pretty` for formatted output or `--raw` for guide and other string results.
`design context --cursor <value>` paginates long requested sections.

## Scope

Remote mode is the default and targets the active project selected in the
DesainPakeAI application. It preserves project access checks, revision guards,
database persistence, Canvas events, and page-working state through an
authenticated command API.

Local mode remains available with `--workspace <path>` or `DPAI_WORKSPACE`.
`get_review` always uses the stored API key and active project, then writes the
downloaded image to the requested local output path.
