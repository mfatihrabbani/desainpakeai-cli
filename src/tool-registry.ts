import { resolve } from "node:path";
import { z } from "zod";
import { DESIGN_SECTION_ORDER } from "./core/server/design-document.js";
import { FLAT_DESIGN_TOKEN_TYPES } from "./core/server/design-tokens.js";
import { LocalPrototypeWorkspace } from "./core/server/local-workspace.js";
import { GUIDES, GUIDE_TOPICS } from "./guides.js";
import {
  compactToolPayload,
  shapeDesignContext,
  shapeProjectContext,
} from "./output-shaping.js";
import { getReview, type ReviewClientOptions } from "./review-client.js";

const empty = z.object({}).strict();
const revision = z.string().min(1);
const sourceEdit = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("replace"), oldText: z.string().min(1), newText: z.string() }).strict(),
  z.object({ operation: z.literal("insert_before"), anchor: z.string().min(1), content: z.string() }).strict(),
  z.object({ operation: z.literal("insert_after"), anchor: z.string().min(1), content: z.string() }).strict(),
  z.object({ operation: z.literal("delete"), oldText: z.string().min(1) }).strict(),
  z.object({ operation: z.literal("prepend"), content: z.string() }).strict(),
  z.object({ operation: z.literal("append"), content: z.string() }).strict(),
]);

const schemas = {
  get_project_context: z.object({
    detail: z.enum(["compact", "full"]).optional(),
    include: z.array(z.enum(["design", "catalog", "canvas", "pageState", "product"])).max(5).optional(),
  }).strict(),
  get_review: z.object({
    output: z.string().min(1).optional(),
    reviewId: z.string().uuid(),
  }).strict(),
  get_guide: z.object({
    topic: z.enum(GUIDE_TOPICS),
  }).strict(),
  get_design_context: z.object({
    cursor: z.string().min(1).max(4_096).optional(),
    detail: z.enum(["compact", "full"]).optional(),
    include: z.array(z.enum(["components", "omitted", "storage"])).max(3).optional(),
    sections: z.array(z.string().min(1).max(100)).max(20).optional(),
  }).strict(),
  lint_design: empty,
  get_tokens: z.object({
    format: z.enum(["json", "css", "tailwind"]).optional(),
    namePattern: z.string().min(1).optional(),
    types: z.array(z.enum(FLAT_DESIGN_TOKEN_TYPES)).max(FLAT_DESIGN_TOKEN_TYPES.length).optional(),
  }).strict(),
  create_tokens: z.object({
    expectedRevision: revision,
    tokens: z.array(z.object({
      name: z.string().regex(/^--[a-z][a-z0-9-]*$/),
      type: z.enum(FLAT_DESIGN_TOKEN_TYPES),
      value: z.union([z.string().min(1), z.number()]),
    }).strict()).min(1).max(100),
  }).strict(),
  set_tokens: z.object({
    expectedRevision: revision,
    tokens: z.array(z.object({
      delete: z.boolean().optional(),
      name: z.string().regex(/^--[a-z][a-z0-9-]*$/),
      newName: z.string().regex(/^--[a-z][a-z0-9-]*$/).optional(),
      typographyRoles: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1).max(100).optional(),
      value: z.union([z.string().min(1), z.number()]).optional(),
    }).strict()).min(1).max(100),
  }).strict(),
  set_design_section: z.object({
    content: z.string(),
    expectedRevision: revision,
    heading: z.enum(DESIGN_SECTION_ORDER),
  }).strict(),
  update_design_system: z.object({
    components: z.record(
      z.string().regex(/^[a-z][a-z0-9-]*$/),
      z.record(z.string().min(1), z.union([z.string(), z.number()])).nullable(),
    ).optional(),
    expectedRevision: revision,
    metadata: z.object({
      description: z.string().min(1).nullable().optional(),
      name: z.string().min(1).nullable().optional(),
      version: z.string().min(1).nullable().optional(),
    }).strict().optional(),
    omitted: z.array(z.object({
      reason: z.string().min(1),
      section: z.string().min(1),
    }).strict()).nullable().optional(),
  }).strict(),
  get_page_states: empty,
  list_files: z.object({
    depth: z.number().int().min(0).max(8).optional(),
    path: z.string().optional(),
  }).strict(),
  grep: z.object({
    ignoreCase: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    path: z.string().optional(),
    query: z.string().min(1),
    regex: z.boolean().optional(),
    snippetChars: z.number().int().min(80).max(1_000).optional(),
  }).strict(),
  read_file: z.object({
    aroundLine: z.number().int().positive().optional(),
    contextLines: z.number().int().min(0).max(200).optional(),
    endLine: z.number().int().positive().optional(),
    full: z.boolean().optional(),
    path: z.string().min(1),
    startLine: z.number().int().positive().optional(),
  }).strict(),
  write_file: z.object({
    content: z.string(),
    expectedRevision: revision,
    overwrite: z.boolean().optional(),
    path: z.string().min(1),
  }).strict(),
  edit_file: z.object({
    edits: z.array(sourceEdit).min(1).max(50),
    expectedRevision: revision,
    path: z.string().min(1),
  }).strict(),
  create_page: z.object({
    expectedRevision: revision,
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    layout: z.string().min(1).optional(),
    name: z.string().min(1),
    route: z.string().startsWith("/"),
    viewport: z.object({
      height: z.number().int().min(320).max(2160),
      width: z.number().int().min(320).max(3840),
    }).strict().optional(),
  }).strict(),
  create_layout: z.object({
    expectedRevision: revision,
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  }).strict(),
  set_page_layout: z.object({
    expectedRevision: revision,
    layout: z.string().min(1).nullable(),
    pageId: z.string().min(1),
  }).strict(),
  create_component: z.object({
    defaults: z.record(z.string(), z.string()).optional(),
    expectedRevision: revision,
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    props: z.record(z.string(), z.string()).optional(),
    tag: z.string().regex(/^x-[a-z][a-z0-9-]*$/).optional(),
  }).strict(),
  verify_preview: z.object({ pageId: z.string().optional() }).strict(),
  finish_working_on_pages: z.object({
    pageIds: z.array(z.string().min(1)).min(1).max(100).optional(),
  }).strict(),
  export_prototype: z.object({ expectedRevision: revision }).strict(),
} as const;

export type ToolName = keyof typeof schemas;

export const TOOL_NAMES = Object.freeze(Object.keys(schemas) as ToolName[]);

export type ToolExecutionOptions = ReviewClientOptions & {
  outputPath?: string;
  workspaceRoot: string;
};

export async function executeTool(
  name: string,
  rawInput: unknown,
  options: ToolExecutionOptions,
): Promise<unknown> {
  if (!isToolName(name)) {
    throw new UnknownToolError(name);
  }
  const input: any = schemas[name].parse(rawInput ?? {});
  if (name === "get_review") return getReview(input, options);
  if (name === "get_guide") {
    return GUIDES[input.topic as keyof typeof GUIDES];
  }

  const workspace = new LocalPrototypeWorkspace(
    options.workspaceRoot,
    options.outputPath ?? resolve(options.workspaceRoot, ".output/prototype.html"),
  );

  const value = await (async () => {
    switch (name) {
    case "get_project_context": {
      const [context, design] = await Promise.all([
        workspace.getProjectContext(),
        workspace.getDesignContext(),
      ]);
      return shapeProjectContext(context, design, input);
    }
    case "get_design_context": return shapeDesignContext(
      await workspace.getDesignContext(),
      input,
    );
    case "lint_design": return workspace.lintDesign();
    case "get_tokens": return workspace.getTokens(input);
    case "create_tokens": return workspace.createTokens(input);
    case "set_tokens": return workspace.setTokens(input);
    case "set_design_section": return workspace.setDesignSection(input);
    case "update_design_system": return workspace.updateDesignSystem(input);
    case "get_page_states": return workspace.getPageStates();
    case "finish_working_on_pages": return workspace.finishWorkingOnPages(input.pageIds);
    case "list_files": return workspace.listFiles(input.path, input.depth);
    case "grep": return workspace.grep(input);
    case "read_file": return workspace.readSourceFile(
      input.path,
      input.startLine,
      input.endLine,
      input.aroundLine,
      input.contextLines,
      input.full,
    );
    case "write_file": return workspace.writeSourceFile(
      input.path,
      input.content,
      input.expectedRevision,
      input.overwrite,
    );
    case "edit_file": return workspace.editSourceFile(
      input.path,
      input.edits,
      input.expectedRevision,
    );
    case "create_page": return workspace.createPage(input);
    case "create_layout": return workspace.createLayout(input);
    case "set_page_layout": return workspace.setPageLayout(input);
    case "create_component": return workspace.createComponent(input);
    case "verify_preview": return workspace.verifyPreview(input.pageId);
    case "export_prototype": return workspace.exportPrototype(input.expectedRevision);
      default: throw new UnknownToolError(name);
    }
  })();
  return compactToolPayload(name, value);
}

export class UnknownToolError extends Error {
  readonly code = "UNKNOWN_TOOL";
  readonly suggestion = "Run 'dpai tools' to list available operations.";

  constructor(name: string) {
    super(`Unknown operation: ${name}`);
    this.name = "UnknownToolError";
  }
}

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(schemas, name);
}
