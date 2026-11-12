import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CODE_LINE_LIMIT,
  SOURCE_GLOBS,
  checkRepository,
  countCodeLines,
  evaluate,
  validateConfig,
} from "./max-lines.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("countCodeLines", () => {
  it("skips blank lines and comment-only lines", () => {
    const text = "const a = 1;\n\n// comment\nconst b = 2; // trailing\n/*\n block\n*/\n";
    assert.equal(countCodeLines(text, "example.ts"), 2);
  });

  it("counts a line that has code beside a comment", () => {
    assert.equal(countCodeLines("const x = /* c */ 1;\n", "example.ts"), 1);
  });

  it("counts only the code lines around a block comment", () => {
    assert.equal(countCodeLines("foo /* start\n middle\nend */;\n", "example.ts"), 2);
  });

  it("counts braces around a JSX comment", () => {
    assert.equal(countCodeLines("{/* note */}\n", "example.tsx"), 1);
    const component = "export function C() {\n  return <div>{/* note */}</div>;\n}\n";
    assert.equal(countCodeLines(component, "example.tsx"), 3);
  });

  it("does not treat comment markers inside strings or templates as comments", () => {
    assert.equal(countCodeLines("const r = /[/]/;\nconst next = 1;\n", "example.ts"), 2);
    const template = "const t = `line1\n// not a comment\nline3`;\n";
    assert.equal(countCodeLines(template, "example.ts"), 3);
  });

  it("counts a file that does not end in a newline", () => {
    assert.equal(countCodeLines("const a = 1;\nconst b = 2;", "example.ts"), 2);
  });

  it("ignores a shebang the same way ESLint does", () => {
    assert.equal(countCodeLines("#!/usr/bin/env node\nconsole.log(1);\n", "example.js"), 1);
  });

  it("counts a comment-only file as zero", () => {
    assert.equal(countCodeLines("// only\n\n  \n", "example.ts"), 0);
    assert.equal(countCodeLines("/* only block */\n", "example.ts"), 0);
  });
});

describe("evaluate", () => {
  const limit = CODE_LINE_LIMIT;

  it("fails a file that is not listed and is over the limit", () => {
    const { failures, warnings } = evaluate({
      limit,
      counts: new Map([["apps/web/src/New.tsx", limit + 1]]),
      allow: [],
    });
    assert.deepEqual(warnings, []);
    assert.equal(failures.length, 1);
    assert.match(failures[0] ?? "", /New\.tsx has 1001 code lines/);
    assert.match(failures[0] ?? "", /not on the allow list/);
  });

  it("passes a file at the limit", () => {
    const { failures, warnings } = evaluate({
      limit,
      counts: new Map([["apps/web/src/Exact.tsx", limit]]),
      allow: [],
    });
    assert.deepEqual(failures, []);
    assert.deepEqual(warnings, []);
  });

  it("warns and does not fail when a listed file grows", () => {
    const { failures, warnings } = evaluate({
      limit,
      counts: new Map([["apps/web/src/Big.tsx", 1601]]),
      allow: [{ path: "apps/web/src/Big.tsx", lines: 1600 }],
    });
    assert.deepEqual(failures, []);
    assert.match(warnings[0] ?? "", /warning/);
    assert.match(warnings[0] ?? "", /over its recorded 1600/);
    assert.match(warnings[0] ?? "", /exempt until it is split/);
  });

  it("prints the lower count when a listed file shrinks but stays over the limit", () => {
    const { failures, warnings } = evaluate({
      limit,
      counts: new Map([["apps/web/src/Big.tsx", 1400]]),
      allow: [{ path: "apps/web/src/Big.tsx", lines: 1500 }],
    });
    assert.deepEqual(failures, []);
    assert.deepEqual(warnings, [
      "max-lines: warning: apps/web/src/Big.tsx has 1400 code lines, under its recorded 1500. Record 1400.",
    ]);
  });

  it("passes when a listed file matches its recorded count", () => {
    const { failures, warnings } = evaluate({
      limit,
      counts: new Map([["apps/web/src/Big.tsx", 1500]]),
      allow: [{ path: "apps/web/src/Big.tsx", lines: 1500 }],
    });
    assert.deepEqual(failures, []);
    assert.deepEqual(warnings, []);
  });

  it("warns and does not fail when a listed file is now at or under the limit", () => {
    const { failures, warnings } = evaluate({
      limit,
      counts: new Map([["apps/web/src/Small.tsx", limit]]),
      allow: [{ path: "apps/web/src/Small.tsx", lines: 1400 }],
    });
    assert.deepEqual(failures, []);
    assert.match(warnings[0] ?? "", /stale/);
    assert.match(warnings[0] ?? "", /Remove it/);
  });

  it("warns and does not fail when a listed file is gone", () => {
    const { failures, warnings } = evaluate({
      limit,
      counts: new Map(),
      allow: [{ path: "apps/web/src/Gone.tsx", lines: 1400 }],
    });
    assert.deepEqual(failures, []);
    assert.match(warnings[0] ?? "", /the file is gone/);
  });

  it("warns when an allow-list entry matches an exclusion", () => {
    const { failures, warnings } = evaluate({
      limit,
      counts: new Map(),
      allow: [{ path: "apps/web/src/api-schema.ts", lines: 2000 }],
      missingKind: () => "excluded",
    });
    assert.deepEqual(failures, []);
    assert.match(warnings[0] ?? "", /matches an exclusion/);
  });
});

describe("validateConfig", () => {
  it("accepts the repository shape", () => {
    const loaded = validateConfig({
      limit: CODE_LINE_LIMIT,
      include: SOURCE_GLOBS,
      exclude: [{ glob: "apps/web/src/api-schema.ts", reason: "Generated." }],
      allow: [],
    });
    assert.equal(loaded.ok, true);
  });

  it("rejects a limit other than 1,000", () => {
    const loaded = validateConfig({
      limit: 2000,
      include: SOURCE_GLOBS,
      exclude: [],
      allow: [],
    });
    assert.equal(loaded.ok, false);
  });

  it("rejects a narrowed include list", () => {
    const loaded = validateConfig({
      limit: CODE_LINE_LIMIT,
      include: ["**/*.js"],
      exclude: [],
      allow: [],
    });
    assert.equal(loaded.ok, false);
  });

  it("rejects an exclusion without a one-line reason", () => {
    const loaded = validateConfig({
      limit: CODE_LINE_LIMIT,
      include: SOURCE_GLOBS,
      exclude: [{ glob: "apps/web/src/api-schema.ts", reason: "" }],
      allow: [],
    });
    assert.equal(loaded.ok, false);
  });

  it("rejects an allow-list count at or under the limit", () => {
    const loaded = validateConfig({
      limit: CODE_LINE_LIMIT,
      include: SOURCE_GLOBS,
      exclude: [],
      allow: [{ path: "apps/web/src/Big.tsx", lines: CODE_LINE_LIMIT }],
    });
    assert.equal(loaded.ok, false);
  });

  it("rejects a duplicate allow-list path", () => {
    const loaded = validateConfig({
      limit: CODE_LINE_LIMIT,
      include: SOURCE_GLOBS,
      exclude: [],
      allow: [
        { path: "apps/web/src/Big.tsx", lines: 1200 },
        { path: "apps/web/src/Big.tsx", lines: 1200 },
      ],
    });
    assert.equal(loaded.ok, false);
  });
});

describe("repository", () => {
  it("passes with an empty allow list and checks hand-written sources only", async () => {
    const result = await checkRepository(repoRoot);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.allow, []);
    assert.ok(result.counts.has("eslint.config.js"));
    assert.ok(result.counts.has("e2e/fixtures.ts"));
    assert.ok(result.counts.has("apps/web/src/practice/PracticeScreen.tsx"));
    assert.equal(result.counts.has("apps/web/src/api-schema.ts"), false);
    assert.equal(result.counts.has(".agents/skills/qbank-design/_ds_bundle.js"), false);
    assert.equal(result.counts.has("pnpm-lock.yaml"), false);
    for (const [file, lines] of result.counts) {
      assert.ok(lines <= CODE_LINE_LIMIT, `${file} has ${String(lines)} code lines`);
    }
  });

  it("keeps a reason on every exclusion in the checked-in config", async () => {
    const configPath = path.join(repoRoot, "scripts", "max-lines.config.json");
    const raw = JSON.parse(await readFile(configPath, "utf8"));
    const loaded = validateConfig(raw);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.ok(loaded.config.exclude.length > 0);
    for (const entry of loaded.config.exclude) {
      assert.notEqual(entry.reason.trim(), "");
    }
  });
});
