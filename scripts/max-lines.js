import { Linter } from "eslint";
import { existsSync, realpathSync } from "node:fs";
import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tseslint from "typescript-eslint";

/** Code lines, not physical lines. A code line is not blank and not only a comment. */
export const CODE_LINE_LIMIT = 1000;

/** JavaScript and TypeScript the repository's ESLint run already checks, tests included. */
export const SOURCE_GLOBS = [
  "**/*.js",
  "**/*.mjs",
  "**/*.cjs",
  "**/*.jsx",
  "**/*.ts",
  "**/*.tsx",
  "**/*.mts",
  "**/*.cts",
];

const COUNT_MESSAGE = /^File has too many lines \((\d+)\)\./;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function countConfig() {
  return [
    {
      files: SOURCE_GLOBS,
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          ecmaFeatures: { jsx: true },
          sourceType: "module",
        },
      },
      // max 0 makes the rule report the code-line count whenever a file has any.
      // skipBlankLines and skipComments are the repository's definition of a code line.
      rules: {
        "max-lines": ["error", { max: 0, skipBlankLines: true, skipComments: true }],
      },
    },
  ];
}

/**
 * Count code lines the way ESLint's max-lines rule does with skipBlankLines and skipComments.
 * @param {string} text
 * @param {string} filename Repo-relative path. The extension selects the parser mode.
 * @returns {number}
 */
export function countCodeLines(text, filename) {
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(text, countConfig(), filename);
  const fatal = messages.find((message) => message.fatal || message.ruleId === null);
  if (fatal) {
    const where = fatal.line ? `${filename}:${String(fatal.line)}` : filename;
    throw new Error(`${where}: ${fatal.message}`);
  }
  const hit = messages.find((message) => message.ruleId === "max-lines");
  if (!hit) return 0;
  const match = COUNT_MESSAGE.exec(hit.message);
  if (!match?.[1]) {
    throw new Error(`${filename}: unexpected max-lines message: ${hit.message}`);
  }
  return Number(match[1]);
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, config: { limit: number, include: string[], exclude: { glob: string, reason: string }[], allow: { path: string, lines: number }[] } } | { ok: false, failures: string[] }}
 */
export function validateConfig(raw) {
  const failures = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, failures: ["max-lines: the config must be a JSON object."] };
  }
  const config = /** @type {Record<string, unknown>} */ (raw);
  if (config.limit !== CODE_LINE_LIMIT) {
    failures.push(`max-lines: the limit is ${String(CODE_LINE_LIMIT)} code lines.`);
  }
  if (JSON.stringify(config.include) !== JSON.stringify(SOURCE_GLOBS)) {
    failures.push("max-lines: include must stay the JavaScript and TypeScript source globs.");
  }
  if (!Array.isArray(config.exclude)) {
    failures.push("max-lines: exclude must be a list of globs with reasons.");
  } else {
    config.exclude.forEach((entry, index) => {
      const label = `exclude entry ${String(index + 1)}`;
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        failures.push(`max-lines: ${label} must be an object with glob and reason.`);
        return;
      }
      const glob = /** @type {{ glob?: unknown, reason?: unknown }} */ (entry).glob;
      const reason = /** @type {{ glob?: unknown, reason?: unknown }} */ (entry).reason;
      if (typeof glob !== "string" || glob === "") {
        failures.push(`max-lines: ${label} needs a glob.`);
      }
      if (typeof reason !== "string" || reason.trim() === "" || reason.includes("\n")) {
        failures.push(`max-lines: ${label} needs a one-line reason.`);
      }
    });
  }
  const allowPaths = new Set();
  if (!Array.isArray(config.allow)) {
    failures.push("max-lines: allow must be a list of files and their code-line counts.");
  } else {
    config.allow.forEach((entry, index) => {
      const label = `allow-list entry ${String(index + 1)}`;
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        failures.push(`max-lines: ${label} must be an object with path and lines.`);
        return;
      }
      const filePath = /** @type {{ path?: unknown, lines?: unknown }} */ (entry).path;
      const lines = /** @type {{ path?: unknown, lines?: unknown }} */ (entry).lines;
      if (typeof filePath !== "string" || !isRepoRelative(filePath)) {
        failures.push(`max-lines: ${label} needs a repo-relative path.`);
        return;
      }
      if (allowPaths.has(filePath)) {
        failures.push(`max-lines: allow-list entry ${filePath} is listed more than once.`);
      }
      allowPaths.add(filePath);
      if (!Number.isInteger(lines) || /** @type {number} */ (lines) <= CODE_LINE_LIMIT) {
        failures.push(
          `max-lines: allow-list entry ${filePath} must record a count over ${String(CODE_LINE_LIMIT)}.`,
        );
      }
    });
  }
  if (failures.length > 0) return { ok: false, failures };
  return {
    ok: true,
    config: /** @type {{ limit: number, include: string[], exclude: { glob: string, reason: string }[], allow: { path: string, lines: number }[] }} */ (
      config
    ),
  };
}

/** @param {string} filePath */
function isRepoRelative(filePath) {
  if (filePath === "" || filePath.startsWith("/") || filePath.startsWith("./")) return false;
  if (filePath.includes("\\") || filePath.includes("\n")) return false;
  return !filePath.split("/").includes("..");
}

/**
 * @param {string} filePath
 * @param {{ glob: string }[]} exclude
 */
function isExcluded(filePath, exclude) {
  return exclude.some((entry) => path.matchesGlob(filePath, entry.glob));
}

/**
 * @param {{
 *   limit: number,
 *   counts: Map<string, number>,
 *   allow: { path: string, lines: number }[],
 *   missingKind?: (filePath: string) => "gone" | "excluded" | "unchecked",
 * }} input
 * @returns {{ failures: string[], warnings: string[] }}
 */
export function evaluate({ limit, counts, allow, missingKind = () => "gone" }) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<string, number>} */
  const allowed = new Map(allow.map((entry) => [entry.path, entry.lines]));

  for (const filePath of [...counts.keys()].sort()) {
    const lines = counts.get(filePath);
    if (lines === undefined) continue;
    const recorded = allowed.get(filePath);
    if (recorded === undefined) {
      if (lines > limit) {
        failures.push(
          `max-lines: ${filePath} has ${String(lines)} code lines, over the limit of ${String(limit)}, and is not on the allow list.`,
        );
      }
      continue;
    }
    // Listed files are exempt until they are split. Growth and a stale count warn.
    if (lines > recorded) {
      warnings.push(
        `max-lines: warning: ${filePath} has ${String(lines)} code lines, over its recorded ${String(recorded)}. It is exempt until it is split.`,
      );
    } else if (lines <= limit) {
      warnings.push(
        `max-lines: warning: allow-list entry ${filePath} is stale: it has ${String(lines)} code lines, at or under ${String(limit)}. Remove it.`,
      );
    } else if (lines < recorded) {
      warnings.push(
        `max-lines: warning: ${filePath} has ${String(lines)} code lines, under its recorded ${String(recorded)}. Record ${String(lines)}.`,
      );
    }
  }

  for (const filePath of [...allowed.keys()].sort()) {
    if (counts.has(filePath)) continue;
    const kind = missingKind(filePath);
    if (kind === "excluded") {
      warnings.push(
        `max-lines: warning: allow-list entry ${filePath} matches an exclusion. Exclusions are not allow-list entries.`,
      );
    } else if (kind === "unchecked") {
      warnings.push(
        `max-lines: warning: allow-list entry ${filePath} is not a checked source file. Remove it.`,
      );
    } else {
      warnings.push(
        `max-lines: warning: allow-list entry ${filePath} is stale: the file is gone. Remove it.`,
      );
    }
  }

  failures.sort();
  warnings.sort();
  return { failures, warnings };
}

/**
 * @param {string} root
 * @param {{ include: string[], exclude: { glob: string, reason: string }[] }} config
 * @returns {Promise<Map<string, number>>}
 */
async function scan(root, config) {
  const excludeGlobs = config.exclude.map((entry) => entry.glob);
  /** @type {Set<string>} */
  const found = new Set();
  for (const pattern of config.include) {
    for await (const file of glob(pattern, { cwd: root, exclude: excludeGlobs })) {
      const posix = file.split(path.sep).join("/");
      if (isExcluded(posix, config.exclude)) continue;
      found.add(posix);
    }
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const file of [...found].sort()) {
    const text = await readFile(path.join(root, file), "utf8");
    counts.set(file, countCodeLines(text, file));
  }
  return counts;
}

/**
 * @param {string} [root]
 */
export async function checkRepository(root = repoRoot) {
  const configPath = path.join(root, "scripts", "max-lines.config.json");
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      failures: [`max-lines: cannot read the config: ${message}`],
      warnings: [],
      counts: new Map(),
      allow: [],
    };
  }
  const loaded = validateConfig(raw);
  if (!loaded.ok) {
    return { failures: loaded.failures, warnings: [], counts: new Map(), allow: [] };
  }
  /** @type {Map<string, number>} */
  let counts;
  try {
    counts = await scan(root, loaded.config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      failures: [`max-lines: ${message}`],
      warnings: [],
      counts: new Map(),
      allow: loaded.config.allow,
    };
  }
  /** @type {string[]} */
  const failures = [];
  if (counts.size === 0) {
    failures.push("max-lines: no source files were checked.");
  }
  const result = evaluate({
    limit: loaded.config.limit,
    counts,
    allow: loaded.config.allow,
    missingKind(filePath) {
      if (isExcluded(filePath, loaded.config.exclude)) return "excluded";
      if (!existsSync(path.join(root, filePath))) return "gone";
      return "unchecked";
    },
  });
  return {
    failures: [...failures, ...result.failures],
    warnings: result.warnings,
    counts,
    allow: loaded.config.allow,
  };
}

export async function main() {
  const result = await checkRepository();
  for (const warning of result.warnings) console.log(warning);
  for (const failure of result.failures) console.log(failure);
  return result.failures.length > 0 ? 1 : 0;
}

function ranDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (ranDirectly()) {
  process.exit(await main());
}
