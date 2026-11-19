// Tooltip copy: every entry has a term and a plain explanation, no em-dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY } from "../lib/glossary.js";

test("every glossary entry is complete and short enough for a tooltip", () => {
  for (const [id, e] of Object.entries(GLOSSARY)) {
    assert.ok(e.term && e.text, id);
    assert.ok(e.text.length <= 420, `${id} is ${e.text.length} chars`);
    assert.doesNotMatch(e.text, /—/, id);
  }
});
