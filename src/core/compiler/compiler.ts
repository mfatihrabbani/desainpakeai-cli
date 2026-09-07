import { createPrototypePreviewFontCss } from '../themes/font-registry.js'

export type SingleHtmlManifest = {
  schemaVersion: number;
  runtime: "single-html@1";
  title: string;
  styles: string[];
  pages: Array<{
    id: string;
    name: string;
    route: string;
    file: string;
    layout?: string;
    viewport: { width: number; height: number };
  }>;
  layouts: Array<{
    id: string;
    file: string;
    slots: string[];
  }>;
  components: Array<{
    id: string;
    tag: string;
    file: string;
    defaults?: Record<string, string>;
    props: Record<string, unknown>;
  }>;
};

type CompileSingleHtmlInput = {
  canvasBridge?: boolean;
  files: Record<string, string>;
  initialPageId?: string;
  manifest: SingleHtmlManifest;
  previewFonts?: boolean;
};

export type SingleHtmlBuild = {
  bytes: number;
  html: string;
  pageCount: number;
  runtimeDependencies: number;
};

const COMPONENT_PREVIEW_PAGE_PATH = ".prototype/generated/component-preview.page.html";
const ICONIFY_CDN_URL = "https://code.iconify.design/iconify-icon/3.0.0/iconify-icon.min.js";
const ICONIFY_CDN_INTEGRITY = "sha384-Hj2pe/JEGitdWiVWNPuXWhAdYtdM+ZO+s0KuZHaAk1oAbeAtNas7R6hKlmbInTM4";
const ICONIFY_BASE_STYLES = "iconify-icon { display: inline-block; flex: none; height: 1em; width: 1em; }";
const COMPONENT_PREVIEW_STYLES = `
:root { color-scheme: light; }
html, body { overflow: hidden; width: 100%; }
body { background: transparent !important; margin: 0 !important; }
*, *::before, *::after { box-sizing: border-box; }
[data-prototype-page] {
  align-items: center;
  display: flex !important;
  justify-content: center;
  min-height: 100%;
  padding: 12px;
}
[data-component-preview-root] {
  align-items: center;
  display: flex;
  justify-content: center;
  max-height: 100%;
  min-width: 0;
  width: 100%;
}
`;
const COMPONENT_PREVIEW_RESIZE_SCRIPT = `(() => {
  const channel = "dpai-component-preview-v1";
  const root = document.querySelector("[data-component-preview-root]");
  if (!root) return;
  let frame = 0;
  const report = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const height = Math.ceil(Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ));
      parent.postMessage({ channel, height, type: "preview.resize" }, "*");
    });
  };
  new ResizeObserver(report).observe(root);
  addEventListener("load", report, { once: true });
  addEventListener("message", (event) => {
    if (event.data?.channel === channel && event.data?.type === "preview.measure") report();
  });
  document.fonts?.ready.then(report);
  report();
})();`;

export function compileComponentPreviews({
  files,
  manifest,
}: Pick<CompileSingleHtmlInput, "files" | "manifest">): Record<
  string,
  Pick<SingleHtmlBuild, "bytes" | "html">
> {
  return Object.fromEntries(manifest.components.map((component) => {
    const previewManifest: SingleHtmlManifest = {
      ...manifest,
      layouts: [],
      pages: [{
        file: COMPONENT_PREVIEW_PAGE_PATH,
        id: `component-preview-${component.id}`,
        name: `${humanizeIdentifier(component.id)} preview`,
        route: "/",
        viewport: { height: 160, width: 320 },
      }],
      title: `${manifest.title} · ${humanizeIdentifier(component.id)}`,
    };
    const previewFiles = {
      ...files,
      [COMPONENT_PREVIEW_PAGE_PATH]: [
        `<style>${COMPONENT_PREVIEW_STYLES}</style>`,
        '<template data-slot="content">',
        '<main data-component-preview-root>',
        createComponentPreviewInvocation(component),
        '</main>',
        '</template>',
        `<script>${COMPONENT_PREVIEW_RESIZE_SCRIPT}</script>`,
      ].join(""),
    };
    const build = compileSingleHtml({
      files: previewFiles,
      manifest: previewManifest,
      previewFonts: true,
    });
    return [component.id, { bytes: build.bytes, html: build.html }];
  }));
}

export function compileSingleHtml({
  canvasBridge = false,
  files,
  initialPageId,
  manifest,
  previewFonts = canvasBridge,
}: CompileSingleHtmlInput): SingleHtmlBuild {
  if (manifest.runtime !== "single-html@1") {
    throw new Error(`Unsupported runtime: ${manifest.runtime}`);
  }

  const initialPage = manifest.pages.find((page) => page.id === initialPageId)
    ?? manifest.pages[0];

  const renderedPages = manifest.pages.map((page) => {
    const pageSource = readWorkspaceFile(files, page.file);
    const content = expandComponents(extractSlot(pageSource, "content"), manifest, files);
    const layout = page.layout
      ? manifest.layouts.find((entry) => entry.id === page.layout)
      : undefined;
    if (page.layout && !layout) {
      throw new Error(`Unknown layout '${page.layout}' for page '${page.id}'.`);
    }
    const pageMarkup = layout
      ? interpolate(extractModuleMarkup(readWorkspaceFile(files, layout.file)), {
        content,
        headerActions: expandComponents(
          extractSlot(pageSource, "header-actions"),
          manifest,
          files,
        ),
        title: escapeHtml(page.name),
      })
      : content;
    const hiddenAttribute = page.id === initialPage?.id ? "" : " hidden";

    return [
      `<section data-prototype-page data-page-id="${escapeAttribute(page.id)}"`,
      ` data-route="${escapeAttribute(page.route)}"${hiddenAttribute}>`,
      pageMarkup,
      "</section>",
    ].join("");
  }).join("\n");

  const usedLayoutPaths = [...new Set(manifest.pages.flatMap((page) => {
    if (!page.layout) return [];
    const layout = manifest.layouts.find((entry) => entry.id === page.layout);
    return layout ? [layout.file] : [];
  }))];
  const modulePaths = [
    ...usedLayoutPaths,
    ...manifest.components.map((component) => component.file),
    ...manifest.pages.map((page) => page.file),
  ];
  const usesIconify = /<iconify-icon\b/i.test(renderedPages);
  const workspaceStyles = [
    ...manifest.styles.map((path) => `/* ${path} */\n${readWorkspaceFile(files, path)}`),
    ...modulePaths.flatMap((path) => extractModuleBlocks(
      readWorkspaceFile(files, path),
      "style",
    ).map((block) => `/* ${path} */\n${block}`)),
  ].join("\n\n");
  const styles = [
    ...(previewFonts ? [createPrototypePreviewFontCss(workspaceStyles)] : []),
    ...(usesIconify ? [ICONIFY_BASE_STYLES] : []),
    workspaceStyles,
  ]
    .filter(Boolean)
    .join("\n\n")
    .replaceAll("</style", "<\\/style");
  const projectScripts = [
    ...(canvasBridge ? [createCanvasBridgeScript()] : []),
    ...modulePaths
    .flatMap((path) => extractModuleBlocks(
      readWorkspaceFile(files, path),
      "script",
    ).map((block) => `/* ${path} */\n${block}`)),
  ]
    .join("\n\n")
    .replaceAll("</script", "<\\/script");
  const routerScript = initialPage
    ? createRouterScript(initialPage.route).replaceAll("</script", "<\\/script")
    : "";

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(manifest.title)}</title>`,
    `<style>\n${styles}\n</style>`,
    ...(usesIconify ? [
      `<script crossorigin="anonymous" defer integrity="${ICONIFY_CDN_INTEGRITY}" src="${ICONIFY_CDN_URL}"></script>`,
    ] : []),
    "</head>",
    `<body>\n${renderedPages}\n<script>\n${routerScript}\n\n${projectScripts}\n</script>\n</body>`,
    "</html>",
  ].join("\n");

  return {
    bytes: new TextEncoder().encode(html).byteLength,
    html,
    pageCount: manifest.pages.length,
    runtimeDependencies: usesIconify ? 1 : 0,
  };
}

function expandComponents(
  source: string,
  manifest: SingleHtmlManifest,
  files: Record<string, string>,
) {
  let result = source;
  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;
    for (const component of manifest.components) {
      const tag = escapeRegExp(component.tag);
      const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
      result = result.replace(pattern, (_match, attributeSource: string, children: string) => {
        changed = true;
        const attributes = parseAttributes(attributeSource);
        const props = {
          ...(component.defaults ?? {}),
          ...attributes,
          children: expandComponents(children.trim(), manifest, files),
        };
        return interpolate(
          extractModuleMarkup(readWorkspaceFile(files, component.file)),
          props,
          new Set(["children"]),
        );
      });
    }
    if (!changed) return result;
  }
  throw new Error("Component expansion exceeded 10 passes. Check for a recursive component.");
}

function extractSlot(source: string, slot: string) {
  const pattern = new RegExp(
    `<template\\s+data-slot=["']${escapeRegExp(slot)}["'][^>]*>([\\s\\S]*?)<\\/template>`,
    "i",
  );
  return source.match(pattern)?.[1]?.trim() ?? "";
}

function extractModuleBlocks(source: string, tag: "script" | "style") {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  for (const match of source.matchAll(pattern)) {
    if (match[1]?.trim()) blocks.push(match[1].trim());
  }
  return blocks;
}

function extractModuleMarkup(source: string) {
  return source
    .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, "")
    .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, "")
    .trim();
}

function interpolate(
  template: string,
  values: Record<string, string>,
  rawKeys = new Set(Object.keys(values)),
) {
  return template.replace(/{{\s*([\w-]+)\s*}}/g, (_match, key: string) => {
    const value = values[key] ?? "";
    return rawKeys.has(key) ? value : escapeHtml(value);
  });
}

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1]?.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (key) attributes[key] = match[2] ?? match[3] ?? "true";
  }
  return attributes;
}

function createComponentPreviewInvocation(
  component: SingleHtmlManifest["components"][number],
) {
  const attributes = Object.entries(component.props).flatMap(([prop, definition]) => {
    if (prop === "children" || definition === "slot") return [];
    const defaultValue = component.defaults?.[prop];
    const sample = previewAttributeValue(prop, definition, defaultValue);
    if (sample === undefined) return [];
    return [` ${camelToKebab(prop)}="${escapeAttribute(sample)}"`];
  }).join("");
  const children = component.props.children === "slot"
    ? previewChildren(component.id)
    : "";
  return `<${component.tag}${attributes}>${children}</${component.tag}>`;
}

function previewAttributeValue(prop: string, definition: unknown, defaultValue?: string) {
  if (defaultValue?.trim()) return defaultValue;
  const samples: Record<string, string> = {
    description: "Component preview",
    label: humanizeIdentifier(prop === "label" ? "label" : prop),
    name: "preview",
    placeholder: "Type here…",
    title: "Card title",
  };
  if (samples[prop]) return samples[prop];
  if (Array.isArray(definition)) {
    return definition.find((value): value is string => typeof value === "string");
  }
  if (definition === "string" && !prop.toLocaleLowerCase().includes("id")) {
    return humanizeIdentifier(prop);
  }
  return undefined;
}

function previewChildren(componentId: string) {
  const id = componentId.toLocaleLowerCase();
  if (id.includes("select")) return '<option value="preview">Option</option>';
  if (id.includes("card")) return "<p>Card content</p>";
  if (id.includes("checkbox")) return "Remember me";
  if (id.includes("badge")) return "Badge";
  if (id.includes("button")) return "Button";
  return humanizeIdentifier(componentId);
}

function camelToKebab(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLocaleLowerCase()}`);
}

function humanizeIdentifier(value: string) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toLocaleUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function readWorkspaceFile(files: Record<string, string>, path: string) {
  const source = files[path];
  if (source === undefined) throw new Error(`Workspace file not found: ${path}`);
  return source;
}

function createRouterScript(initialRoute: string) {
  const safeInitialRoute = JSON.stringify(initialRoute).replaceAll("<", "\\u003c");
  return `(() => {
  const initialRoute = ${safeInitialRoute};

  function showRoute() {
    const pages = [...document.querySelectorAll("[data-prototype-page]")];
    const route = location.hash.slice(1) || initialRoute;
    const active = pages.find((page) => page.dataset.route === route) || pages[0];
    if (!active) return;
    for (const page of pages) page.hidden = page !== active;
    for (const link of document.querySelectorAll("[data-route-link]")) {
      const current = link.getAttribute("href") === "#" + active.dataset.route;
      if (current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }

  addEventListener("hashchange", showRoute);
  showRoute();
})();`;
}

function createCanvasBridgeScript() {
  return `(() => {
  let canvasMode = "preview";
  let hoveredNode = null;
  let selectPointer = null;
  let trackedPaths = [];
  let rectFrame = 0;
  let contentSizeFrame = 0;
  let lastContentHeight = 0;
  let agentRevealTimer = 0;
  let agentFollowTimers = [];
  let agentStagedTargets = [];
  let agentStagedContainers = new Set();
  let patchedTargets = [];
  let latestAgentTargets = [];
  let lastUserNavigationAt = 0;
  const userFollowPauseMs = 4000;
  const cursorStyle = document.createElement("style");
  cursorStyle.textContent = [
    "html[data-canvas-picking],html[data-canvas-picking] *{cursor:default!important}",
    "html[data-canvas-picking] body,html[data-canvas-picking] body *{user-select:none!important;-webkit-user-select:none!important}",
    "html[data-canvas-expanded],html[data-canvas-expanded] body{overflow-y:hidden!important}"
  ].join("");
  document.head.appendChild(cursorStyle);
  const agentStyle = document.createElement("style");
  agentStyle.textContent = [
    "@keyframes rnd-agent-node-reveal{",
    "0%{opacity:0;filter:saturate(.35) blur(3px);outline:2px solid transparent;outline-offset:7px}",
    "58%{opacity:1;filter:none;outline:2px solid rgba(139,92,246,.58);outline-offset:2px}",
    "100%{opacity:1;filter:none;outline:2px solid transparent;outline-offset:0}",
    "}",
    "@keyframes rnd-agent-container-reveal{0%{opacity:0}100%{opacity:1}}",
    "[data-rnd-agent-staged]{opacity:0!important;visibility:hidden!important}",
    "[data-rnd-agent-container-reveal]{animation:rnd-agent-container-reveal 520ms cubic-bezier(.22,1,.36,1) both}",
    "[data-rnd-agent-reveal]{animation:rnd-agent-node-reveal 620ms cubic-bezier(.22,1,.36,1) backwards;",
    "animation-delay:var(--rnd-agent-delay,0ms);will-change:opacity,filter}",
    "@media(prefers-reduced-motion:reduce){[data-rnd-agent-reveal],[data-rnd-agent-container-reveal]{animation:none!important}}"
  ].join("");
  document.head.appendChild(agentStyle);

  function clearAgentReveal() {
    clearTimeout(agentRevealTimer);
    agentRevealTimer = 0;
    for (const timer of agentFollowTimers) clearTimeout(timer);
    agentFollowTimers = [];
    agentStagedTargets = [];
    agentStagedContainers = new Set();
    for (const node of document.querySelectorAll("[data-rnd-agent-reveal],[data-rnd-agent-staged],[data-rnd-agent-container-reveal]")) {
      node.removeAttribute("data-rnd-agent-reveal");
      node.removeAttribute("data-rnd-agent-staged");
      node.removeAttribute("data-rnd-agent-container-reveal");
      node.style.removeProperty("--rnd-agent-delay");
    }
  }

  function postFollowPending(pending) {
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "agent.follow-pending",
      pending
    }, "*");
  }

  function markUserNavigation() {
    lastUserNavigationAt = Date.now();
  }

  function followLatestAgentTarget(force, targetIndex) {
    if (!latestAgentTargets.length) {
      postFollowPending(false);
      return;
    }
    if (!force && (canvasMode === "pick" || Date.now() - lastUserNavigationAt < userFollowPauseMs)) {
      postFollowPending(true);
      return;
    }
    const indexedTarget = Number.isInteger(targetIndex)
      ? latestAgentTargets[targetIndex]
      : null;
    const target = indexedTarget || (force
      ? latestAgentTargets.find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top < 0 || rect.bottom > innerHeight;
        }) || latestAgentTargets[0]
      : latestAgentTargets[0]);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const top = Math.max(0, scrollY + rect.top - (innerHeight - rect.height) / 2);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo({
      behavior: reducedMotion ? "auto" : "smooth",
      top
    });
    postFollowPending(false);
  }

  function agentRevealTargets(sourceIds) {
    const page = document.querySelector("[data-prototype-page]:not([hidden])");
    if (!page) return [];
    const elementSelector = [
      "a", "button", "h1", "h2", "h3", "h4", "h5", "h6", "p", "span",
      "small", "strong", "em", "i", "img",
      "input", "textarea", "select", "label", "figcaption", "blockquote", "table",
      "video", "canvas", "svg", "[data-component]", "[data-part]"
    ].join(",");
    const atomicTargets = (scopes, includeSourceLeaves) => {
      let targets = scopes.flatMap((scope) => [
        ...(scope.matches?.(elementSelector) ? [scope] : []),
        ...scope.querySelectorAll(elementSelector),
        ...(includeSourceLeaves
          ? Array.from(scope.querySelectorAll("[data-node-id]"))
            .filter((node) => !node.matches(elementSelector) && !node.querySelector(elementSelector))
          : [])
      ]);
      return targets
        .filter((node, index, nodes) => nodes.indexOf(node) === index)
        .filter((node) => node.getClientRects().length > 0)
        .filter((node, _index, nodes) => !nodes.some((candidate) => (
          candidate !== node && candidate.contains(node)
        )))
        .sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    };
    if (sourceIds.length) {
      const allowed = new Set(sourceIds);
      const sourceNodes = [page, ...page.querySelectorAll("[data-node-id]")]
        .filter((node) => allowed.has(node.getAttribute("data-node-id")));
      const targets = atomicTargets(sourceNodes, false);
      return (targets.length ? targets : sourceNodes)
        .filter((node) => node.getClientRects().length > 0)
        .slice(0, 96);
    }
    const root = page.querySelector("[data-node-id]") || page.firstElementChild || page;
    let targets = atomicTargets([root], true);
    if (targets.length < 2) {
      let container = root;
      while (container.children.length === 1 && container.firstElementChild) {
        container = container.firstElementChild;
      }
      targets = Array.from(container.children);
    }
    return targets.filter((node) => node.getClientRects().length > 0).slice(0, 96);
  }

  function revealUpdatedNodes(sourceIds) {
    clearTimeout(agentRevealTimer);
    agentRevealTimer = 0;
    for (const timer of agentFollowTimers) clearTimeout(timer);
    agentFollowTimers = [];
    for (const node of document.querySelectorAll("[data-rnd-agent-reveal]")) {
      node.removeAttribute("data-rnd-agent-reveal");
      node.style.removeProperty("--rnd-agent-delay");
    }
    const preparedTargets = agentStagedTargets.filter((node) => node.isConnected);
    const localPatchedTargets = patchedTargets
      .filter((node, index, nodes) => node.isConnected && nodes.indexOf(node) === index)
      .filter((node, _index, nodes) => !nodes.some((candidate) => (
        candidate !== node && candidate.contains(node)
      )))
      .filter((node) => node.getClientRects().length > 0);
    const targets = preparedTargets.length
      ? preparedTargets
      : sourceIds.length
        ? agentRevealTargets(sourceIds)
        : localPatchedTargets;
    const revealFromBlank = preparedTargets.length > 0;
    agentStagedTargets = [];
    patchedTargets = [];
    if (!targets.length) {
      latestAgentTargets = [];
      postFollowPending(false);
      return;
    }
    const delays = [];
    const groupStarts = [];
    let delayCursor = 0;
    let previousGroup = null;
    targets.forEach((node, index) => {
      const group = agentRevealGroup(node);
      if (index > 0) delayCursor += group === previousGroup ? 160 : 620;
      delays.push(delayCursor);
      groupStarts.push(index > 0 && group !== previousGroup);
      previousGroup = group;
    });
    latestAgentTargets = targets;
    void document.documentElement.offsetWidth;
    targets.forEach((node, index) => {
      const delay = delays[index] || 0;
      if (!revealFromBlank) {
        node.style.setProperty("--rnd-agent-delay", String(delay) + "ms");
        node.setAttribute("data-rnd-agent-reveal", "");
      }
      agentFollowTimers.push(setTimeout(() => {
        if (!node.isConnected) return;
        if (revealFromBlank) {
          let revealedContainer = null;
          for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (!agentStagedContainers.has(ancestor) || !ancestor.hasAttribute("data-rnd-agent-staged")) continue;
            ancestor.removeAttribute("data-rnd-agent-staged");
            revealedContainer = ancestor;
          }
          revealedContainer?.setAttribute("data-rnd-agent-container-reveal", "");
          node.removeAttribute("data-rnd-agent-staged");
          node.setAttribute("data-rnd-agent-reveal", "");
        }
        const bounds = boundsOf(node);
        if (!bounds) return;
        parent.postMessage({
          channel: "rnd-dom-canvas-v1",
          type: "agent.reveal-target",
          bounds,
          groupStart: groupStarts[index] === true,
          index,
          total: targets.length
        }, "*");
      }, delay));
    });
    agentRevealTimer = setTimeout(clearAgentReveal, (delays.at(-1) || 0) + 760);
    requestAnimationFrame(() => followLatestAgentTarget(false));
  }

  function agentRevealGroup(node) {
    const page = node.closest("[data-prototype-page]");
    const root = page?.querySelector("[data-node-id]");
    let group = node.closest("[data-node-id]");
    while (group && group !== root) {
      const parentGroup = group.parentElement?.closest("[data-node-id]");
      if (!parentGroup || parentGroup === root) return group;
      group = parentGroup;
    }
    return node.closest("section,header,footer,nav") || root || page;
  }

  function prepareAgentReveal() {
    clearAgentReveal();
    const page = document.querySelector("[data-prototype-page]:not([hidden])");
    const root = page?.querySelector("[data-node-id]") || page?.firstElementChild;
    if (!page || !root) return;
    const targets = agentRevealTargets([]);
    const containers = Array.from(root.querySelectorAll("[data-node-id]"))
      .filter((node) => node !== root && !targets.includes(node));
    const visualContainers = new Set();
    for (const target of targets) {
      for (let ancestor = target.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
        if (targets.includes(ancestor)) continue;
        const style = getComputedStyle(ancestor);
        const background = style.backgroundColor;
        if (
          (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)")
          || style.backgroundImage !== "none"
        ) visualContainers.add(ancestor);
      }
    }
    agentStagedTargets = targets;
    agentStagedContainers = new Set([...containers, ...visualContainers]);
    for (const node of [...agentStagedContainers, ...targets]) node.setAttribute("data-rnd-agent-staged", "");
  }

  function recordPatchedNode(node) {
    const element = node instanceof Element ? node : node.parentElement;
    if (element && !patchedTargets.includes(element)) patchedTargets.push(element);
  }

  function nodeKey(node) {
    return node instanceof Element ? node.getAttribute("data-node-id") : null;
  }

  function sameNodeKind(current, next) {
    return current.nodeType === next.nodeType
      && (!(current instanceof Element) || !(next instanceof Element)
        || current.tagName === next.tagName);
  }

  function syncAttributes(current, next) {
    for (const attribute of Array.from(current.attributes)) {
      if (
        attribute.name === "data-rnd-agent-reveal"
        || attribute.name === "data-rnd-agent-staged"
        || attribute.name === "data-rnd-agent-container-reveal"
      ) continue;
      if (!next.hasAttribute(attribute.name)) {
        current.removeAttribute(attribute.name);
        if (attribute.name !== "hidden") recordPatchedNode(current);
      }
    }
    for (const attribute of Array.from(next.attributes)) {
      if (current.getAttribute(attribute.name) !== attribute.value) {
        current.setAttribute(attribute.name, attribute.value);
        if (attribute.name !== "hidden") recordPatchedNode(current);
      }
    }
  }

  function keyedChild(key, after) {
    let child = after;
    while (child) {
      if (nodeKey(child) === key) return child;
      child = child.nextSibling;
    }
    return null;
  }

  function morphNode(current, next) {
    if (!sameNodeKind(current, next)) {
      const replacement = next.cloneNode(true);
      current.replaceWith(replacement);
      recordPatchedNode(replacement);
      return;
    }
    if (!(current instanceof Element) || !(next instanceof Element)) {
      if (current.nodeValue !== next.nodeValue) {
        recordPatchedNode(current);
        current.nodeValue = next.nodeValue;
      }
      return;
    }

    syncAttributes(current, next);
    let cursor = current.firstChild;
    for (const nextChild of Array.from(next.childNodes)) {
      const key = nodeKey(nextChild);
      let target = key ? keyedChild(key, cursor) : cursor;
      if (target && !sameNodeKind(target, nextChild)) target = null;
      if (!target) {
        target = nextChild.cloneNode(true);
        current.insertBefore(target, cursor);
        recordPatchedNode(target);
      } else {
        if (target !== cursor) current.insertBefore(target, cursor);
        morphNode(target, nextChild);
      }
      cursor = target.nextSibling;
    }
    while (cursor) {
      const next = cursor.nextSibling;
      recordPatchedNode(cursor);
      cursor.remove();
      cursor = next;
    }
  }

  function rejectDocumentPatch(revision, reason) {
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "document.patch-rejected",
      revision,
      reason
    }, "*");
  }

  function patchDocument(html, revision) {
    if (typeof html !== "string" || html.length > 8000000) {
      rejectDocumentPatch(revision, "invalid-document");
      return;
    }
    const nextDocument = new DOMParser().parseFromString(html, "text/html");
    patchedTargets = [];
    const currentScript = document.querySelector("body > script:last-of-type");
    const nextScript = nextDocument.querySelector("body > script:last-of-type");
    if (!currentScript || !nextScript || currentScript.textContent !== nextScript.textContent) {
      rejectDocumentPatch(revision, "runtime-script-changed");
      return;
    }

    const activePageId = document.querySelector("[data-prototype-page]:not([hidden])")
      ?.getAttribute("data-page-id");
    const currentStyle = document.head.querySelector("style");
    const nextStyle = nextDocument.head.querySelector("style");
    if (!currentStyle || !nextStyle) {
      rejectDocumentPatch(revision, "project-style-missing");
      return;
    }
    currentStyle.textContent = nextStyle.textContent;
    document.title = nextDocument.title;
    document.documentElement.lang = nextDocument.documentElement.lang;

    const nextPages = Array.from(nextDocument.querySelectorAll("[data-prototype-page]"));
    const nextPageIds = new Set(nextPages.map((page) => page.getAttribute("data-page-id")));
    for (const page of Array.from(document.querySelectorAll("[data-prototype-page]"))) {
      if (!nextPageIds.has(page.getAttribute("data-page-id"))) page.remove();
    }
    for (const nextPage of nextPages) {
      const pageId = nextPage.getAttribute("data-page-id");
      const currentPage = Array.from(document.querySelectorAll("[data-prototype-page]"))
        .find((page) => page.getAttribute("data-page-id") === pageId);
      if (currentPage) morphNode(currentPage, nextPage);
      else document.body.insertBefore(nextPage.cloneNode(true), currentScript);
    }

    const pages = Array.from(document.querySelectorAll("[data-prototype-page]"));
    const active = pages.find((page) => page.getAttribute("data-page-id") === activePageId)
      || pages[0];
    for (const page of pages) page.hidden = page !== active;
    scheduleRects();
    scheduleContentSize();
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "document.patched",
      revision
    }, "*");
  }

  function canvasNode(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const source = path.find((entry) => entry instanceof Element) || event.target;
    if (!(source instanceof Element)) return null;
    const selector = "p,h1,h2,h3,h4,h5,h6,span,a,button,label,input,textarea,select,img,li,dt,dd,th,td,section,article,nav,aside,header,footer,form,div";
    return source.closest(selector) || source;
  }

  function pathOf(node) {
    const parts = [];
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      let index = 1;
      for (let child = 0; child < parent.children.length; child += 1) {
        if (parent.children[child] === node) break;
        if (parent.children[child].tagName === node.tagName) index += 1;
      }
      parts.unshift(tag + ":nth-of-type(" + index + ")");
      node = parent;
    }
    return parts.join(">");
  }

  function sourceIdOf(node) {
    return node.closest("[data-node-id]")?.getAttribute("data-node-id") || null;
  }

  function boundsOf(node) {
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function resolve(path) {
    try {
      return document.querySelector(path.split(">").join(" > "));
    } catch {
      return null;
    }
  }

  function sendRects() {
    if (!trackedPaths.length) return;
    const rects = {};
    for (const path of trackedPaths) {
      const target = resolve(path);
      rects[path] = target ? boundsOf(target) : null;
    }
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "node.rects",
      rects
    }, "*");
  }

  function scheduleRects() {
    if (rectFrame || !trackedPaths.length) return;
    rectFrame = requestAnimationFrame(() => {
      rectFrame = 0;
      sendRects();
    });
  }

  function sendContentSize() {
    contentSizeFrame = 0;
    const root = document.documentElement;
    const body = document.body;
    const height = Math.max(
      root.scrollHeight,
      root.offsetHeight,
      body.scrollHeight,
      body.offsetHeight
    );
    const safeHeight = Math.max(1, Math.min(100000, Math.ceil(height)));
    if (safeHeight === lastContentHeight) return;
    lastContentHeight = safeHeight;
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "canvas.content-size",
      height: safeHeight
    }, "*");
  }

  function scheduleContentSize() {
    if (contentSizeFrame) return;
    contentSizeFrame = requestAnimationFrame(sendContentSize);
  }

  function sendHover(target) {
    if (hoveredNode === target) return;
    hoveredNode = target;
    const bounds = target ? boundsOf(target) : null;
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "node.hovered",
      bounds
    }, "*");
  }

  function handleScroll() {
    selectPointer = null;
    sendHover(null);
    scheduleRects();
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "canvas.scrolled"
    }, "*");
  }

  document.addEventListener("pointermove", (event) => {
    if (canvasMode !== "pick") return;
    sendHover(canvasNode(event));
  }, true);

  document.addEventListener("pointerleave", () => sendHover(null), true);

  document.addEventListener("pointerdown", markUserNavigation, true);
  document.addEventListener("touchstart", markUserNavigation, true);
  document.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "].includes(event.key)) {
      markUserNavigation();
    }
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (canvasMode !== "pick") return;
    selectPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, true);

  document.addEventListener("pointerup", (event) => {
    if (canvasMode !== "pick" || selectPointer?.id !== event.pointerId) return;
    const start = selectPointer;
    selectPointer = null;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const target = canvasNode(event);
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    sendHover(null);

    const path = pathOf(target);
    const sourceId = sourceIdOf(target);
    const computed = getComputedStyle(target);
    const page = target.closest("[data-prototype-page]");
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "node.selected",
      pageId: page?.getAttribute("data-page-id") || "",
      node: {
        id: sourceId || path,
        path,
        sourceId,
        tag: target.tagName.toLowerCase(),
        text: (target.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 120),
        bounds: boundsOf(target),
        display: computed.display,
        position: computed.position
      }
    }, "*");
  }, true);

  document.addEventListener("pointercancel", () => {
    selectPointer = null;
  }, true);

  document.addEventListener("click", (event) => {
    const routeLink = event.target instanceof Element
      ? event.target.closest("a[data-route-link]")
      : null;
    if (routeLink) event.preventDefault();
    if (canvasMode !== "pick") return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("wheel", (event) => {
    markUserNavigation();
    if (!(event.ctrlKey || event.metaKey)) {
      selectPointer = null;
      sendHover(null);
      return;
    }
    event.preventDefault();
    parent.postMessage({
      channel: "rnd-dom-canvas-v1",
      type: "canvas.wheel",
      clientX: event.clientX,
      clientY: event.clientY,
      deltaY: event.deltaY
    }, "*");
  }, { capture: true, passive: false });

  addEventListener("message", (event) => {
    if (event.data?.channel !== "rnd-dom-canvas-v1") return;
    if (event.data?.type === "canvas.mode") {
      canvasMode = event.data.mode;
      selectPointer = null;
      document.documentElement.toggleAttribute("data-canvas-picking", canvasMode === "pick");
      if (canvasMode === "pick") return;
      sendHover(null);
    } else if (event.data?.type === "canvas.expanded") {
      document.documentElement.toggleAttribute("data-canvas-expanded", event.data.expanded === true);
      scheduleContentSize();
    } else if (event.data?.type === "canvas.measure") {
      lastContentHeight = 0;
      scheduleContentSize();
    } else if (event.data?.type === "agent.prepare-reveal") {
      requestAnimationFrame(prepareAgentReveal);
    } else if (event.data?.type === "selection.track") {
      trackedPaths = Array.isArray(event.data.paths)
        ? event.data.paths.filter((path) => typeof path === "string").slice(0, 500)
        : [];
      scheduleRects();
    } else if (event.data?.type === "agent.activity") {
      const sourceIds = Array.isArray(event.data.sourceIds)
        ? event.data.sourceIds.filter((id) => typeof id === "string").slice(0, 100)
        : [];
      if (event.data.activity === "creating" || event.data.activity === "updating") {
        requestAnimationFrame(() => revealUpdatedNodes(sourceIds));
      }
      else {
        clearAgentReveal();
        latestAgentTargets = [];
        postFollowPending(false);
      }
    } else if (event.data?.type === "agent.follow-latest") {
      followLatestAgentTarget(
        true,
        Number.isInteger(event.data.index) ? event.data.index : null
      );
    } else if (event.data?.type === "document.patch") {
      patchDocument(event.data.html, event.data.revision);
    }
  });

  addEventListener("scroll", handleScroll, true);
  addEventListener("resize", scheduleRects);
  addEventListener("load", () => {
    scheduleRects();
    scheduleContentSize();
  });
  document.addEventListener("load", scheduleContentSize, true);
  if (document.fonts) void document.fonts.ready.then(scheduleContentSize);

  if (window.MutationObserver) {
    new MutationObserver(() => {
      scheduleRects();
      scheduleContentSize();
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true
    });
  }

  scheduleContentSize();

  parent.postMessage({
    channel: "rnd-dom-canvas-v1",
    type: "canvas.ready"
  }, "*");
})();`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
