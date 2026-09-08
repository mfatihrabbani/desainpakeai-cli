import assert from "node:assert/strict";
import test from "node:test";
import { parseUnifiedPatch } from "../src/unified-patch.js";

test("parseUnifiedPatch converts ordered hunks into atomic replace edits", () => {
  assert.deepEqual(parseUnifiedPatch(`--- a/src/pages/home.page.html
+++ b/src/pages/home.page.html
@@ -1,3 +1,3 @@
 <main>
-  <h1>Home</h1>
+  <h1>Katalog</h1>
 </main>
@@ -5,2 +5,2 @@
-<p>Old</p>
+<p>New</p>
 <footer></footer>
`), [
    {
      operation: "replace",
      oldText: "<main>\n  <h1>Home</h1>\n</main>",
      newText: "<main>\n  <h1>Katalog</h1>\n</main>",
    },
    {
      operation: "replace",
      oldText: "<p>Old</p>\n<footer></footer>",
      newText: "<p>New</p>\n<footer></footer>",
    },
  ]);
});

test("parseUnifiedPatch rejects ambiguous insertion-only hunks", () => {
  assert.throws(
    () => parseUnifiedPatch("@@ -2,0 +2,1 @@\n+<p>Inserted</p>\n"),
    /context line/,
  );
});

test("parseUnifiedPatch rejects patches spanning multiple files", () => {
  assert.throws(
    () => parseUnifiedPatch(`--- a/one.html
+++ b/one.html
@@ -1 +1 @@
-one
+ONE
--- a/two.html
+++ b/two.html
@@ -1 +1 @@
-two
+TWO
`),
    /exactly one source file/,
  );
});
