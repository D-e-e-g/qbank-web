// Reads a practice-set payload into questions the answer area can draw, and builds the shuffled
// layout she sees. Response indexes stay on the stored question; the layout is saved beside the
// attempt. The server scores every answer.

import type { SetRun } from "../api";
import type { components } from "../api-schema";

type Schemas = components["schemas"];

export type QuestionType = Schemas["PracticeQuestion"]["type"];
export type QuestionOption = Schemas["QuestionOption"];
export type HighlightSegment = Schemas["HighlightSegment"];
export type QuestionTable = Schemas["QuestionTable"];
export type QuestionImage = Schemas["QuestionImage"];
/** An answer in its question's format. Every index refers to the stored body, never to the order she saw. */
export type Answer = Schemas["Answer"];
/** A practice set's sitting, kept on the server: the questions she has answered this time through, and her answers. */
export type Sitting = Schemas["SetSitting"];

/** A question's format with the body fields of that format. */
export type Question =
  | ({ type: "single" } & Schemas["ChoiceBody"])
  | ({ type: "priority" } & Schemas["ChoiceBody"])
  | ({ type: "sata" } & Schemas["ChoiceBody"])
  | ({ type: "highlight" } & Schemas["HighlightBody"])
  | ({ type: "order" } & Schemas["OrderBody"])
  | ({ type: "match" } & Schemas["MatchBody"])
  | ({ type: "matrix" } & Schemas["MatrixBody"])
  | ({ type: "matrixmulti" } & Schemas["MatrixMultiBody"])
  | ({ type: "cloze" } & Schemas["ClozeBody"]);

export const FORMAT_LABELS: Record<QuestionType, string> = {
  single: "Single answer",
  priority: "Priority / first action",
  sata: "Select all that apply",
  highlight: "Highlight",
  order: "Ordering",
  match: "Matching",
  matrix: "Matrix",
  matrixmulti: "Matrix, check all that fit",
  cloze: "Drop-down",
};

export interface PracticeTerm {
  key: string;
  term: string;
  meaning: string;
}

export interface LoadedQuestion {
  id: string;
  publicId: string;
  position: number;
  topic: string;
  cj: string | null;
  stem: string;
  ask: string;
  rationale: string;
  takeaway: string;
  terms: PracticeTerm[];
  /** The readings under the stem, when the question has them. */
  table: QuestionTable | null;
  /** Images to draw under the stem or with the rationale. */
  images: QuestionImage[];
  question: Question;
}

export interface LoadedSet {
  id: string;
  courseId: string;
  title: string;
  weekLabel: string;
  questions: LoadedQuestion[];
  /** How far she got this time through, on any device. Null opens the set at question 1. */
  sitting: Sitting | null;
  /** Where she stands in the set, as the server says. Null from a server that does not send it yet, and in Review. */
  run: SetRun | null;
}

export interface OptionLayout {
  kind: "options";
  /** Original option indexes, in the order she sees them. */
  order: number[];
}

export interface OrderLayout {
  kind: "order";
  /** Original item indexes in the order the question opened. */
  start: number[];
}

export interface MatchLayout {
  kind: "match";
  /** Right-hand texts, including distractors, in shuffled order. */
  choices: string[];
}

export interface ClozeLayout {
  kind: "cloze";
  /** For each blank, original option indexes in the order the menu shows them. */
  blanks: number[][];
}

export interface PlainLayout {
  kind: "plain";
}

export type Layout = OptionLayout | OrderLayout | MatchLayout | ClozeLayout | PlainLayout;

/** Her in-progress answer. Nulls are parts she has not filled in yet. */
export type Draft =
  | { type: "single"; choice: number | null }
  | { type: "priority"; choice: number | null }
  | { type: "sata"; picks: readonly number[] }
  | { type: "highlight"; picks: readonly number[] }
  | { type: "order"; positions: readonly number[] }
  | { type: "match"; choices: readonly (string | null)[] }
  | { type: "matrix"; choices: readonly (string | null)[] }
  | { type: "matrixmulti"; choices: readonly (readonly string[])[] }
  | { type: "cloze"; choices: readonly (number | null)[] };

export function readPracticeSet(body: unknown): LoadedSet | null {
  if (!isRecord(body) || typeof body.id !== "string" || typeof body.courseId !== "string" || typeof body.title !== "string") {
    return null;
  }
  if (typeof body.weekLabel !== "string" || !Array.isArray(body.questions)) return null;
  const questions: LoadedQuestion[] = [];
  for (const item of body.questions) {
    const question = readLoadedQuestion(item);
    if (!question) return null;
    questions.push(question);
  }
  questions.sort((left, right) => left.position - right.position);
  return { id: body.id, courseId: body.courseId, title: body.title, weekLabel: body.weekLabel, questions, sitting: readSitting(body.sitting), run: readRun(body.run) };
}

const RUNS: readonly SetRun[] = ["new", "midway", "restarted", "done"];

function readRun(value: unknown): SetRun | null {
  return RUNS.find((run) => run === value) ?? null;
}

function readSitting(value: unknown): Sitting | null {
  if (!isRecord(value) || !Array.isArray(value.answeredQuestionIds) || !Array.isArray(value.answers)) return null;
  return value as unknown as Sitting;
}

/** Options, order items, match choices, and drop-down choices are shuffled once per opening. */
export function makeLayout(question: Question): Layout {
  switch (question.type) {
    case "single":
    case "priority":
    case "sata":
      return { kind: "options", order: shuffle(indexes(question.options.length)) };
    case "order": {
      const start = shuffle(indexes(question.items.length));
      // An opening that is already the answer key is not a shuffle she has to solve.
      const alreadyCorrect = start.every((value, index) => value === index);
      return { kind: "order", start: alreadyCorrect ? [...start].reverse() : start };
    }
    case "match":
      return {
        kind: "match",
        choices: shuffle([...question.pairs.map((pair) => pair.r), ...(question.extra ?? []).map((extra) => extra.r)]),
      };
    case "cloze":
      return { kind: "cloze", blanks: question.cloze.blanks.map((blank) => shuffle(indexes(blank.opts.length))) };
    case "highlight":
    case "matrix":
    case "matrixmulti":
      return { kind: "plain" };
  }
}

export function initialDraft(question: Question, layout: Layout): Draft {
  switch (question.type) {
    case "single":
      return { type: "single", choice: null };
    case "priority":
      return { type: "priority", choice: null };
    case "sata":
      return { type: "sata", picks: [] };
    case "highlight":
      return { type: "highlight", picks: [] };
    case "order":
      return { type: "order", positions: layout.kind === "order" ? [...layout.start] : indexes(question.items.length) };
    case "match":
      return { type: "match", choices: question.pairs.map(() => null) };
    case "matrix":
      return { type: "matrix", choices: question.rows.map(() => null) };
    case "matrixmulti":
      return { type: "matrixmulti", choices: question.rows.map(() => []) };
    case "cloze":
      return { type: "cloze", choices: question.cloze.blanks.map(() => null) };
  }
}

/**
 * The shuffle saved with an answer, checked against the question. A missing or mismatched one
 * falls back to the question's own order.
 */
export function readLayout(question: Question, value: unknown): Layout {
  const saved = isRecord(value) ? value : {};
  switch (question.type) {
    case "single":
    case "priority":
    case "sata": {
      const order = isPermutation(saved.order, question.options.length) ? saved.order : indexes(question.options.length);
      return { kind: "options", order };
    }
    case "order": {
      const start = isPermutation(saved.start, question.items.length) ? saved.start : indexes(question.items.length);
      return { kind: "order", start };
    }
    case "match": {
      const expected = [...question.pairs.map((pair) => pair.r), ...(question.extra ?? []).map((extra) => extra.r)];
      const choices = Array.isArray(saved.choices) && saved.choices.every((choice) => typeof choice === "string") && sameItems(saved.choices, expected)
        ? saved.choices
        : expected;
      return { kind: "match", choices };
    }
    case "cloze": {
      const blanks = question.cloze.blanks.map((blank, index) => {
        const order: unknown = Array.isArray(saved.blanks) ? saved.blanks[index] : undefined;
        return isPermutation(order, blank.opts.length) ? order : indexes(blank.opts.length);
      });
      return { kind: "cloze", blanks };
    }
    case "highlight":
    case "matrix":
    case "matrixmulti":
      return { kind: "plain" };
  }
}

/** A saved answer as the answer area shows it, or null when it does not fit the question. */
export function draftFromResponse(question: Question, value: unknown): Draft | null {
  if (!isRecord(value) || value.type !== question.type) return null;
  switch (question.type) {
    case "single":
    case "priority":
      return typeof value.choice === "number" ? { type: question.type, choice: value.choice } : null;
    case "sata":
    case "highlight":
      return isNumbers(value.picks) ? { type: question.type, picks: value.picks } : null;
    case "order":
      return isPermutation(value.positions, question.items.length) ? { type: "order", positions: value.positions } : null;
    case "match":
    case "matrix":
      return Array.isArray(value.choices) && value.choices.every((choice) => choice === null || typeof choice === "string")
        ? { type: question.type, choices: value.choices as (string | null)[] }
        : null;
    case "matrixmulti":
      return isStringLists(value.choices) && value.choices.length === question.rows.length
        ? { type: "matrixmulti", choices: value.choices.map((row) => [...row]) }
        : null;
    case "cloze":
      return Array.isArray(value.choices) && value.choices.every((choice) => choice === null || typeof choice === "number")
        ? { type: "cloze", choices: value.choices as (number | null)[] }
        : null;
  }
}

/** The answer to send, or null when a required part is still empty. Ordering always counts. */
export function toResponse(draft: Draft): Answer | null {
  switch (draft.type) {
    case "single":
    case "priority":
      if (draft.choice === null) return null;
      return { type: draft.type, choice: draft.choice };
    case "sata":
    case "highlight":
      if (draft.picks.length === 0) return null;
      return { type: draft.type, picks: [...draft.picks] };
    case "order":
      return { type: "order", positions: [...draft.positions] };
    case "match":
      if (draft.choices.some((choice) => choice === null)) return null;
      return { type: "match", choices: [...draft.choices] };
    case "matrix":
      if (draft.choices.some((choice) => choice === null)) return null;
      return { type: "matrix", choices: [...draft.choices] };
    case "matrixmulti":
      if (draft.choices.some((row) => row.length === 0)) return null;
      return { type: "matrixmulti", choices: draft.choices.map((row) => [...row]) };
    case "cloze":
      if (draft.choices.some((choice) => choice === null)) return null;
      return { type: "cloze", choices: [...draft.choices] };
  }
}

export function togglePick(picks: readonly number[], index: number): number[] {
  return picks.includes(index) ? picks.filter((item) => item !== index) : [...picks, index];
}

/** Checks or unchecks one column of a matrix row. The result stays in column order, and a repeated name counts once. */
export function toggleMatrixColumn(columns: readonly string[], picked: readonly string[], column: string): string[] {
  const next = new Set(picked);
  if (next.has(column)) next.delete(column);
  else next.add(column);
  return columns.filter((name) => next.has(name));
}

/**
 * Strikes out a choice she has ruled out, or restores one she struck. Striking a choice she had
 * picked unpicks it. Strikes stay on her device and never become part of her answer.
 */
export function toggleStrike(draft: Draft, struck: readonly number[], index: number): { draft: Draft; struck: number[] } {
  if (struck.includes(index)) return { draft, struck: struck.filter((item) => item !== index) };
  return { draft: unpick(draft, index), struck: [...struck, index] };
}

/** The letter shown beside a choice: A for the first one she sees, then B, C, and on. */
export function choiceLetter(position: number): string {
  return String.fromCharCode(65 + position);
}

function unpick(draft: Draft, index: number): Draft {
  switch (draft.type) {
    case "single":
    case "priority":
      return draft.choice === index ? { ...draft, choice: null } : draft;
    case "sata":
      return draft.picks.includes(index) ? { ...draft, picks: draft.picks.filter((item) => item !== index) } : draft;
    default:
      return draft;
  }
}

export function moveOrder(positions: readonly number[], index: number, direction: -1 | 1): number[] {
  const next = index + direction;
  const copy = [...positions];
  const current = copy[index];
  const other = copy[next];
  if (current === undefined || other === undefined) return copy;
  copy[index] = other;
  copy[next] = current;
  return copy;
}

/** Pieces of a cloze sentence. Numbers are blank indexes. */
export function clozeParts(text: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const pattern = /\{(\d+)\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    const token = match[1];
    if (token === undefined) continue;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(Number(token));
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function readLoadedQuestion(value: unknown): LoadedQuestion | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.publicId !== "string") return null;
  if (typeof value.position !== "number" || typeof value.type !== "string" || typeof value.topic !== "string") return null;
  if (typeof value.stem !== "string" || typeof value.ask !== "string") return null;
  if (typeof value.rationale !== "string" || typeof value.takeaway !== "string") return null;
  if (!isRecord(value.body)) return null;
  const terms = readTerms(value.terms);
  const question = readQuestion(value.type, value.body);
  if (!terms || !question) return null;
  return {
    id: value.id,
    publicId: value.publicId,
    position: value.position,
    topic: value.topic,
    cj: typeof value.cj === "string" ? value.cj : null,
    stem: value.stem,
    ask: value.ask,
    rationale: value.rationale,
    takeaway: value.takeaway,
    terms,
    table: readTable(value.table),
    images: readImages(value.images),
    question,
  };
}

/** The question's table, which the server checked and padded; null when it has none. */
function readTable(value: unknown): QuestionTable | null {
  if (!isRecord(value) || (value.caption !== null && typeof value.caption !== "string")) return null;
  const head = readStrings(value.head) ?? [];
  if (!Array.isArray(value.rows) || value.rows.length === 0) return null;
  const rows: string[][] = [];
  for (const row of value.rows) {
    const cells = readStrings(row);
    if (!cells) return null;
    rows.push(cells);
  }
  return { caption: value.caption, head, rows };
}

/** The question's images, which the server sends as data URLs that are safe to draw. Anything else is left out. */
function readImages(value: unknown): QuestionImage[] {
  if (!Array.isArray(value)) return [];
  const images: QuestionImage[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.url !== "string" || !item.url.startsWith("data:") || typeof item.alt !== "string") continue;
    if (item.caption !== null && typeof item.caption !== "string") continue;
    if (item.at !== "stem" && item.at !== "rationale") continue;
    images.push({ url: item.url, alt: item.alt, caption: item.caption, at: item.at });
  }
  return images;
}

function readTerms(value: unknown): PracticeTerm[] | null {
  if (!Array.isArray(value)) return null;
  const terms: PracticeTerm[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.term !== "string" || typeof item.meaning !== "string") {
      return null;
    }
    terms.push({ key: item.key, term: item.term, meaning: item.meaning });
  }
  return terms;
}

function readQuestion(type: string, body: Record<string, unknown>): Question | null {
  switch (type) {
    case "single":
    case "priority":
    case "sata": {
      const options = readList(body.options, readOption);
      return options ? { type, options } : null;
    }
    case "highlight": {
      const segments = readList(body.segments, readSegment);
      return segments ? { type, segments } : null;
    }
    case "order": {
      const items = readList(body.items, readOrderItem);
      return items ? { type, items } : null;
    }
    case "match": {
      const pairs = readList(body.pairs, readPair);
      if (!pairs) return null;
      if (body.extra === undefined) return { type, pairs };
      if (Array.isArray(body.extra) && body.extra.length === 0) return { type, pairs };
      const extra = readList(body.extra, readExtra);
      return extra ? { type, pairs, extra } : null;
    }
    case "matrix": {
      const columns = readStrings(body.columns);
      const rows = readList(body.rows, readMatrixRow);
      return columns && rows ? { type, columns, rows } : null;
    }
    case "matrixmulti": {
      const columns = readStrings(body.columns);
      const rows = readList(body.rows, readMatrixMultiRow);
      return columns && rows ? { type, columns, rows } : null;
    }
    case "cloze": {
      const cloze = readCloze(body.cloze);
      return cloze ? { type, cloze } : null;
    }
    default:
      return null;
  }
}

function readOption(value: unknown): QuestionOption | null {
  if (!isRecord(value) || typeof value.t !== "string") return null;
  const why = typeof value.why === "string" ? { why: value.why } : {};
  return value.ok === true ? { t: value.t, ok: true, ...why } : { t: value.t, ...why };
}

function readSegment(value: unknown): HighlightSegment | null {
  return readOption(value);
}

function readOrderItem(value: unknown): Schemas["OrderItem"] | null {
  if (!isRecord(value) || typeof value.t !== "string") return null;
  return typeof value.why === "string" ? { t: value.t, why: value.why } : { t: value.t };
}

function readPair(value: unknown): Schemas["MatchPair"] | null {
  if (!isRecord(value) || typeof value.l !== "string" || typeof value.r !== "string") return null;
  return typeof value.why === "string" ? { l: value.l, r: value.r, why: value.why } : { l: value.l, r: value.r };
}

function readExtra(value: unknown): Schemas["MatchExtra"] | null {
  if (!isRecord(value) || typeof value.r !== "string") return null;
  return typeof value.why === "string" ? { r: value.r, why: value.why } : { r: value.r };
}

function readMatrixRow(value: unknown): Schemas["MatrixRow"] | null {
  if (!isRecord(value) || typeof value.t !== "string" || typeof value.ans !== "string") return null;
  return typeof value.why === "string" ? { t: value.t, ans: value.ans, why: value.why } : { t: value.t, ans: value.ans };
}

function readMatrixMultiRow(value: unknown): Schemas["MatrixMultiRow"] | null {
  if (!isRecord(value) || typeof value.t !== "string") return null;
  const ans = readStrings(value.ans);
  if (!ans) return null;
  return typeof value.why === "string" ? { t: value.t, ans, why: value.why } : { t: value.t, ans };
}

function readCloze(value: unknown): Schemas["ClozeBody"]["cloze"] | null {
  if (!isRecord(value) || typeof value.text !== "string") return null;
  const blanks = readList(value.blanks, readBlank);
  return blanks ? { text: value.text, blanks } : null;
}

function readBlank(value: unknown): Schemas["ClozeBlank"] | null {
  if (!isRecord(value) || typeof value.ans !== "number") return null;
  const opts = readStrings(value.opts);
  if (!opts) return null;
  return typeof value.why === "string" ? { opts, ans: value.ans, why: value.why } : { opts, ans: value.ans };
}

function readStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    items.push(item);
  }
  return items;
}

function readList<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = read(item);
    if (!parsed) return null;
    items.push(parsed);
  }
  return items;
}

function isNumbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isInteger(item));
}

function isStringLists(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every((row) => Array.isArray(row) && row.every((item) => typeof item === "string"));
}

function isPermutation(value: unknown, length: number): value is number[] {
  if (!isNumbers(value) || value.length !== length) return false;
  return [...value].sort((a, b) => a - b).every((item, index) => item === index);
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function indexes(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function shuffle<T extends string | number>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = copy[index];
    const other = copy[swap];
    if (current === undefined || other === undefined) continue;
    copy[index] = other;
    copy[swap] = current;
  }
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
