import { WorkspaceToolError } from "./core/server/local-workspace.js";

const DESIGN_SECTION_PAGE_CHARS = 6_000;
const MAX_DIAGNOSTIC_ITEMS = 50;

export type ProjectContextOptions = {
  detail?: "compact" | "full";
  include?: Array<"design" | "catalog" | "canvas" | "pageState" | "product">;
};

export type DesignContextOptions = {
  cursor?: string;
  detail?: "compact" | "full";
  include?: Array<"components" | "omitted" | "storage">;
  sections?: string[];
};

export function shapeProjectContext(
  value: unknown,
  designValue: unknown,
  options: ProjectContextOptions = {},
) {
  const context = asRecord(value);
  if (options.detail === "full") {
    const full = { ...context };
    delete full.tracking;
    delete full.workspaceRoot;
    if (full.agentPageState !== undefined) {
      full.agentPageState = compactPageActivities(full.agentPageState);
    }
    return full;
  }
  const manifest = asRecord(context.manifest);
  const design = asRecord(designValue);
  const pageState = asRecord(context.agentPageState);
  const pages = Array.isArray(manifest.pages)
    ? manifest.pages.map((entry) => pick(asRecord(entry), ["file", "id", "layout", "name", "route"]))
    : [];
  const layouts = Array.isArray(manifest.layouts)
    ? manifest.layouts.map((entry) => pick(asRecord(entry), ["file", "id", "slots"]))
    : [];
  const components = Array.isArray(manifest.components)
    ? manifest.components.map((entry) => pick(asRecord(entry), ["file", "id", "tag"]))
    : [];
  const sections = Array.isArray(design.sections) ? design.sections.map(asRecord) : [];
  const include = new Set(options.include ?? []);
  const result: Record<string, unknown> = {
    ...(components.length ? { components } : {}),
    designSummary: {
      colorTokens: Object.keys(asRecord(design.colors)).length,
      name: design.name,
      sections: sections.length,
      typographyTokens: Object.keys(asRecord(design.typography)).length,
      version: design.version,
    },
    ...(layouts.length ? { layouts } : {}),
    pages,
    ...(context.project !== undefined ? { project: context.project } : {}),
    prototype: {
      ...(context.prototypeId !== undefined ? { id: context.prototypeId } : {}),
      runtime: manifest.runtime,
      title: manifest.title,
    },
    revision: context.revision,
    workingPageIds: Object.keys(asRecord(pageState.pages)),
  };
  if (include.has("design")) {
    result.design = {
      description: design.description,
      sectionHeadings: sections.map((section) => section.heading).filter(Boolean),
    };
  }
  if (include.has("catalog")) {
    result.catalogSummary = {
      components: components.length,
      layouts: layouts.length,
      pages: pages.length,
    };
  }
  if (include.has("canvas")) result.canvas = compactCanvas(context.canvas);
  if (include.has("pageState")) result.agentPageState = context.agentPageState;
  if (include.has("product") && typeof context.product === "string" && context.product.trim()) {
    result.product = {
      characters: context.product.trim().length,
      preview: context.product.trim().slice(0, 2_000),
      truncated: context.product.trim().length > 2_000,
    };
  }
  return result;
}

export function shapeDesignContext(value: unknown, options: DesignContextOptions = {}) {
  const context = asRecord(value);
  const full = Object.fromEntries([
    "components",
    "description",
    "name",
    "omitted",
    "path",
    "revision",
    "sections",
    "storage",
    "typography",
    "version",
  ].flatMap((key) => context[key] === undefined ? [] : [[key, context[key]]]));
  if (options.detail === "full") return full;
  const components = asRecord(context.components);
  const omitted = Array.isArray(context.omitted) ? context.omitted : [];
  const sections = Array.isArray(context.sections) ? context.sections.map(asRecord) : [];
  const typography = asRecord(context.typography);
  const include = new Set(options.include ?? []);
  const revision = typeof context.revision === "string" ? context.revision : "";
  const sectionCursor = resolveDesignSectionCursor(options.cursor, options.sections, revision);
  const sectionPage = paginateDesignSections(sections, sectionCursor);
  const requestedSections = sectionCursor.headings.length > 0;

  return Object.fromEntries([
    ["componentIds", Object.keys(components).length ? Object.keys(components) : undefined],
    ["counts", {
      components: Object.keys(components).length,
      omitted: omitted.length,
      sections: sections.length,
      typographyRoles: Object.keys(typography).length,
    }],
    ["description", context.description],
    ["name", context.name],
    ["path", context.path],
    ["revision", context.revision],
    ["sectionHeadings", sections.length
      ? sections.map((section) => section.heading).filter(Boolean)
      : undefined],
    ["typographyRoles", Object.keys(typography).length ? Object.keys(typography) : undefined],
    ["version", context.version],
    ["sections", sectionPage.sections.length ? sectionPage.sections : undefined],
    ["missingSections", sectionPage.missingSections.length
      ? sectionPage.missingSections
      : undefined],
    ["nextCursor", requestedSections ? sectionPage.nextCursor : undefined],
    ["components", include.has("components") ? components : undefined],
    ["omitted", include.has("omitted") ? omitted : undefined],
    ["storage", include.has("storage") ? context.storage : undefined],
  ].filter((entry) => entry[1] !== undefined));
}

type DesignSectionCursor = {
  headings: string[];
  offset: number;
  revision: string;
  sectionIndex: number;
};

function resolveDesignSectionCursor(
  cursor: string | undefined,
  sections: string[] | undefined,
  revision: string,
): DesignSectionCursor {
  if (!cursor) return { headings: sections ?? [], offset: 0, revision, sectionIndex: 0 };

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidDesignCursor("The design section cursor is malformed.");
  }
  const value = asRecord(decoded);
  const headings = Array.isArray(value.headings)
    ? value.headings.filter((heading) => typeof heading === "string")
    : [];
  if (
    headings.length === 0
    || headings.length !== value.headings?.length
    || !Number.isInteger(value.sectionIndex)
    || value.sectionIndex < 0
    || !Number.isInteger(value.offset)
    || value.offset < 0
    || typeof value.revision !== "string"
  ) {
    throw invalidDesignCursor("The design section cursor has invalid fields.");
  }
  if (value.revision !== revision) {
    throw new WorkspaceToolError(
      "REVISION_MISMATCH",
      "The design changed after this section cursor was issued.",
      {
        details: { currentRevision: revision, cursorRevision: value.revision },
        suggestion: "Call get_design_context again with the desired sections and no cursor.",
      },
    );
  }
  if (sections && JSON.stringify(sections) !== JSON.stringify(headings)) {
    throw invalidDesignCursor("The supplied sections do not match this cursor.");
  }
  return {
    headings,
    offset: value.offset,
    revision: value.revision,
    sectionIndex: value.sectionIndex,
  };
}

function paginateDesignSections(
  sections: Array<Record<string, any>>,
  cursor: DesignSectionCursor,
) {
  const sectionByHeading = new Map(sections.map((section) => [section.heading, section]));
  const missingSections = cursor.headings.filter((heading) => !sectionByHeading.has(heading));
  const page: Array<Record<string, unknown>> = [];
  let remaining = DESIGN_SECTION_PAGE_CHARS;
  let sectionIndex = cursor.sectionIndex;
  let offset = cursor.offset;

  while (sectionIndex < cursor.headings.length && remaining > 0) {
    const heading = cursor.headings[sectionIndex];
    const section = sectionByHeading.get(heading);
    if (!section) {
      sectionIndex += 1;
      offset = 0;
      continue;
    }
    const content = typeof section.content === "string" ? section.content : "";
    const start = Math.min(offset, content.length);
    const chunk = content.slice(start, start + remaining);
    const nextOffset = start + chunk.length;
    const complete = nextOffset >= content.length;
    page.push({
      complete,
      content: chunk,
      heading,
      offset: start,
      returnedChars: chunk.length,
      totalChars: content.length,
    });
    remaining -= chunk.length;
    if (complete) {
      sectionIndex += 1;
      offset = 0;
    } else {
      offset = nextOffset;
    }
  }

  return {
    missingSections,
    nextCursor: sectionIndex < cursor.headings.length
      ? Buffer.from(JSON.stringify({
        headings: cursor.headings,
        offset,
        revision: cursor.revision,
        sectionIndex,
      }), "utf8").toString("base64url")
      : null,
    sections: page,
  };
}

function invalidDesignCursor(message: string) {
  return new WorkspaceToolError("INVALID_CURSOR", message, {
    suggestion: "Call get_design_context again with the desired sections and no cursor.",
  });
}

export function compactToolPayload(toolName: string, value: unknown) {
  if (toolName === "get_project_context" || toolName === "get_design_context" || toolName === "get_review") {
    return value;
  }
  const payload = removeTransportMetadata(value);

  if (toolName === "list_files" && Array.isArray(payload)) {
    return { files: payload, limitReached: payload.length >= 500 };
  }
  if (!isRecord(payload)) return payload;

  if (toolName === "get_page_states") {
    return { pages: compactPageActivities(payload.agentPageState), revision: payload.revision };
  }
  if (toolName === "verify_preview") {
    delete payload.agentPageState;
    compactDiagnosticList(payload, "diagnostics");
    compactDiagnosticList(payload, "warnings");
  }
  if (toolName === "finish_working_on_pages") {
    return pick(payload, ["alreadyFinishedPageIds", "finishedPageIds", "revision", "workingPageIds"]);
  }
  if (
    ["create_tokens", "set_tokens", "set_design_section", "update_design_system"].includes(toolName)
    && isRecord(payload.lint)
  ) {
    payload.lint = {
      summary: payload.lint.summary,
      valid: asRecord(payload.lint.summary).errors === 0,
    };
  }
  if (toolName === "create_tokens" || toolName === "set_tokens") {
    payload.change = compactTokenChange(payload.change);
  }
  if (toolName === "set_design_section") {
    const change = asRecord(payload.change);
    payload.change = {
      heading: change.heading,
      replaced: change.previousValue !== undefined,
      type: change.type,
    };
  }
  if (toolName === "create_component") {
    payload.component = pick(asRecord(payload.component), ["id", "tag"]);
  }

  const responseFields: Record<string, string[]> = {
    create_component: ["component", "nextSuggestedTool", "path", "revision"],
    create_layout: ["layout", "nextSuggestedTool", "path", "revision"],
    create_page: ["nextSuggestedTool", "page", "path", "revision"],
    create_tokens: ["affectedFiles", "change", "lint", "nextSuggestedTool", "revision"],
    edit_file: ["changedLines", "nextSuggestedTool", "pageIds", "path", "revision"],
    set_design_section: ["affectedFiles", "change", "lint", "nextSuggestedTool", "revision"],
    set_page_layout: ["change", "nextSuggestedTool", "pageIds", "revision"],
    set_tokens: ["affectedFiles", "change", "lint", "nextSuggestedTool", "revision"],
    update_design_system: ["affectedFiles", "change", "lint", "nextSuggestedTool", "revision"],
    write_file: ["changedLines", "nextSuggestedTool", "operation", "pageIds", "path", "revision"],
  };
  const fields = responseFields[toolName];
  return fields ? pick(payload, fields) : payload;
}

function removeTransportMetadata(value: unknown) {
  if (!isRecord(value)) return value;
  const payload = { ...value };
  delete payload.project;
  delete payload.prototypeId;
  delete payload.tracking;
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === "value" ? payload.value : payload;
}

function compactPageActivities(value: unknown) {
  const pages = asRecord(asRecord(value).pages);
  return Object.fromEntries(Object.entries(pages).flatMap(([pageId, pageState]) => {
    const activity = asRecord(pageState).activity;
    return activity === "creating" || activity === "updating"
      ? [[pageId, activity]]
      : [];
  }));
}

function compactTokenChange(value: unknown) {
  const change = asRecord(value);
  const tokens = Array.isArray(change.tokens) ? change.tokens.map(asRecord) : [];
  return Object.fromEntries([
    ["changed", change.changed],
    ["created", change.created],
    ["tokenNames", tokens.map((token) => token.name).filter(Boolean)],
  ].filter((entry) => entry[1] !== undefined));
}

function compactDiagnosticList(payload: Record<string, any>, field: string) {
  if (!Array.isArray(payload[field])) return;
  const values = payload[field];
  payload[`${field}Count`] = values.length;
  payload[`${field}Truncated`] = values.length > MAX_DIAGNOSTIC_ITEMS;
  payload[field] = values.slice(0, MAX_DIAGNOSTIC_ITEMS);
}

function compactCanvas(value: unknown) {
  const canvas = asRecord(value);
  const frames = Object.entries(asRecord(canvas.frames));
  return {
    frameCount: frames.length,
    frames: Object.fromEntries(frames.slice(0, 100)),
    framesTruncated: frames.length > 100,
    schemaVersion: canvas.schemaVersion,
  };
}

function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.flatMap((key) => (
    value[key] === undefined ? [] : [[key, value[key]]]
  )));
}

function asRecord(value: unknown): Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
