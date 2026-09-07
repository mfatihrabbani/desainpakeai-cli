# DesainPakeAI CLI

Standalone, agent-friendly CLI for the dependency-free DesainPakeAI prototype
workspace. It exposes the complete workspace MCP operation surface as
deterministic CLI commands and packages the authoring workflow as a Codex skill.

## Run the latest CLI

```powershell
npx --yes --prefer-online @desainpakeai/cli@latest --version
```

No global installation is required. Log in once, then omit `--workspace` to
target the active PostgreSQL project:

```powershell
npx --yes --prefer-online @desainpakeai/cli@latest auth login --api-url https://desainpakeai.com --api-key dpai_REDACTED
npx --yes --prefer-online @desainpakeai/cli@latest project current --pretty
npx --yes --prefer-online @desainpakeai/cli@latest context --pretty
npx --yes --prefer-online @desainpakeai/cli@latest guide get --topic prototype-authoring --raw
```

Remote guides are served by the DesainPakeAI application, so guide updates do
not require a new CLI or skill release. Explicit local workspace mode uses the
guide bundled with the selected CLI version as an offline fallback.

Pass `--workspace` only for explicit filesystem-local work:

```bash
npx --yes --prefer-online @desainpakeai/cli@latest context --workspace /path/to/workspace
npx --yes --prefer-online @desainpakeai/cli@latest file read --workspace /path/to/workspace --path src/pages/home.page.html --full
```

## Comfortable authoring without JSON

Native authoring flags automatically read the latest workspace revision while
preserving the revision guard. Send long HTML or CSS as raw stdin with a Bash
heredoc:

```bash
npx --yes --prefer-online @desainpakeai/cli@latest page create \
  --id activity \
  --name "Activity" \
  --route /activity \
  --layout app-shell

npx --yes --prefer-online @desainpakeai/cli@latest file edit \
  --path src/pages/activity.page.html \
  --before '<!-- agent:page-sections -->' <<'HTML'
<section data-node-id="activity.feed">
  <h2>Recent activity</h2>
</section>
HTML

npx --yes --prefer-online @desainpakeai/cli@latest preview verify --page activity --pretty
npx --yes --prefer-online @desainpakeai/cli@latest work finish --page activity --pretty
```

Use `--content-file section.html` instead of a heredoc when a file-based flow
is more convenient. `--content` handles short inline changes. The strict
`--input` interface remains available for automation and compatibility.

## Login and active project

Use the same `dpai_...` API key created for the DesainPakeAI MCP connection:

```powershell
npx --yes --prefer-online @desainpakeai/cli@latest auth login --api-url https://desainpakeai.com --api-key dpai_REDACTED
npx --yes --prefer-online @desainpakeai/cli@latest auth status --pretty
npx --yes --prefer-online @desainpakeai/cli@latest project current --pretty
```

The key is validated through the non-MCP `/api/cli/session` endpoint. Workspace
commands use `/api/cli/workspace/:operation`; they do not initialize or tunnel
through MCP. The live
response identifies the active project by ID, name, and role. Switching the
active project in DesainPakeAI is reflected by the next `project current` call.
Credentials are stored outside the repository in the user configuration
directory. Use `npx --yes @desainpakeai/cli@latest auth logout` to remove them.

Every operation is also available through the stable tool-name interface:

```bash
npx --yes --prefer-online @desainpakeai/cli@latest tools
npx --yes --prefer-online @desainpakeai/cli@latest call get_project_context
npx --yes --prefer-online @desainpakeai/cli@latest call get_guide --input '{"topic":"design-quality"}' --raw
npx --yes --prefer-online @desainpakeai/cli@latest call create_page --input @create-page.json
```

Complex input can be supplied as inline JSON, `@file.json`, or stdin using
`--input -`. Results are JSON by default. Use `--pretty` for formatted output
or `--raw` for guide and other string results. `get_design_context` also
supports the MCP-compatible `cursor` field for paginating long requested
sections.

## Scope

Remote mode is the default and targets the active project selected in the
DesainPakeAI application. It preserves project access checks, revision guards,
database persistence, Canvas events, and page-working state through an
authenticated non-MCP command API.

Local mode remains available with `--workspace <path>` or `DPAI_WORKSPACE`.
`get_review` always uses the stored API key and active project, then writes the
downloaded image to the requested local output path.
