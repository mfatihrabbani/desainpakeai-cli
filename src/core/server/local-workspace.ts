import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import {
  compileComponentPreviews,
  compileSingleHtml,
  type SingleHtmlManifest,
} from "../compiler/compiler.js";
import {
  createDefaultCanvas,
  parseCanvasFile,
} from "../model/canvas-state.js";
import {
  createEmptyAgentPageState,
  parseAgentPageState,
  type AgentPageActivity,
  type AgentPageStateFile,
} from "../model/agent-page-state.js";
import {
  assertValidDesignDocument,
  DesignValidationError,
  getDesignContext as parseDesignContext,
  lintDesignDocument,
  setDesignSection as updateDesignSection,
  type DesignSectionName,
  type DesignSystemUpdate,
  updateDesignSystem as applyDesignSystemUpdate,
} from "./design-document.js";
import {
  createFlatDesignTokens,
  type CreateFlatDesignToken,
  type FlatDesignTokenType,
  readFlatDesignTokens,
  setFlatDesignTokens,
  type SetFlatDesignToken,
  syncFlatTokensToDesignDocument,
} from "./design-tokens.js";

const MAX_READ_BYTES = 512 * 1024;
const MAX_UNRANGED_READ_BYTES = 64 * 1024;
const MAX_GREP_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_GREP_SNIPPET_CHARS = 320;
const AGENT_PAGE_STATE_PATH = ".prototype/agent-state.json";
const WRITABLE_MODULE = /^src\/(pages\/[^/]+\.page\.html|layouts\/[^/]+\.layout\.html|components\/[^/]+\.component\.html|styles\/[^/]+\.css)$/;
const REGISTERED_MODULE = /^src\/(pages\/[^/]+\.page\.html|layouts\/[^/]+\.layout\.html|components\/[^/]+\.component\.html)$/;
const BROAD_EDIT_MIN_ANCHOR_LENGTH = 256;
const BROAD_EDIT_MAX_SOURCE_RATIO = 0.6;
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".ts"]);

export type CreatePageInput = {
  expectedRevision: string;
  id: string;
  layout?: string;
  name: string;
  route: string;
  viewport?: { height: number; width: number };
};

export type CreateLayoutInput = {
  expectedRevision: string;
  id: string;
};

export type CreateComponentInput = {
  defaults?: Record<string, string>;
  expectedRevision: string;
  id: string;
  props?: Record<string, string>;
  tag?: string;
};

export type SetDesignSectionInput = {
  content: string;
  expectedRevision: string;
  heading: DesignSectionName;
};

export type SetPageLayoutInput = {
  expectedRevision: string;
  layout: string | null;
  pageId: string;
};

export type UpdateDesignSystemInput = DesignSystemUpdate & {
  expectedRevision: string;
};

export type GetTokensInput = {
  format?: "css" | "json" | "tailwind";
  namePattern?: string;
  types?: FlatDesignTokenType[];
};

export type CreateTokensInput = {
  expectedRevision: string;
  tokens: CreateFlatDesignToken[];
};

export type SetTokensInput = {
  expectedRevision: string;
  tokens: SetFlatDesignToken[];
};

export type SourceEdit =
  | { operation: "replace"; oldText: string; newText: string }
  | { operation: "insert_before"; anchor: string; content: string }
  | { operation: "insert_after"; anchor: string; content: string }
  | { operation: "delete"; oldText: string }
  | { operation: "prepend"; content: string }
  | { operation: "append"; content: string };

export class WorkspaceToolError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly suggestion?: string;

  constructor(
    code: string,
    message: string,
    options: { details?: Record<string, unknown>; suggestion?: string } = {},
  ) {
    super(message);
    this.name = "WorkspaceToolError";
    this.code = code;
    this.details = options.details ?? {};
    this.suggestion = options.suggestion;
  }
}

export class LocalPrototypeWorkspace {
  readonly root: string;
  readonly outputPath: string;

  constructor(root: string, outputPath = resolve(dirname(root), "dist/prototype.html")) {
    this.root = resolve(root);
    this.outputPath = resolve(outputPath);
  }

  async getWorkspaceSnapshot() {
    const { files, manifest } = await this.readWorkspace();
    validateManifest(manifest);
    const pageIds = manifest.pages.map((page) => page.id);
    const [agentPageState, canvas, revision] = await Promise.all([
      this.readAgentPageState(pageIds),
      this.readCanvas(pageIds),
      this.getRevision(),
    ]);
    const builds = Object.fromEntries(manifest.pages.map((page) => {
      const build = compileSingleHtml({
        canvasBridge: true,
        files,
        initialPageId: page.id,
        manifest,
      });
      return [page.id, { bytes: build.bytes, html: build.html }];
    }));
    const exports = Object.fromEntries(manifest.pages.map((page) => {
      const build = compileSingleHtml({ files, initialPageId: page.id, manifest });
      return [page.id, { bytes: build.bytes, html: build.html }];
    }));
    const componentPreviews = compileComponentPreviews({ files, manifest });

    return {
      agentPageState,
      builds,
      canvas,
      componentPreviews,
      exports,
      manifest,
      revision,
    };
  }

  async saveCanvas(value: unknown) {
    const manifest = await this.readManifest();
    const canvas = parseCanvasFile(value, manifest.pages.map((page) => page.id));
    await this.atomicWrite(
      resolve(this.root, ".prototype/canvas.json"),
      `${JSON.stringify(canvas, null, 2)}\n`,
    );
    return {
      canvas,
      revision: await this.getRevision(),
      savedTo: ".prototype/canvas.json",
    };
  }

  async getProjectContext() {
    const manifest = await this.readManifest();
    const pageIds = manifest.pages.map((page) => page.id);
    const [revision, product, design, canvas, agentPageState] = await Promise.all([
      this.getRevision(),
      this.readOptionalFile("PRODUCT.md"),
      this.readOptionalFile("DESIGN.md"),
      this.readCanvas(pageIds),
      this.readAgentPageState(pageIds),
    ]);

    return {
      agentPageState,
      canvas,
      design,
      manifest: {
        components: manifest.components,
        layouts: manifest.layouts,
        pages: manifest.pages,
        runtime: manifest.runtime,
        title: manifest.title,
      },
      product,
      revision,
      workspaceRoot: this.root,
    };
  }

  async getDesignContext() {
    const source = await this.readLimitedFile("DESIGN.md");
    return {
      ...this.parseDesignSource(source),
      path: "DESIGN.md",
      revision: await this.getRevision(),
    };
  }

  async lintDesign() {
    const source = await this.readLimitedFile("DESIGN.md");
    return {
      ...this.lintDesignSource(source),
      path: "DESIGN.md",
      revision: await this.getRevision(),
    };
  }

  async getTokens(input: GetTokensInput = {}) {
    const runtime = await this.readRuntimeTokenSource();
    let tokens = readFlatDesignTokens(runtime.source);
    if (input.types?.length) {
      const types = new Set(input.types);
      tokens = tokens.filter((token) => token.type !== "other" && types.has(token.type));
    }
    if (input.namePattern) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(input.namePattern, "i");
      } catch (error) {
        throw new WorkspaceToolError(
          "INVALID_TOKEN_FILTER",
          error instanceof Error ? error.message : String(error),
          { suggestion: "Use a valid regular expression, or omit namePattern." },
        );
      }
      tokens = tokens.filter((token) => pattern.test(token.name));
    }

    const format = input.format ?? "json";
    return {
      ...(format === "json"
        ? { tokens }
        : {
            content: format === "css"
              ? formatTokenBlock(":root", tokens)
              : formatTokenBlock("@theme", tokens),
          }),
      count: tokens.length,
      exists: runtime.exists,
      format,
      path: runtime.path,
      revision: await this.getRevision(),
    };
  }

  async createTokens(input: CreateTokensInput) {
    await this.assertRevision(input.expectedRevision);
    const runtime = await this.readRuntimeTokenSource();
    const designSource = await this.readLimitedFile("DESIGN.md");
    try {
      const mutation = createFlatDesignTokens(runtime.source, input.tokens);
      const nextTokens = readFlatDesignTokens(mutation.nextSource);
      const nextDesignSource = syncFlatTokensToDesignDocument(
        designSource,
        readFlatDesignTokens(runtime.source),
        nextTokens,
      );
      return this.commitTokenMutation({
        change: { created: mutation.tokens.length, tokens: mutation.tokens },
        nextDesignSource,
        nextRuntimeSource: mutation.nextSource,
        runtime,
      });
    } catch (error) {
      throw this.invalidDesignTokens(error);
    }
  }

  async setTokens(input: SetTokensInput) {
    await this.assertRevision(input.expectedRevision);
    const runtime = await this.readRuntimeTokenSource();
    const designSource = await this.readLimitedFile("DESIGN.md");
    try {
      const beforeTokens = readFlatDesignTokens(runtime.source);
      const mutation = setFlatDesignTokens(runtime.source, input.tokens);
      const nextTokens = readFlatDesignTokens(mutation.nextSource);
      const nextDesignSource = syncFlatTokensToDesignDocument(
        designSource,
        beforeTokens,
        nextTokens,
        {
          implicitFontFamilyRoles: false,
          typographyBindings: input.tokens.flatMap((change) => (
            change.typographyRoles?.length
              ? [{
                  roles: change.typographyRoles,
                  tokenName: change.newName ?? change.name,
                }]
              : []
          )),
        },
      );
      return this.commitTokenMutation({
        change: { changed: input.tokens.length, tokens: mutation.tokens },
        nextDesignSource,
        nextRuntimeSource: mutation.nextSource,
        runtime,
      });
    } catch (error) {
      throw this.invalidDesignTokens(error);
    }
  }

  async setDesignSection(input: SetDesignSectionInput) {
    await this.assertRevision(input.expectedRevision);
    const source = await this.readLimitedFile("DESIGN.md");
    let mutation: ReturnType<typeof updateDesignSection>;
    try {
      mutation = updateDesignSection(source, input.heading, input.content);
    } catch (error) {
      throw this.invalidDesignDocument(error);
    }
    return this.commitDesignMutation(source, mutation.nextSource, {
      heading: input.heading,
      previousValue: mutation.previousValue,
      type: "section",
      value: input.content,
    });
  }

  async updateDesignSystem(input: UpdateDesignSystemInput) {
    await this.assertRevision(input.expectedRevision);
    const source = await this.readLimitedFile("DESIGN.md");
    const { expectedRevision: _expectedRevision, ...update } = input;
    let mutation: ReturnType<typeof applyDesignSystemUpdate>;
    try {
      mutation = applyDesignSystemUpdate(source, update);
    } catch (error) {
      throw this.invalidDesignDocument(error);
    }
    return this.commitDesignMutation(source, mutation.nextSource, {
      changed: mutation.changed,
      type: "design-system",
    });
  }

  async getPageStates() {
    const manifest = await this.readManifest();
    const agentPageState = await this.readAgentPageState(
      manifest.pages.map((page) => page.id),
    );
    return {
      agentPageState,
      revision: await this.getRevision(),
      workingPageIds: Object.keys(agentPageState.pages),
    };
  }

  async finishWorkingOnPages(pageIds?: string[]) {
    const manifest = await this.readManifest();
    const knownPageIds = manifest.pages.map((page) => page.id);
    const requestedPageIds = pageIds?.length ? [...new Set(pageIds)] : undefined;
    const unknownPageIds = requestedPageIds?.filter((pageId) => !knownPageIds.includes(pageId)) ?? [];
    if (unknownPageIds.length) {
      throw new WorkspaceToolError(
        "UNKNOWN_PAGE",
        `Unknown page: ${unknownPageIds.join(", ")}`,
        {
          details: { pageIds: unknownPageIds },
          suggestion: "Call get_page_states or get_project_context and use a registered page id.",
        },
      );
    }

    const agentPageState = await this.readAgentPageState(knownPageIds);
    const targets = requestedPageIds ?? Object.keys(agentPageState.pages);
    const finishedPageIds = targets.filter((pageId) => pageId in agentPageState.pages);
    const alreadyFinishedPageIds = targets.filter((pageId) => !(pageId in agentPageState.pages));
    for (const pageId of targets) delete agentPageState.pages[pageId];
    if (finishedPageIds.length) await this.writeAgentPageState(agentPageState);

    return {
      agentPageState,
      alreadyFinishedPageIds,
      finishedPageIds,
      revision: await this.getRevision(),
      workingPageIds: Object.keys(agentPageState.pages),
    };
  }

  async listFiles(path = ".", depth = 3) {
    const target = this.resolveSafe(path);
    const targetStat = await stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!targetStat) return [];
    if (targetStat.isFile()) return [this.relativePath(target)];

    const files: string[] = [];
    await this.walk(target, Math.max(0, Math.min(depth, 8)), files);
    return files.slice(0, 500);
  }

  async grep(options: {
    ignoreCase?: boolean;
    limit?: number;
    path?: string;
    query: string;
    regex?: boolean;
    snippetChars?: number;
  }) {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const snippetChars = Math.max(
      80,
      Math.min(options.snippetChars ?? DEFAULT_GREP_SNIPPET_CHARS, 1_000),
    );
    const flags = options.ignoreCase ? "i" : "";
    const expression = new RegExp(
      options.regex ? options.query : escapeRegExp(options.query),
      flags,
    );
    const paths = await this.listFiles(options.path ?? ".", 8);
    const matches: Array<{
      column: number;
      line: number;
      path: string;
      text: string;
      truncated: boolean;
    }> = [];
    let limitReached = false;

    search: for (const path of paths) {
      if (!TEXT_EXTENSIONS.has(extname(path))) continue;
      const source = await this.readOptionalFile(path);
      for (const [index, line] of source.split(/\r?\n/).entries()) {
        const match = expression.exec(line);
        if (!match) continue;
        const snippet = createGrepSnippet(
          line,
          match.index,
          match[0]?.length ?? 0,
          snippetChars,
        );
        const candidate = {
          column: match.index + 1,
          line: index + 1,
          path,
          ...snippet,
        };
        const nextMatches = [...matches, candidate];
        if (
          new TextEncoder().encode(JSON.stringify({
            limitReached: true,
            matches: nextMatches,
          })).byteLength > MAX_GREP_RESPONSE_BYTES
        ) {
          limitReached = true;
          break search;
        }
        matches.push(candidate);
        if (matches.length >= limit) {
          limitReached = true;
          break search;
        }
      }
    }
    return { limitReached, matches };
  }

  async readSourceFile(
    path: string,
    startLine?: number,
    endLine?: number,
    aroundLine?: number,
    contextLines?: number,
    full = false,
  ) {
    const normalized = this.relativePath(this.resolveSafe(path));
    const source = await this.readLimitedFile(normalized);
    const sourceBytes = new TextEncoder().encode(source).byteLength;
    if (
      !full
      && startLine === undefined
      && endLine === undefined
      && aroundLine === undefined
      && sourceBytes > MAX_UNRANGED_READ_BYTES
    ) {
      throw new WorkspaceToolError(
        "READ_RANGE_REQUIRED",
        `File is too large for an implicit full read: ${normalized}`,
        {
          details: {
            bytes: sourceBytes,
            maxUnrangedBytes: MAX_UNRANGED_READ_BYTES,
            path: normalized,
          },
          suggestion: "Use startLine/endLine or aroundLine/contextLines. Send full: true only when the complete file is necessary.",
        },
      );
    }
    const lines = source.split(/\r?\n/);
    if (aroundLine !== undefined && (startLine !== undefined || endLine !== undefined)) {
      throw new WorkspaceToolError(
        "INVALID_READ_RANGE",
        "read_file accepts either aroundLine/contextLines or startLine/endLine, not both.",
        { suggestion: "Remove startLine/endLine when using aroundLine." },
      );
    }
    if (contextLines !== undefined && aroundLine === undefined) {
      throw new WorkspaceToolError(
        "INVALID_READ_RANGE",
        "contextLines requires aroundLine.",
        { suggestion: "Provide aroundLine or remove contextLines." },
      );
    }

    const radius = contextLines ?? 40;
    if (!Number.isInteger(radius) || radius < 0 || radius > 200) {
      throw new WorkspaceToolError(
        "INVALID_READ_RANGE",
        "contextLines must be an integer from 0 to 200.",
      );
    }

    const start = aroundLine === undefined
      ? Math.max(1, startLine ?? 1)
      : Math.max(1, aroundLine - radius);
    const requestedEnd = aroundLine === undefined ? endLine : aroundLine + radius;
    if (requestedEnd !== undefined && requestedEnd < start) {
      throw new WorkspaceToolError(
        "INVALID_READ_RANGE",
        "endLine must be greater than or equal to startLine.",
      );
    }
    const end = Math.min(lines.length, requestedEnd ?? lines.length);
    return {
      aroundLine,
      content: lines.slice(start - 1, end).join("\n"),
      contextLines: aroundLine === undefined ? undefined : radius,
      endLine: end,
      path: normalized,
      revision: await this.getRevision(),
      startLine: start,
      totalLines: lines.length,
    };
  }

  async writeSourceFile(
    path: string,
    content: string,
    expectedRevision: string,
    overwrite = false,
  ) {
    assertSourceSize(content, path);
    await this.assertRevision(expectedRevision);
    const normalized = this.validateWritablePath(path);
    const before = await this.readOptionalSourceFile(normalized);
    if (before === undefined && REGISTERED_MODULE.test(normalized)) {
      const createTool = createToolForRegisteredModule(normalized);
      throw new WorkspaceToolError(
        "REGISTERED_MODULE_REQUIRES_CREATE_TOOL",
        `write_file cannot create a registered prototype module: ${normalized}`,
        {
          details: { createTool, path: normalized },
          suggestion: `Use ${createTool} so the source file, prototype manifest, and canvas metadata stay synchronized.`,
        },
      );
    }
    if (before !== undefined && !overwrite) {
      throw new WorkspaceToolError(
        "FILE_ALREADY_EXISTS",
        `File already exists: ${normalized}`,
        {
          details: { path: normalized },
          suggestion: "Use edit_file for a partial change, or call write_file with overwrite: true for an intentional full replacement.",
        },
      );
    }

    const nextSource = ensureTrailingNewline(content);
    assertSourceSize(nextSource, normalized);
    if (before === nextSource) {
      throw new WorkspaceToolError(
        "NO_SOURCE_CHANGE",
        "write_file produced no source change.",
        { details: { path: normalized } },
      );
    }

    await this.atomicWrite(resolve(this.root, normalized), nextSource);
    const pageIds = await this.affectedPageIdsForSource(normalized);
    const agentPageState = await this.markPagesWorking(pageIds, "updating");
    return {
      affectedFiles: [normalized],
      changedLines: findChangedLineRanges(before ?? "", nextSource),
      nextSuggestedTool: "verify_preview",
      operation: before === undefined ? "created" : "overwritten",
      pageIds,
      pageStates: pickPageStates(agentPageState, pageIds),
      path: normalized,
      revision: await this.getRevision(),
    };
  }

  async editSourceFile(path: string, edits: SourceEdit[], expectedRevision: string) {
    await this.assertRevision(expectedRevision);
    if (edits.length === 0 || edits.length > 50) {
      throw new Error("edit_file requires between 1 and 50 ordered edits.");
    }

    const normalized = this.validateWritablePath(path);
    const source = await this.readLimitedFile(normalized);
    let nextSource = source;
    for (const [index, edit] of edits.entries()) {
      nextSource = applySourceEdit(nextSource, edit, index, normalized);
    }
    nextSource = ensureTrailingNewline(nextSource);
    assertSourceSize(nextSource, normalized);
    if (nextSource === source) {
      throw new WorkspaceToolError(
        "NO_SOURCE_CHANGE",
        "edit_file produced no source change.",
        { details: { path: normalized } },
      );
    }

    await this.atomicWrite(resolve(this.root, normalized), nextSource);
    const pageIds = await this.affectedPageIdsForSource(normalized);
    const agentPageState = await this.markPagesWorking(pageIds, "updating");
    return {
      affectedFiles: [normalized],
      afterBytes: new TextEncoder().encode(nextSource).byteLength,
      beforeBytes: new TextEncoder().encode(source).byteLength,
      changedLines: findChangedLineRanges(source, nextSource),
      editCount: edits.length,
      nextSuggestedTool: "verify_preview",
      pageIds,
      pageStates: pickPageStates(agentPageState, pageIds),
      path: normalized,
      revision: await this.getRevision(),
    };
  }

  async createPage(input: CreatePageInput) {
    await this.assertRevision(input.expectedRevision);
    const id = validateId(input.id);
    const manifest = await this.readManifest();
    if (manifest.pages.some((page) => page.id === id)) {
      throw new Error(`Page '${id}' already exists.`);
    }
    if (manifest.pages.some((page) => page.route === input.route)) {
      throw new Error(`Route '${input.route}' is already used.`);
    }
    if (input.layout && !manifest.layouts.some((layout) => layout.id === input.layout)) {
      throw new Error(`Unknown layout '${input.layout}'.`);
    }
    if (!input.route.startsWith("/")) throw new Error("Page route must start with '/'.");

    const viewport = input.viewport ?? { width: 1440, height: 960 };
    validateViewport(viewport);
    const path = `src/pages/${id}.page.html`;
    await this.assertMissing(path);

    const nextManifest: SingleHtmlManifest = {
      ...manifest,
      pages: [...manifest.pages, {
        file: path,
        id,
        ...(input.layout ? { layout: input.layout } : {}),
        name: input.name,
        route: input.route,
        viewport,
      }],
    };
    await this.writeCanvasForPages(nextManifest.pages.map((page) => page.id));
    await this.atomicWrite(resolve(this.root, path), pageSkeleton(id, input.name));
    try {
      await this.writeManifest(nextManifest);
    } catch (error) {
      await unlink(resolve(this.root, path)).catch(() => undefined);
      throw error;
    }
    const agentPageState = await this.markPagesWorking([id], "creating");

    return {
      affectedFiles: [path, "prototype.json", ".prototype/canvas.json"],
      changedLines: [{ endLine: pageSkeleton(id, input.name).trimEnd().split(/\r?\n/).length, startLine: 1 }],
      nextSuggestedTool: "edit_file",
      page: nextManifest.pages.at(-1),
      pageIds: [id],
      pageStates: pickPageStates(agentPageState, [id]),
      path,
      revision: await this.getRevision(),
    };
  }

  async setPageLayout(input: SetPageLayoutInput) {
    await this.assertRevision(input.expectedRevision);
    const manifest = await this.readManifest();
    const pageIndex = manifest.pages.findIndex((page) => page.id === input.pageId);
    if (pageIndex < 0) {
      throw new WorkspaceToolError(
        "UNKNOWN_PAGE",
        `Unknown page: ${input.pageId}`,
        {
          details: { pageIds: [input.pageId] },
          suggestion: "Call get_project_context and use a registered page id.",
        },
      );
    }
    if (input.layout && !manifest.layouts.some((layout) => layout.id === input.layout)) {
      throw new WorkspaceToolError(
        "UNKNOWN_LAYOUT",
        `Unknown layout: ${input.layout}`,
        {
          details: { layout: input.layout },
          suggestion: "Call get_project_context, create a layout, or send null for a standalone page.",
        },
      );
    }

    const currentPage = manifest.pages[pageIndex]!;
    const previousLayout = currentPage.layout ?? null;
    if (previousLayout === input.layout) {
      throw new WorkspaceToolError(
        "NO_PAGE_LAYOUT_CHANGE",
        `Page '${input.pageId}' already uses ${input.layout ? `layout '${input.layout}'` : "no layout"}.`,
        { details: { layout: input.layout, pageId: input.pageId } },
      );
    }
    const nextPage = {
      ...currentPage,
      ...(input.layout ? { layout: input.layout } : {}),
    };
    if (!input.layout) delete nextPage.layout;
    const nextPages = [...manifest.pages];
    nextPages[pageIndex] = nextPage;
    await this.writeManifest({ ...manifest, pages: nextPages });
    const agentPageState = await this.markPagesWorking([input.pageId], "updating");

    return {
      affectedFiles: ["prototype.json"],
      change: { layout: input.layout, previousLayout },
      nextSuggestedTool: "verify_preview",
      pageIds: [input.pageId],
      pageStates: pickPageStates(agentPageState, [input.pageId]),
      revision: await this.getRevision(),
    };
  }

  async createLayout(input: CreateLayoutInput) {
    await this.assertRevision(input.expectedRevision);
    const id = validateId(input.id);
    const manifest = await this.readManifest();
    if (manifest.layouts.some((layout) => layout.id === id)) {
      throw new Error(`Layout '${id}' already exists.`);
    }
    const path = `src/layouts/${id}.layout.html`;
    await this.assertMissing(path);
    const nextManifest: SingleHtmlManifest = {
      ...manifest,
      layouts: [...manifest.layouts, {
        file: path,
        id,
        slots: ["title", "headerActions", "content"],
      }],
    };
    await this.atomicWrite(resolve(this.root, path), layoutSkeleton(id));
    try {
      await this.writeManifest(nextManifest);
    } catch (error) {
      await unlink(resolve(this.root, path)).catch(() => undefined);
      throw error;
    }
    return {
      affectedFiles: [path, "prototype.json"],
      changedLines: [{ endLine: layoutSkeleton(id).trimEnd().split(/\r?\n/).length, startLine: 1 }],
      layout: nextManifest.layouts.at(-1),
      nextSuggestedTool: "edit_file",
      path,
      revision: await this.getRevision(),
    };
  }

  async createComponent(input: CreateComponentInput) {
    await this.assertRevision(input.expectedRevision);
    const id = validateId(input.id);
    const tag = input.tag ?? `x-${id}`;
    if (!/^x-[a-z][a-z0-9-]*$/.test(tag)) {
      throw new Error("Component tag must start with 'x-' and use kebab-case.");
    }
    const manifest = await this.readManifest();
    if (manifest.components.some((component) => component.id === id || component.tag === tag)) {
      throw new Error(`Component '${id}' or tag '${tag}' already exists.`);
    }
    const path = `src/components/${id}.component.html`;
    await this.assertMissing(path);
    const nextManifest: SingleHtmlManifest = {
      ...manifest,
      components: [...manifest.components, {
        defaults: input.defaults,
        file: path,
        id,
        props: {
          ...(input.props ?? {}),
          children: "slot",
          nodeId: "string?",
        },
        tag,
      }],
    };
    await this.atomicWrite(resolve(this.root, path), componentSkeleton(id));
    try {
      await this.writeManifest(nextManifest);
    } catch (error) {
      await unlink(resolve(this.root, path)).catch(() => undefined);
      throw error;
    }
    return {
      affectedFiles: [path, "prototype.json"],
      changedLines: [{ endLine: componentSkeleton(id).trimEnd().split(/\r?\n/).length, startLine: 1 }],
      component: nextManifest.components.at(-1),
      nextSuggestedTool: "edit_file",
      path,
      revision: await this.getRevision(),
    };
  }

  async verifyPreview(pageId?: string) {
    const { files, manifest } = await this.readWorkspace();
    validateManifest(manifest);
    if (pageId && !manifest.pages.some((page) => page.id === pageId)) {
      throw new Error(`Unknown page '${pageId}'.`);
    }
    const build = compileSingleHtml({
      canvasBridge: true,
      files,
      initialPageId: pageId,
      manifest,
    });
    const warnings = manifest.pages.flatMap((page) => (
      files[page.file]?.includes("data-node-id")
        ? []
        : [`${page.file} has no data-node-id, so canvas selection will be coarse.`]
    ));
    const agentPageState = await this.readAgentPageState(
      manifest.pages.map((page) => page.id),
    );
    const workingPageIds = Object.keys(agentPageState.pages);
    return {
      agentPageState,
      bytes: build.bytes,
      diagnostics: [],
      nextSuggestedTool: workingPageIds.length ? "finish_working_on_pages" : undefined,
      pageCount: build.pageCount,
      revision: await this.getRevision(),
      runtimeDependencies: build.runtimeDependencies,
      warnings,
      workingPageIds,
    };
  }

  async exportPrototype(expectedRevision: string) {
    await this.assertRevision(expectedRevision);
    const { files, manifest } = await this.readWorkspace();
    validateManifest(manifest);
    const build = compileSingleHtml({ files, manifest });
    await this.atomicWrite(this.outputPath, build.html);
    return {
      bytes: build.bytes,
      outputPath: this.outputPath,
      pageCount: build.pageCount,
      revision: await this.getRevision(),
      runtimeDependencies: build.runtimeDependencies,
    };
  }

  async getRevision() {
    const paths = ["DESIGN.md", "prototype.json", ...(await this.listFiles("src", 8))].sort();
    const hash = createHash("sha256");
    for (const path of paths) {
      hash.update(path);
      hash.update("\0");
      hash.update(await this.readLimitedFile(path));
      hash.update("\0");
    }
    return `sha256-${hash.digest("hex").slice(0, 16)}`;
  }

  private async assertRevision(expected: string) {
    const actual = await this.getRevision();
    if (actual !== expected) {
      throw new WorkspaceToolError(
        "REVISION_CONFLICT",
        `Revision mismatch: expected '${expected}', current is '${actual}'. Read project context again before writing.`,
        {
          details: { currentRevision: actual, expectedRevision: expected },
          suggestion: "Call get_project_context or read_file, then retry the mutation with the returned revision.",
        },
      );
    }
  }

  private parseDesignSource(source: string) {
    try {
      return parseDesignContext(source);
    } catch (error) {
      throw this.invalidDesignDocument(error);
    }
  }

  private lintDesignSource(source: string) {
    try {
      return lintDesignDocument(source);
    } catch (error) {
      throw this.invalidDesignDocument(error);
    }
  }

  private async commitDesignMutation(
    source: string,
    nextSource: string,
    change: Record<string, unknown>,
  ) {
    if (source === nextSource) {
      throw new WorkspaceToolError(
        "NO_DESIGN_CHANGE",
        "The DESIGN.md update produced no change.",
        { details: { path: "DESIGN.md" } },
      );
    }

    let lintReport: ReturnType<typeof assertValidDesignDocument>;
    try {
      lintReport = assertValidDesignDocument(nextSource);
    } catch (error) {
      throw this.invalidDesignDocument(error);
    }
    await this.atomicWrite(resolve(this.root, "DESIGN.md"), nextSource);
    return {
      affectedFiles: ["DESIGN.md"],
      change,
      changedLines: findChangedLineRanges(source, nextSource),
      lint: lintReport,
      nextSuggestedTool: "get_design_context",
      path: "DESIGN.md",
      revision: await this.getRevision(),
    };
  }

  private async commitTokenMutation(input: {
    change: Record<string, unknown>;
    nextDesignSource: string;
    nextRuntimeSource: string;
    runtime: { exists: boolean; path: string; source: string };
  }) {
    let lintReport: ReturnType<typeof assertValidDesignDocument>;
    try {
      lintReport = assertValidDesignDocument(input.nextDesignSource);
      readFlatDesignTokens(input.nextRuntimeSource);
    } catch (error) {
      throw this.invalidDesignDocument(error);
    }
    await this.atomicWrite(resolve(this.root, "DESIGN.md"), input.nextDesignSource);
    await this.atomicWrite(resolve(this.root, input.runtime.path), input.nextRuntimeSource);
    if (!input.runtime.exists) {
      const manifest = await this.readManifest();
      manifest.styles = [input.runtime.path, ...manifest.styles];
      validateManifest(manifest);
      await this.writeManifest(manifest);
    }
    return {
      affectedFiles: [
        "DESIGN.md",
        input.runtime.path,
        ...(!input.runtime.exists ? ["prototype.json"] : []),
      ],
      change: input.change,
      lint: lintReport,
      nextSuggestedTool: "get_tokens",
      revision: await this.getRevision(),
    };
  }

  private async readRuntimeTokenSource() {
    const manifest = await this.readManifest();
    const path = manifest.styles.find((style) => /(?:^|\/)tokens\.css$/i.test(style));
    if (!path) {
      return {
        exists: false,
        path: "src/styles/tokens.css",
        source: ":root {\n}\n",
      };
    }
    return { exists: true, path, source: await this.readLimitedFile(path) };
  }

  private invalidDesignDocument(error: unknown) {
    const findings = error instanceof DesignValidationError ? error.findings : undefined;
    return new WorkspaceToolError(
      "INVALID_DESIGN_DOCUMENT",
      error instanceof Error ? error.message : String(error),
      {
        details: findings ? { findings } : {},
        suggestion: "Call get_design_context, correct the token or section input, and retry with the latest revision.",
      },
    );
  }

  private invalidDesignTokens(error: unknown) {
    if (error instanceof WorkspaceToolError) return error;
    return new WorkspaceToolError(
      "INVALID_DESIGN_TOKENS",
      error instanceof Error ? error.message : String(error),
      {
        suggestion: "Call get_tokens, fix the token batch, and retry with its latest revision.",
      },
    );
  }

  private async readWorkspace() {
    const manifest = await this.readManifest();
    const paths = new Set([
      ...manifest.styles,
      ...manifest.pages.map((page) => page.file),
      ...manifest.layouts.map((layout) => layout.file),
      ...manifest.components.map((component) => component.file),
    ]);
    const files = Object.fromEntries(await Promise.all([...paths].map(async (path) => [
      path,
      await this.readLimitedFile(path),
    ])));
    return { files, manifest };
  }

  private async readManifest() {
    const value = JSON.parse(await this.readLimitedFile("prototype.json")) as SingleHtmlManifest;
    if (value.runtime !== "single-html@1") {
      throw new Error("prototype.json must use runtime 'single-html@1'.");
    }
    return value;
  }

  private async writeManifest(manifest: SingleHtmlManifest) {
    await this.atomicWrite(
      resolve(this.root, "prototype.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  private async readCanvas(pageIds: string[]) {
    try {
      return parseCanvasFile(
        JSON.parse(await this.readLimitedFile(".prototype/canvas.json")),
        pageIds,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return createDefaultCanvas(pageIds);
    }
  }

  private async readAgentPageState(pageIds: string[]) {
    try {
      return parseAgentPageState(
        JSON.parse(await this.readLimitedFile(AGENT_PAGE_STATE_PATH)),
        pageIds,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyAgentPageState();
      }
      throw error;
    }
  }

  private async writeAgentPageState(agentPageState: AgentPageStateFile) {
    await this.atomicWrite(
      resolve(this.root, AGENT_PAGE_STATE_PATH),
      `${JSON.stringify(agentPageState, null, 2)}\n`,
    );
  }

  private async markPagesWorking(pageIds: string[], activity: AgentPageActivity) {
    const manifest = await this.readManifest();
    const knownPageIds = manifest.pages.map((page) => page.id);
    const targets = [...new Set(pageIds)].filter((pageId) => knownPageIds.includes(pageId));
    const agentPageState = await this.readAgentPageState(knownPageIds);
    if (!targets.length) return agentPageState;

    const now = new Date().toISOString();
    for (const pageId of targets) {
      const previous = agentPageState.pages[pageId];
      agentPageState.pages[pageId] = {
        activity: previous?.activity === "creating" ? "creating" : activity,
        startedAt: previous?.startedAt ?? now,
        status: "working",
        updatedAt: now,
      };
    }
    await this.writeAgentPageState(agentPageState);
    return agentPageState;
  }

  private async affectedPageIdsForSource(path: string) {
    const manifest = await this.readManifest();
    const page = manifest.pages.find((entry) => entry.file === path);
    if (page) return [page.id];

    const layout = manifest.layouts.find((entry) => entry.file === path);
    if (layout) {
      return manifest.pages
        .filter((entry) => entry.layout === layout.id)
        .map((entry) => entry.id);
    }

    if (
      manifest.components.some((entry) => entry.file === path)
      || manifest.styles.includes(path)
    ) {
      return manifest.pages.map((entry) => entry.id);
    }
    return [];
  }

  private async writeCanvasForPages(pageIds: string[]) {
    const canvas = await this.readCanvas(pageIds);
    await this.atomicWrite(
      resolve(this.root, ".prototype/canvas.json"),
      `${JSON.stringify(canvas, null, 2)}\n`,
    );
  }

  private async readOptionalFile(path: string) {
    try {
      return await this.readLimitedFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }

  private async readOptionalSourceFile(path: string) {
    try {
      return await this.readLimitedFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async readLimitedFile(path: string) {
    const absolutePath = this.resolveSafe(path);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) throw new Error(`Not a file: ${path}`);
    if (fileStat.size > MAX_READ_BYTES) {
      throw new WorkspaceToolError(
        "FILE_TOO_LARGE",
        `File is too large to read: ${path}`,
        { details: { maxBytes: MAX_READ_BYTES, path, size: fileStat.size } },
      );
    }
    return readFile(absolutePath, "utf8");
  }

  private async walk(directory: string, depth: number, output: string[]) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) await this.walk(absolutePath, depth - 1, output);
      } else if (entry.isFile()) {
        output.push(this.relativePath(absolutePath));
      }
    }
  }

  private resolveSafe(path: string) {
    const normalized = path.replaceAll("\\", "/");
    if (isAbsolute(path) || normalized.split("/").includes("..")) {
      throw new WorkspaceToolError(
        "PATH_OUTSIDE_WORKSPACE",
        "Path must stay inside the prototype workspace.",
      );
    }
    const absolutePath = resolve(this.root, normalized);
    const relativePath = relative(this.root, absolutePath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new WorkspaceToolError(
        "PATH_OUTSIDE_WORKSPACE",
        "Path must stay inside the prototype workspace.",
      );
    }
    return absolutePath;
  }

  private relativePath(path: string) {
    return relative(this.root, path).replaceAll("\\", "/") || ".";
  }

  private validateWritablePath(path: string) {
    const normalized = this.relativePath(this.resolveSafe(path));
    if (!WRITABLE_MODULE.test(normalized)) {
      throw new WorkspaceToolError(
        "INVALID_WRITABLE_PATH",
        "Source mutations only accept src/pages/*.page.html, src/layouts/*.layout.html, src/components/*.component.html, or src/styles/*.css.",
      );
    }
    return normalized;
  }

  private async assertMissing(path: string) {
    try {
      await stat(this.resolveSafe(path));
      throw new WorkspaceToolError(
        "FILE_ALREADY_EXISTS",
        `File already exists: ${path}`,
        { details: { path }, suggestion: "Choose a new id or edit the existing module." },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  private async atomicWrite(path: string, content: string) {
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporaryPath, content, "utf8");
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

function validateManifest(manifest: SingleHtmlManifest) {
  assertUnique(manifest.pages.map((page) => page.id), "page id");
  assertUnique(manifest.pages.map((page) => page.route), "route");
  assertUnique(manifest.layouts.map((layout) => layout.id), "layout id");
  assertUnique(manifest.components.map((component) => component.id), "component id");
  assertUnique(manifest.components.map((component) => component.tag), "component tag");
  for (const page of manifest.pages) {
    if (page.layout && !manifest.layouts.some((layout) => layout.id === page.layout)) {
      throw new Error(`Unknown layout '${page.layout}' for page '${page.id}'.`);
    }
  }
}

function applySourceEdit(source: string, edit: SourceEdit, index: number, path: string) {
  if (edit.operation === "prepend") return `${edit.content}${source}`;
  if (edit.operation === "append") return `${source}${edit.content}`;

  const anchor = edit.operation === "replace" || edit.operation === "delete"
    ? edit.oldText
    : edit.anchor;
  if (!anchor) throw new Error(`Edit ${index + 1} requires a non-empty anchor.`);
  const matches = countMatches(source, anchor);
  if (matches !== 1) {
    throw new WorkspaceToolError(
      matches === 0 ? "EDIT_ANCHOR_NOT_FOUND" : "EDIT_ANCHOR_AMBIGUOUS",
      `Edit ${index + 1} anchor must match exactly once; found ${matches}. Read the file again and use a more specific anchor.`,
      {
        details: { editIndex: index + 1, matches },
        suggestion: matches === 0
          ? "Read the relevant file range again because the source may have changed."
          : "Use a longer anchor that uniquely identifies the intended section.",
      },
    );
  }

  if (
    (edit.operation === "replace" || edit.operation === "delete")
    && anchor.length >= BROAD_EDIT_MIN_ANCHOR_LENGTH
    && anchor.length / Math.max(source.length, 1) >= BROAD_EDIT_MAX_SOURCE_RATIO
  ) {
    const sourceRatio = Number((anchor.length / Math.max(source.length, 1)).toFixed(3));
    throw new WorkspaceToolError(
      "EDIT_TOO_BROAD",
      `Edit ${index + 1} replaces or deletes too much of ${path} for edit_file.`,
      {
        details: {
          anchorLength: anchor.length,
          editIndex: index + 1,
          maxSourceRatio: BROAD_EDIT_MAX_SOURCE_RATIO,
          path,
          sourceLength: source.length,
          sourceRatio,
        },
        suggestion: "Use insert_before/insert_after with a short unique anchor for one section, use a small replace for one existing element, or use write_file with overwrite: true for an intentional full rewrite.",
      },
    );
  }

  const position = source.indexOf(anchor);
  if (edit.operation === "delete") {
    return `${source.slice(0, position)}${source.slice(position + anchor.length)}`;
  }
  if (edit.operation === "replace") {
    return `${source.slice(0, position)}${edit.newText}${source.slice(position + anchor.length)}`;
  }
  if (edit.operation === "insert_before") {
    return `${source.slice(0, position)}${edit.content}${source.slice(position)}`;
  }
  return `${source.slice(0, position + anchor.length)}${edit.content}${source.slice(position + anchor.length)}`;
}

function createToolForRegisteredModule(path: string) {
  if (path.startsWith("src/pages/")) return "create_page";
  if (path.startsWith("src/layouts/")) return "create_layout";
  return "create_component";
}

function countMatches(source: string, anchor: string) {
  let count = 0;
  let offset = 0;
  while (offset <= source.length - anchor.length) {
    const match = source.indexOf(anchor, offset);
    if (match === -1) break;
    count += 1;
    offset = match + anchor.length;
  }
  return count;
}

function findChangedLineRanges(before: string, after: string) {
  if (before === after) return [];
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let firstChanged = 0;
  while (
    firstChanged < beforeLines.length
    && firstChanged < afterLines.length
    && beforeLines[firstChanged] === afterLines[firstChanged]
  ) {
    firstChanged += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= firstChanged
    && afterEnd >= firstChanged
    && beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return [{
    endLine: Math.max(firstChanged + 1, afterEnd + 1),
    startLine: firstChanged + 1,
  }];
}

function pickPageStates(agentPageState: AgentPageStateFile, pageIds: string[]) {
  return Object.fromEntries(pageIds.flatMap((pageId) => {
    const pageState = agentPageState.pages[pageId];
    return pageState ? [[pageId, pageState]] : [];
  }));
}

function assertSourceSize(source: string, path: string) {
  const size = new TextEncoder().encode(source).byteLength;
  if (size > MAX_READ_BYTES) {
    throw new WorkspaceToolError(
      "CONTENT_TOO_LARGE",
      `Source content is too large to write: ${path}`,
      {
        details: { maxBytes: MAX_READ_BYTES, path, size },
        suggestion: "Keep individual source modules at or below 512 KiB and split large designs into components or stylesheets.",
      },
    );
  }
}

function assertUnique(values: string[], label: string) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length) throw new Error(`Duplicate ${label}: ${[...new Set(duplicates)].join(", ")}.`);
}

function validateId(value: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error("ID must use kebab-case and start with a letter.");
  }
  return value;
}

function validateViewport(viewport: { height: number; width: number }) {
  if (!Number.isInteger(viewport.width) || viewport.width < 320 || viewport.width > 3840) {
    throw new Error("Viewport width must be an integer from 320 to 3840.");
  }
  if (!Number.isInteger(viewport.height) || viewport.height < 320 || viewport.height > 2160) {
    throw new Error("Viewport height must be an integer from 320 to 2160.");
  }
}

function formatTokenBlock(selector: ":root" | "@theme", tokens: Array<{
  name: string;
  value: number | string;
}>) {
  return `${selector} {\n${tokens.map((token) => (
    `  ${token.name}: ${token.value};`
  )).join("\n")}\n}`;
}

function pageSkeleton(id: string, name: string) {
  return `<template data-slot="header-actions"></template>

<template data-slot="content">
  <main
    aria-label="${escapeHtml(name)}"
    class="p-${id}"
    data-node-id="${id}"
    style="min-height: 100vh;"
  >
    <!-- agent:page-sections -->
  </main>
</template>
`;
}

function layoutSkeleton(id: string) {
  return `<style>
  .${id}-layout { min-height: 100vh; }
  .${id}-header { padding: var(--space-6); }
  .${id}-content { padding: var(--space-8); }
</style>

<div class="${id}-layout" data-node-id="${id}">
  <header class="${id}-header" data-node-id="${id}.header">
    <h1>{{title}}</h1>
    <div>{{headerActions}}</div>
  </header>
  <main class="${id}-content">{{content}}</main>
</div>
`;
}

function componentSkeleton(id: string) {
  return `<style>
  .${id} {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    padding: var(--space-4);
  }
</style>

<div class="${id}" data-node-id="{{nodeId}}">{{children}}</div>
`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createGrepSnippet(
  line: string,
  matchIndex: number,
  matchLength: number,
  maxChars: number,
) {
  if (line.length <= maxChars) {
    return { text: line.trimEnd(), truncated: false };
  }

  const visibleMatchLength = Math.max(1, Math.min(matchLength, maxChars));
  const availableContext = Math.max(0, maxChars - visibleMatchLength);
  const idealStart = matchIndex - Math.floor(availableContext / 2);
  const start = Math.max(0, Math.min(idealStart, line.length - maxChars));
  const end = Math.min(line.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < line.length ? "…" : "";
  const contentBudget = Math.max(0, maxChars - prefix.length - suffix.length);
  return {
    text: `${prefix}${line.slice(start, start + contentBudget)}${suffix}`,
    truncated: true,
  };
}

function ensureTrailingNewline(value: string) {
  return value.endsWith("\n") ? value : `${value}\n`;
}
