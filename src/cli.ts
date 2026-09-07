#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ZodError } from "zod";
import { authStatus, currentProject, login, logout } from "./auth-client.js";
import { WorkspaceToolError } from "./core/server/local-workspace.js";
import { CliConfigurationError } from "./errors.js";
import { executeRemoteTool } from "./remote-workspace-client.js";
import { executeTool, TOOL_NAMES, UnknownToolError } from "./tool-registry.js";

const VERSION = "0.1.1";

const ALIASES: Record<string, string> = {
  "component create": "create_component",
  context: "get_project_context",
  "design context": "get_design_context",
  "design create-tokens": "create_tokens",
  "design lint": "lint_design",
  "design set-section": "set_design_section",
  "design set-tokens": "set_tokens",
  "design tokens": "get_tokens",
  "design update": "update_design_system",
  export: "export_prototype",
  "file edit": "edit_file",
  "file grep": "grep",
  "file list": "list_files",
  "file read": "read_file",
  "file write": "write_file",
  "guide get": "get_guide",
  "layout create": "create_layout",
  "page create": "create_page",
  "page set-layout": "set_page_layout",
  "preview verify": "verify_preview",
  "review get": "get_review",
  "work finish": "finish_working_on_pages",
  "work status": "get_page_states",
};

type ParsedArguments = {
  after?: string;
  apiKey?: string;
  apiUrl?: string;
  append: boolean;
  before?: string;
  content?: string;
  contentFile?: string;
  deleteText?: string;
  expectedRevision?: string;
  exportOutput?: string;
  full: boolean;
  help: boolean;
  height?: string;
  id?: string;
  input?: string;
  layout?: string;
  name?: string;
  overwrite: boolean;
  page?: string;
  path?: string;
  positional: string[];
  prepend: boolean;
  pretty: boolean;
  query?: string;
  raw: boolean;
  replace?: string;
  route?: string;
  topic?: string;
  version: boolean;
  width?: string;
  workspace?: string;
};

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.help || args.positional.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  if (args.positional[0] === "tools") {
    writeOutput(TOOL_NAMES, args);
    return;
  }
  if (args.positional[0] === "auth") {
    const command = args.positional[1];
    if (args.positional.length !== 2 || !command) {
      throw new CliUsageError("AUTH_COMMAND_REQUIRED", "Use auth login, status, or logout.");
    }
    const result = command === "login"
      ? await login({ apiKey: args.apiKey, apiUrl: args.apiUrl })
      : command === "status"
        ? await authStatus({ apiKey: args.apiKey, apiUrl: args.apiUrl })
        : command === "logout"
          ? await logout()
          : null;
    if (!result) throw new CliUsageError("UNKNOWN_AUTH_COMMAND", `Unknown auth command: ${command}`);
    writeOutput(result, args);
    return;
  }
  if (args.positional[0] === "project" && args.positional[1] === "current") {
    if (args.positional.length !== 2) {
      throw new CliUsageError("UNEXPECTED_ARGUMENT", "project current does not accept positional arguments.");
    }
    writeOutput(await currentProject({ apiKey: args.apiKey, apiUrl: args.apiUrl }), args);
    return;
  }

  const { consumed, toolName } = resolveInvocation(args.positional);
  if (args.positional.length > consumed) {
    throw new CliUsageError(
      "UNEXPECTED_ARGUMENT",
      `Unexpected positional arguments: ${args.positional.slice(consumed).join(" ")}`,
    );
  }
  if (!TOOL_NAMES.includes(toolName as (typeof TOOL_NAMES)[number])) {
    throw new UnknownToolError(toolName);
  }
  const configuredWorkspace = args.workspace ?? process.env.DPAI_WORKSPACE;
  const workspaceRoot = configuredWorkspace
    ? await findWorkspaceRoot(configuredWorkspace)
    : undefined;
  const execute = (name: string, value: unknown) => workspaceRoot
    ? executeTool(name, value, {
      apiKey: args.apiKey,
      apiUrl: args.apiUrl,
      outputPath: args.exportOutput ? resolve(args.exportOutput) : undefined,
      workspaceRoot,
    })
    : executeRemoteTool(name, value, { apiKey: args.apiKey, apiUrl: args.apiUrl });
  if (toolName === "get_review") {
    const input = args.input ? await readJsonInput(args.input) : {};
    const result = await executeTool(toolName, input, {
      apiKey: args.apiKey,
      apiUrl: args.apiUrl,
      workspaceRoot: resolve(args.workspace ?? process.cwd()),
    });
    writeOutput(result, args);
    return;
  }
  const input = args.input
    ? await readJsonInput(args.input)
    : await createConvenienceInput(toolName, args, () => readCurrentRevision(execute));
  const result = await execute(toolName, input);
  writeOutput(result, args);
}

function parseArguments(values: string[]): ParsedArguments {
  const result: ParsedArguments = {
    append: false,
    full: false,
    help: false,
    overwrite: false,
    positional: [],
    prepend: false,
    pretty: false,
    raw: false,
    version: false,
  };
  const valueFlags: Record<string, keyof ParsedArguments> = {
    "--after": "after",
    "--api-key": "apiKey",
    "--api-url": "apiUrl",
    "--before": "before",
    "--content": "content",
    "--content-file": "contentFile",
    "--delete": "deleteText",
    "--expected-revision": "expectedRevision",
    "--export-output": "exportOutput",
    "--height": "height",
    "--id": "id",
    "--input": "input",
    "--layout": "layout",
    "--name": "name",
    "--page": "page",
    "--path": "path",
    "--query": "query",
    "--replace": "replace",
    "--route": "route",
    "--topic": "topic",
    "--width": "width",
    "--workspace": "workspace",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === "--help" || value === "-h") result.help = true;
    else if (value === "--version" || value === "-v") result.version = true;
    else if (value === "--append") result.append = true;
    else if (value === "--full") result.full = true;
    else if (value === "--overwrite") result.overwrite = true;
    else if (value === "--prepend") result.prepend = true;
    else if (value === "--pretty") result.pretty = true;
    else if (value === "--raw") result.raw = true;
    else if (value.startsWith("--") && value.includes("=")) {
      const [flag, ...parts] = value.split("=");
      const key = valueFlags[flag!];
      if (!key) throw new CliUsageError("UNKNOWN_OPTION", `Unknown option: ${flag}`);
      (result as Record<string, unknown>)[key] = parts.join("=");
    } else if (valueFlags[value]) {
      const next = values[index + 1];
      if (!next) throw new CliUsageError("OPTION_VALUE_REQUIRED", `${value} requires a value.`);
      (result as Record<string, unknown>)[valueFlags[value]!] = next;
      index += 1;
    } else if (value.startsWith("-")) {
      throw new CliUsageError("UNKNOWN_OPTION", `Unknown option: ${value}`);
    } else {
      result.positional.push(value);
    }
  }
  return result;
}

function resolveInvocation(positional: string[]) {
  if (positional[0] === "call") {
    const toolName = positional[1];
    if (!toolName) throw new CliUsageError("TOOL_REQUIRED", "'dpai call' requires an operation name.");
    return { consumed: 2, toolName };
  }
  const pair = positional.slice(0, 2).join(" ");
  if (ALIASES[pair]) return { consumed: 2, toolName: ALIASES[pair] };
  const single = ALIASES[positional[0]!];
  if (single) return { consumed: 1, toolName: single };
  throw new UnknownToolError(positional.slice(0, 2).join(" "));
}

async function readJsonInput(source?: string): Promise<unknown> {
  if (!source) return {};
  let text: string;
  if (source === "-") text = await readStdin();
  else if (source.startsWith("@")) text = await readFile(resolve(source.slice(1)), "utf8");
  else text = source;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new CliUsageError(
      "INVALID_JSON_INPUT",
      error instanceof Error ? error.message : "Input is not valid JSON.",
    );
  }
}

async function createConvenienceInput(
  toolName: string,
  args: ParsedArguments,
  readRevision: () => Promise<string>,
): Promise<unknown> {
  const revision = async () => args.expectedRevision ?? await readRevision();
  const content = async () => {
    if (args.content !== undefined && args.contentFile !== undefined) {
      throw new CliUsageError(
        "CONTENT_SOURCE_CONFLICT",
        "Use either --content or --content-file, not both.",
      );
    }
    if (args.contentFile !== undefined) return readFile(resolve(args.contentFile), "utf8");
    if (args.content !== undefined) return args.content;
    if (!process.stdin.isTTY) {
      const stdin = (await readStdin()).replace(/^\uFEFF/, "");
      if (stdin.length > 0) return stdin;
    }
    throw new CliUsageError(
      "CONTENT_REQUIRED",
      "Pipe content through stdin, or use --content <text> or --content-file <path>.",
    );
  };

  if (toolName === "read_file" && args.path) {
    return { full: args.full || undefined, path: args.path };
  }
  if (toolName === "get_guide" && args.topic) return { topic: args.topic };
  if (toolName === "grep" && args.query) {
    return { path: args.path, query: args.query };
  }
  if (toolName === "write_file" && args.path) {
    return {
      content: await content(),
      expectedRevision: await revision(),
      overwrite: args.overwrite || undefined,
      path: args.path,
    };
  }
  if (toolName === "edit_file" && args.path) {
    const modes = [
      args.before !== undefined,
      args.after !== undefined,
      args.replace !== undefined,
      args.deleteText !== undefined,
      args.append,
      args.prepend,
    ];
    if (modes.filter(Boolean).length !== 1) {
      throw new CliUsageError(
        "EDIT_MODE_REQUIRED",
        "Choose exactly one of --before, --after, --replace, --delete, --append, or --prepend.",
      );
    }
    const edit = args.deleteText !== undefined
      ? { oldText: args.deleteText, operation: "delete" }
      : args.before !== undefined
        ? { anchor: args.before, content: await content(), operation: "insert_before" }
        : args.after !== undefined
          ? { anchor: args.after, content: await content(), operation: "insert_after" }
          : args.replace !== undefined
            ? { newText: await content(), oldText: args.replace, operation: "replace" }
            : args.append
              ? { content: await content(), operation: "append" }
              : { content: await content(), operation: "prepend" };
    return {
      edits: [edit],
      expectedRevision: await revision(),
      path: args.path,
    };
  }
  if (toolName === "create_page" && (args.id || args.name || args.route)) {
    if (!args.id || !args.name || !args.route) {
      throw new CliUsageError(
        "PAGE_FIELDS_REQUIRED",
        "page create requires --id, --name, and --route.",
      );
    }
    const viewport = parseViewport(args.width, args.height);
    return {
      expectedRevision: await revision(),
      id: args.id,
      layout: args.layout,
      name: args.name,
      route: args.route,
      viewport,
    };
  }
  if (toolName === "create_layout" && args.id) {
    return { expectedRevision: await revision(), id: args.id };
  }
  if (toolName === "create_component" && args.id) {
    return { expectedRevision: await revision(), id: args.id };
  }
  if (toolName === "set_page_layout" && args.page && args.layout) {
    return { expectedRevision: await revision(), layout: args.layout, pageId: args.page };
  }
  if (toolName === "verify_preview" && args.page) return { pageId: args.page };
  if (toolName === "finish_working_on_pages" && args.page) {
    return { pageIds: args.page.split(",").map((page) => page.trim()).filter(Boolean) };
  }
  return {};
}

async function readCurrentRevision(
  execute: (name: string, input: unknown) => Promise<unknown>,
) {
  const context = await execute("get_project_context", {}) as {
    revision?: unknown;
  };
  if (typeof context.revision !== "string") {
    throw new CliUsageError("REVISION_UNAVAILABLE", "Unable to read the current workspace revision.");
  }
  return context.revision;
}

function parseViewport(width?: string, height?: string) {
  if (width === undefined && height === undefined) return undefined;
  if (width === undefined || height === undefined) {
    throw new CliUsageError("VIEWPORT_FIELDS_REQUIRED", "Use --width and --height together.");
  }
  const parsedWidth = Number(width);
  const parsedHeight = Number(height);
  if (!Number.isInteger(parsedWidth) || !Number.isInteger(parsedHeight)) {
    throw new CliUsageError("INVALID_VIEWPORT", "--width and --height must be integers.");
  }
  return { height: parsedHeight, width: parsedWidth };
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function findWorkspaceRoot(explicit?: string) {
  if (explicit) return assertWorkspace(resolve(explicit));
  if (process.env.DPAI_WORKSPACE) return assertWorkspace(resolve(process.env.DPAI_WORKSPACE));

  let current = resolve(process.cwd());
  while (true) {
    if (await isFile(resolve(current, "prototype.json"))) return current;
    const nested = resolve(current, "src/features/prototype/workspace");
    if (await isFile(resolve(nested, "prototype.json"))) return nested;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new CliUsageError(
    "WORKSPACE_NOT_FOUND",
    "Unable to find a prototype.json workspace.",
    "Run from a prototype workspace or pass --workspace <path>.",
  );
}

async function assertWorkspace(path: string) {
  if (!await isFile(resolve(path, "prototype.json"))) {
    throw new CliUsageError(
      "WORKSPACE_NOT_FOUND",
      `No prototype.json was found in ${path}.`,
    );
  }
  return path;
}

async function isFile(path: string) {
  return (await stat(path).catch(() => undefined))?.isFile() ?? false;
}

function writeOutput(value: unknown, args: Pick<ParsedArguments, "pretty" | "raw">) {
  if (args.raw && typeof value === "string") {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, args.pretty ? 2 : undefined)}\n`);
}

function serializeError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      code: "VALIDATION_FAILED",
      details: error.flatten(),
      message: "Command input did not match the operation schema.",
      suggestion: "Run 'dpai tools' and check the CLI reference in the bundled skill.",
    };
  }
  if (
    error instanceof WorkspaceToolError
    || error instanceof CliConfigurationError
    || error instanceof CliUsageError
    || error instanceof UnknownToolError
  ) {
    return {
      code: error.code,
      details: error instanceof WorkspaceToolError ? error.details : {},
      message: error.message,
      suggestion: error.suggestion,
    };
  }
  return {
    code: "COMMAND_FAILED",
    details: {},
    message: error instanceof Error ? error.message : String(error),
  };
}

class CliUsageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = "CliUsageError";
  }
}

const HELP = `DesainPakeAI CLI ${VERSION}

Usage:
  dpai tools [--pretty]
  dpai auth login --api-url <url> --api-key <dpai_key>
  dpai auth status|logout
  dpai project current
  dpai call <operation> [--workspace <path>] [--input <json|@file|->]
  dpai <group> <command> [options]

Comfortable authoring:
  dpai page create --id activity --name "Activity" --route /activity --layout app-shell
  dpai file read --path src/pages/activity.page.html --full
  dpai file edit --path src/pages/activity.page.html --before "<!-- agent:page-sections -->" --content-file section.html
  dpai file edit --path src/pages/activity.page.html --before "<!-- agent:page-sections -->" < section.html
  dpai preview verify --page activity
  dpai work finish --page activity

Aliases:
  context
  design context|lint|tokens|create-tokens|set-tokens|set-section|update
  guide get
  file list|grep|read|write|edit
  page create|set-layout
  layout create
  component create
  preview verify
  work status|finish
  review get
  export

Options:
  --workspace <path>       Use a local prototype workspace instead of the active remote project
  --input <json|@file|->   Operation input (defaults to {})
  --path <path>            Workspace source path for file commands
  --content-file <path>    Read write/edit content from a plain text file
  --content <text>         Use short inline write/edit content
                           Without either flag, native file commands read raw stdin
  --before|--after <text>  Insert content around a unique anchor
  --replace|--delete <text> Replace with content, or delete matching text
  --append|--prepend       Add content at the end or start of a source file
  --id --name --route      Native page-create fields (revision is automatic)
  --layout <id>            Layout for page create or page set-layout
  --page <id[,id...]>      Page target for verify and finish
  --topic <topic>          Guide topic for guide get
  --expected-revision <id> Optional explicit revision for native flags
  --export-output <path>   Override export output path
  --api-url <url>          DesainPakeAI application URL
  --api-key <dpai_key>     Existing DesainPakeAI MCP API key
  --pretty                 Pretty-print JSON
  --raw                    Print a string result without JSON quoting
  --help                   Show help
  --version                Show version
`;

await main().catch((error) => {
  const payload = serializeError(error);
  process.stderr.write(`${JSON.stringify({ error: payload }, null, 2)}\n`);
  process.exitCode = 1;
});
