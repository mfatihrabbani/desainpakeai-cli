# DesainPakeAI CLI

Standalone, agent-friendly CLI for the dependency-free DesainPakeAI prototype
workspace. It exposes the complete workspace operation surface as deterministic
CLI commands and packages the authoring workflow as a Codex skill.

## Run the latest CLI

```powershell
npx desainpakeai-cli@latest --version
```

No global installation is required. Log in once, then omit `--workspace` to
target the active PostgreSQL project:

```powershell
npx desainpakeai-cli@latest auth login --api-url https://desainpakeai.com --api-key dpai_REDACTED
npx desainpakeai-cli@latest project current --pretty
npx desainpakeai-cli@latest context --pretty
npx desainpakeai-cli@latest guide get --topic prototype-authoring --raw
```

Remote guides are served by the DesainPakeAI application, so guide updates do
not require a new CLI or skill release. Explicit local workspace mode uses the
guide bundled with the selected CLI version as an offline fallback.

Pass `--workspace` only for explicit filesystem-local work:

```bash
npx desainpakeai-cli@latest context --workspace /path/to/workspace
npx desainpakeai-cli@latest file read --workspace /path/to/workspace --path src/pages/home.page.html --full
```

## Comfortable authoring without JSON

Native authoring flags automatically read the latest workspace revision while
preserving the revision guard. Send long HTML or CSS as raw stdin with a Bash
heredoc:

```bash
npx desainpakeai-cli@latest page create \
  --id activity \
  --name "Activity" \
  --route /activity \
  --layout app-shell

npx desainpakeai-cli@latest file edit \
  --path src/pages/activity.page.html \
  --before '<!-- agent:page-sections -->' <<'HTML'
<section data-node-id="activity.feed">
  <h2>Recent activity</h2>
</section>
HTML

npx desainpakeai-cli@latest preview verify --page activity --pretty
npx desainpakeai-cli@latest work finish --page activity --pretty
```

Use `--content-file section.html` instead of a heredoc when a file-based flow
is more convenient. `--content` handles short inline changes.

Design and component work also has native commands:

```bash
npx desainpakeai-cli@latest design context --detail compact --section Overview,Components --pretty
npx desainpakeai-cli@latest token list --type color,spacing --format css
npx desainpakeai-cli@latest token create --name --color-accent --type color --value "#635bff"
npx desainpakeai-cli@latest token set --name --color-accent --value "#574ee8"
npx desainpakeai-cli@latest token delete --name --color-legacy
npx desainpakeai-cli@latest design set-section --heading Overview --content-file overview.md
npx desainpakeai-cli@latest component create --id status-pill --tag x-status-pill \
  --prop tone="Visual tone" --default tone=neutral
npx desainpakeai-cli@latest review get --review 00000000-0000-4000-8000-000000000000 --output review.png
```

List flags may be repeated or comma-separated. File reads and searches support
native line, depth, regex, case, and result-limit flags; run `--help` for the
complete reference.

## Login and active project

Use the `dpai_...` access key created from **Siapkan CLI** in DesainPakeAI:

```powershell
npx desainpakeai-cli@latest auth login --api-url https://desainpakeai.com --api-key dpai_REDACTED
npx desainpakeai-cli@latest auth status --pretty
npx desainpakeai-cli@latest project current --pretty
```

The key is validated through `/api/cli/session`. Workspace commands use
`/api/cli/workspace/:operation` and do not require a persistent connection. The live
response identifies the active project by ID, name, and role. Switching the
active project in DesainPakeAI is reflected by the next `project current` call.
Credentials are stored outside the repository in the user configuration
directory. Use the same release URL with `auth logout` to remove them.

Every operation is also available through the stable tool-name interface:

```bash
npx desainpakeai-cli@latest tools
npx desainpakeai-cli@latest call get_project_context
npx desainpakeai-cli@latest call create_page --input @create-page.json
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
