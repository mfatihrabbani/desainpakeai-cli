import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function createWorkspaceFixture(root: string) {
  await mkdir(resolve(root, "src/pages"), { recursive: true });
  await mkdir(resolve(root, "src/styles"), { recursive: true });
  await mkdir(resolve(root, ".prototype"), { recursive: true });
  await Promise.all([
    writeFile(resolve(root, "prototype.json"), `${JSON.stringify({
      schemaVersion: 1,
      runtime: "single-html@1",
      title: "CLI fixture",
      styles: ["src/styles/tokens.css"],
      pages: [{
        id: "home",
        name: "Home",
        route: "/",
        file: "src/pages/home.page.html",
        viewport: { width: 1440, height: 900 },
      }],
      layouts: [],
      components: [],
    }, null, 2)}\n`, "utf8"),
    writeFile(resolve(root, "DESIGN.md"), `---
version: alpha
name: CLI fixture
description: Minimal fixture for CLI verification.
omitted: []
colors:
  canvas: "#ffffff"
  text: "#111111"
typography: {}
components: {}
---

## Direction

Keep the fixture minimal.
`, "utf8"),
    writeFile(resolve(root, "PRODUCT.md"), "# CLI fixture\n", "utf8"),
    writeFile(resolve(root, "src/styles/tokens.css"), `:root {
  --color-canvas: #ffffff;
  --color-text: #111111;
  --color-border: #dddddd;
  --radius-card: 8px;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
}
`, "utf8"),
    writeFile(resolve(root, "src/pages/home.page.html"), `<template data-slot="content">
  <main data-node-id="home">
    <h1>Home</h1>
    <!-- agent:page-sections -->
  </main>
</template>
`, "utf8"),
    writeFile(resolve(root, ".prototype/canvas.json"), `${JSON.stringify({
      schemaVersion: 1,
      frames: { home: { x: 80, y: 96 } },
    }, null, 2)}\n`, "utf8"),
  ]);
}
