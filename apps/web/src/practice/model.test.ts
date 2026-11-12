import { describe, expect, it } from "vitest";
import {
  choiceLetter,
  clozeParts,
  draftFromResponse,
  initialDraft,
  makeLayout,
  moveOrder,
  readLayout,
  readPracticeSet,
  toggleMatrixColumn,
  toggleStrike,
  toResponse,
  togglePick,
  type Question,
} from "./model";

const sata: Question = {
  type: "sata",
  options: [{ t: "Sit her up", ok: true }, { t: "Offer water" }, { t: "Check her oxygen", ok: true }, { t: "Dim the lights" }],
};

const order: Question = { type: "order", items: [{ t: "First" }, { t: "Second" }, { t: "Third" }] };

const match: Question = {
  type: "match",
  pairs: [
    { l: "Furosemide", r: "Loop diuretic" },
    { l: "Metoprolol", r: "Beta blocker" },
  ],
  extra: [{ r: "Anticoagulant" }],
};

const matrixMulti: Question = {
  type: "matrixmulti",
  columns: ["Asthma", "Heart failure"],
  rows: [
    { t: "Wheeze", ans: ["Asthma"], why: "Wheeze points to asthma." },
    { t: "Wakes short of breath", ans: ["Asthma", "Heart failure"] },
  ],
};

const cloze: Question = {
  type: "cloze",
  cloze: {
    text: "Sit the client {0} and weigh in the {1}.",
    blanks: [
      { opts: ["flat", "upright"], ans: 1 },
      { opts: ["morning", "evening", "night"], ans: 0 },
    ],
  },
};

function sorted(values: readonly (string | number)[]): (string | number)[] {
  return [...values].sort();
}

describe("makeLayout", () => {
  it("shuffles options, match choices, and each blank's choices without losing any", () => {
    const options = makeLayout(sata);
    expect(options.kind === "options" && sorted(options.order)).toEqual([0, 1, 2, 3]);
    const choices = makeLayout(match);
    expect(choices.kind === "match" && sorted(choices.choices)).toEqual(["Anticoagulant", "Beta blocker", "Loop diuretic"]);
    const blanks = makeLayout(cloze);
    expect(blanks.kind === "cloze" && blanks.blanks.map(sorted)).toEqual([
      [0, 1],
      [0, 1, 2],
    ]);
  });

  it("never opens an ordering question already in the right order", () => {
    for (let run = 0; run < 200; run += 1) {
      const layout = makeLayout(order);
      expect(layout.kind).toBe("order");
      if (layout.kind !== "order") return;
      expect(sorted(layout.start)).toEqual([0, 1, 2]);
      expect(layout.start).not.toEqual([0, 1, 2]);
    }
  });
});

describe("drafts and responses", () => {
  it("holds back an answer until every required part is filled in", () => {
    expect(toResponse(initialDraft(sata, makeLayout(sata)))).toBeNull();
    expect(toResponse({ type: "match", choices: ["Loop diuretic", null] })).toBeNull();
    expect(toResponse({ type: "cloze", choices: [1, null] })).toBeNull();
    expect(toResponse({ type: "single", choice: 0 })).toEqual({ type: "single", choice: 0 });
  });

  it("sends an ordering answer as its opening layout, which is never the right order", () => {
    const layout = makeLayout(order);
    expect(layout.kind).toBe("order");
    if (layout.kind !== "order") return;
    const response = toResponse(initialDraft(order, layout));
    expect(response).toEqual({ type: "order", positions: layout.start });
    expect(response).not.toEqual({ type: "order", positions: [0, 1, 2] });
  });

  it("sends every part she filled in, by index into the stored question", () => {
    expect(toResponse({ type: "sata", picks: [2, 0] })).toEqual({ type: "sata", picks: [2, 0] });
    expect(toResponse({ type: "highlight", picks: [1] })).toEqual({ type: "highlight", picks: [1] });
    expect(toResponse({ type: "priority", choice: 3 })).toEqual({ type: "priority", choice: 3 });
    expect(toResponse({ type: "match", choices: ["Beta blocker", "Loop diuretic"] })).toEqual({
      type: "match",
      choices: ["Beta blocker", "Loop diuretic"],
    });
    expect(toResponse({ type: "matrix", choices: ["Yes", "No"] })).toEqual({ type: "matrix", choices: ["Yes", "No"] });
    expect(toResponse({ type: "cloze", choices: [1, 0] })).toEqual({ type: "cloze", choices: [1, 0] });
    expect(toResponse({ type: "sata", picks: [] })).toBeNull();
  });

  it("holds a matrix with several checks per row until every row has one, then sends the column names", () => {
    expect(toResponse(initialDraft(matrixMulti, makeLayout(matrixMulti)))).toBeNull();
    expect(toResponse({ type: "matrixmulti", choices: [["Asthma"], []] })).toBeNull();
    expect(toResponse({ type: "matrixmulti", choices: [["Heart failure", "Asthma"], ["Asthma"]] })).toEqual({
      type: "matrixmulti",
      choices: [
        ["Heart failure", "Asthma"],
        ["Asthma"],
      ],
    });
    expect(toggleMatrixColumn(matrixMulti.columns, ["Heart failure"], "Asthma")).toEqual(["Asthma", "Heart failure"]);
    expect(toggleMatrixColumn(matrixMulti.columns, ["Asthma", "Heart failure"], "Asthma")).toEqual(["Heart failure"]);
    expect(makeLayout(matrixMulti)).toEqual({ kind: "plain" });
  });

  it("toggles picks and swaps neighbors", () => {
    expect(togglePick([0, 2], 2)).toEqual([0]);
    expect(togglePick([0], 3)).toEqual([0, 3]);
    expect(moveOrder([2, 0, 1], 1, -1)).toEqual([0, 2, 1]);
    expect(moveOrder([2, 0, 1], 0, -1)).toEqual([2, 0, 1]);
    expect(moveOrder([2, 0, 1], 2, 1)).toEqual([2, 0, 1]);
  });

  it("splits a drop-down sentence into text and blank numbers", () => {
    expect(clozeParts("Sit the client {0} and weigh in the {1}.")).toEqual(["Sit the client ", 0, " and weigh in the ", 1, "."]);
    expect(clozeParts("{0} first")).toEqual([0, " first"]);
  });
});

describe("readPracticeSet", () => {
  const question = {
    id: "5b1f3d4e-8c2a-4f1b-9e3d-2a1b3c4d5e6f",
    publicId: "Q1",
    position: 2,
    type: "sata",
    topic: "Heart failure",
    cj: "Take action",
    stem: "A client is short of breath.",
    ask: "Which actions help?",
    rationale: "Upright position and oxygen checks help.",
    takeaway: "Position first.",
    body: { options: [{ t: "Sit her up", ok: true, why: "Eases breathing." }, { t: "Offer water" }] },
    table: null,
    images: [],
    terms: [{ key: "orthopnea", term: "orthopnea", meaning: "Breathing is harder when lying flat." }],
  };
  const set = { id: "set", courseId: "course", title: "Week 1", weekLabel: "Week 1", questions: [question] };

  it("reads a set into questions the answer area draws, in position order", () => {
    const loaded = readPracticeSet({ ...set, questions: [question, { ...question, id: "other", publicId: "Q0", position: 1 }] });
    expect(loaded?.questions.map((item) => item.publicId)).toEqual(["Q0", "Q1"]);
    const first = loaded?.questions[1];
    expect(first?.question).toEqual({
      type: "sata",
      options: [{ t: "Sit her up", ok: true, why: "Eases breathing." }, { t: "Offer water" }],
    });
    expect(first?.terms[0]?.meaning).toBe("Breathing is harder when lying flat.");
  });

  it("reads the table and images the server sends with the question, and none when there are none", () => {
    const table = { caption: null, head: ["Time", "SpO2"], rows: [["0900", "97%"], ["0915", "93"]] };
    const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>')}`;
    const images = [
      { url: svg, alt: "A square", caption: null, at: "rationale" },
      { url: "data:image/png;base64,iVBORw0KGgo=", alt: "A chart", caption: "Day 2", at: "stem" },
    ];
    const loaded = readPracticeSet({ ...set, questions: [{ ...question, table, images }] })?.questions[0];
    expect(loaded?.table).toEqual(table);
    expect(loaded?.images).toEqual(images);
    expect(loaded?.question).not.toHaveProperty("table");

    const plain = readPracticeSet(set)?.questions[0];
    expect(plain?.table).toBeNull();
    expect(plain?.images).toEqual([]);
  });

  it("draws only images that are data URLs", () => {
    const images = [
      { url: "https://example.com/x.png", alt: "Remote", caption: null, at: "stem" },
      { url: "data:image/png;base64,iVBORw0KGgo=", alt: "A chart", caption: null, at: "stem" },
    ];
    const loaded = readPracticeSet({ ...set, questions: [{ ...question, images }] })?.questions[0];
    expect(loaded?.images.map((image) => image.alt)).toEqual(["A chart"]);
  });

  it("reads a matrix where a row can fit more than one column, and refuses one whose answers are not column lists", () => {
    const body = {
      columns: ["Asthma", "Heart failure"],
      rows: [
        { t: "Wheeze", ans: ["Asthma"], why: "Wheeze points to asthma." },
        { t: "Wakes short of breath", ans: ["Asthma", "Heart failure"] },
      ],
    };
    const loaded = readPracticeSet({ ...set, questions: [{ ...question, type: "matrixmulti", body }] });
    expect(loaded?.questions[0]?.question).toEqual({ type: "matrixmulti", ...body });
    expect(readPracticeSet({ ...set, questions: [{ ...question, type: "matrixmulti", body: { ...body, rows: [{ t: "Wheeze", ans: "Asthma" }] } }] })).toBeNull();
    expect(readPracticeSet({ ...set, questions: [{ ...question, type: "matrixmulti", body: { ...body, rows: [{ t: "Wheeze", ans: [] }] } }] })).toBeNull();
  });

  it("refuses a set with a question it cannot read", () => {
    expect(readPracticeSet({ ...set, questions: [{ ...question, type: "essay" }] })).toBeNull();
    expect(readPracticeSet({ ...set, questions: [{ ...question, body: { options: [] } }] })).toBeNull();
    expect(readPracticeSet({ ...set, questions: [{ ...question, terms: undefined }] })).toBeNull();
    expect(readPracticeSet(null)).toBeNull();
  });
  it("keeps where the server says she stands, and has none from a server that does not send it", () => {
    for (const run of ["new", "midway", "restarted", "done"] as const) expect(readPracticeSet({ ...set, run })?.run).toBe(run);
    expect(readPracticeSet(set)?.run).toBeNull();
    expect(readPracticeSet({ ...set, run: "finished" })?.run).toBeNull();
    expect(readPracticeSet({ ...set, run: null })?.run).toBeNull();
  });
});

describe("toggleStrike", () => {
  it("strikes a choice out, and the same gesture restores it", () => {
    const draft = { type: "single", choice: null } as const;
    const struck = toggleStrike(draft, [], 2);
    expect(struck).toEqual({ draft, struck: [2] });
    expect(toggleStrike(struck.draft, struck.struck, 2)).toEqual({ draft, struck: [] });
  });

  it("unpicks a choice she had picked when she strikes it, and leaves her other picks", () => {
    expect(toggleStrike({ type: "priority", choice: 1 }, [], 1).draft).toEqual({ type: "priority", choice: null });
    expect(toggleStrike({ type: "single", choice: 0 }, [], 1).draft).toEqual({ type: "single", choice: 0 });
    expect(toggleStrike({ type: "sata", picks: [0, 2, 3] }, [1], 2)).toEqual({ draft: { type: "sata", picks: [0, 3] }, struck: [1, 2] });
  });

  it("restores a choice without picking it again", () => {
    expect(toggleStrike({ type: "sata", picks: [0] }, [2], 2)).toEqual({ draft: { type: "sata", picks: [0] }, struck: [] });
  });

  it("letters choices in the order she sees them", () => {
    expect([0, 1, 2, 3].map(choiceLetter)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("readLayout", () => {
  it("keeps a saved shuffle that fits the question", () => {
    const layout = makeLayout(cloze);
    expect(readLayout(cloze, JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    const choices = makeLayout(match);
    expect(readLayout(match, choices)).toEqual(choices);
  });

  it("falls back to the question's own order when the saved shuffle does not fit", () => {
    expect(readLayout(sata, null)).toEqual({ kind: "options", order: [0, 1, 2, 3] });
    expect(readLayout(sata, { kind: "options", order: [0, 0, 1, 2] })).toEqual({ kind: "options", order: [0, 1, 2, 3] });
    expect(readLayout(order, { start: [2, 1] })).toEqual({ kind: "order", start: [0, 1, 2] });
    expect(readLayout(match, { choices: ["Loop diuretic"] })).toEqual({ kind: "match", choices: ["Loop diuretic", "Beta blocker", "Anticoagulant"] });
  });
});

describe("draftFromResponse", () => {
  it("shows a saved answer in the answer area", () => {
    expect(draftFromResponse(sata, { type: "sata", picks: [0, 2] })).toEqual({ type: "sata", picks: [0, 2] });
    expect(draftFromResponse(order, { type: "order", positions: [2, 0, 1] })).toEqual({ type: "order", positions: [2, 0, 1] });
    expect(draftFromResponse(cloze, { type: "cloze", choices: [1, null] })).toEqual({ type: "cloze", choices: [1, null] });
    expect(draftFromResponse(matrixMulti, { type: "matrixmulti", choices: [["Asthma"], []] })).toEqual({
      type: "matrixmulti",
      choices: [["Asthma"], []],
    });
  });

  it("refuses an answer of another format or shape", () => {
    expect(draftFromResponse(sata, { type: "single", choice: 0 })).toBeNull();
    expect(draftFromResponse(matrixMulti, { type: "matrix", choices: ["Asthma", null] })).toBeNull();
    expect(draftFromResponse(matrixMulti, { type: "matrixmulti", choices: [["Asthma"]] })).toBeNull();
    expect(draftFromResponse(matrixMulti, { type: "matrixmulti", choices: ["Asthma", "Heart failure"] })).toBeNull();
    expect(draftFromResponse(order, { type: "order", positions: [0, 0, 1] })).toBeNull();
    expect(draftFromResponse(match, { type: "match", choices: [1, 2] })).toBeNull();
    expect(draftFromResponse(sata, null)).toBeNull();
  });
});
