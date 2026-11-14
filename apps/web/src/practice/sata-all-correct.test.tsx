import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerArea } from "./Answers";
import { initialDraft, readPracticeSet, togglePick, toResponse, type Draft, type Layout, type LoadedQuestion, type LoadedSet } from "./model";
import type { Feedback } from "./recordPracticeAnswer";
import { FeedbackBanner } from "./PracticeScreen";

const RULE = "+1 for each correct choice, -1 for each wrong one";

const options = [
  { t: "Sit her up", ok: true as const, why: "Eases breathing." },
  { t: "Check her oxygen", ok: true as const, why: "Low oxygen needs oxygen." },
  { t: "Raise the head of the bed", ok: true as const, why: "Upright eases the work of breathing." },
];

/** Display order is not storage order, so picking every row still means every stored option. */
const layout: Layout = { kind: "options", order: [2, 0, 1] };

function allCorrectSet(): LoadedSet {
  const set = readPracticeSet({
    id: "set",
    courseId: "course",
    title: "Week 1",
    weekLabel: "Week 1",
    sitting: null,
    questions: [
      {
        id: "q-all",
        publicId: "Q1",
        position: 0,
        type: "sata",
        topic: "Breathing",
        cj: "Take action",
        stem: "A client is short of breath.",
        ask: "Which actions help?",
        rationale: "Each of these helps.",
        takeaway: "All three help.",
        table: null,
        images: [],
        terms: [],
        body: { options },
      },
    ],
  });
  if (!set) throw new Error("all-correct select-all did not read");
  return set;
}

function question(set: LoadedSet): LoadedQuestion {
  const loaded = set.questions[0];
  if (loaded?.question.type !== "sata") throw new Error("expected one select-all question");
  return loaded;
}

/** What the answer area does on each click: toggle that stored option. */
function pick(draft: Draft, index: number): Draft {
  if (draft.type !== "sata") throw new Error("expected a select-all draft");
  return { type: "sata", picks: togglePick(draft.picks, index) };
}

function pickEvery(loaded: LoadedQuestion): Draft {
  if (layout.kind !== "options") throw new Error("expected an option layout");
  let draft = initialDraft(loaded.question, layout);
  for (const index of layout.order) draft = pick(draft, index);
  return draft;
}

function score(status: Feedback["status"], points: number, label: string): Feedback {
  return { status, points, maxPoints: options.length, label, pointsText: `${String(points)} of ${String(options.length)} points`, ruleText: RULE };
}

function shown(set: LoadedSet, draft: Draft, feedback: Feedback | null): string {
  const loaded = question(set);
  return renderToStaticMarkup(
    <>
      {feedback ? <FeedbackBanner score={feedback} guessed={false} /> : null}
      <AnswerArea loaded={loaded} layout={layout} draft={draft} struck={[]} revealed={feedback !== null} onDraft={() => undefined} />
    </>,
  );
}

function count(html: string, token: string): number {
  return html.split(token).length - 1;
}

describe("a select-all question where every option is correct", () => {
  it("reads every option as correct, renders them, and accepts picking each one", () => {
    const set = allCorrectSet();
    const loaded = question(set);
    expect(loaded.question).toEqual({ type: "sata", options });

    const draft = pickEvery(loaded);
    expect(toResponse(draft)).toEqual({ type: "sata", picks: [2, 0, 1] });
    expect(toResponse({ type: "sata", picks: [] })).toBeNull();

    const html = shown(set, draft, null);
    for (const option of options) expect(html).toContain(option.t);
    expect(count(html, 'aria-checked="true"')).toBe(3);
    expect(html).not.toContain("Missed");
    expect(html).not.toContain("Not correct");
    expect(html).not.toContain("choice-wrong");
  });

  it("shows full credit when every option is picked", () => {
    const set = allCorrectSet();
    const html = shown(set, pickEvery(question(set)), score("correct", 3, "Correct"));
    expect(html).toContain('class="feedback feedback-correct"');
    expect(html).toContain("Correct");
    expect(html).toContain("3 of 3 points");
    expect(html).toContain(RULE);
    expect(count(html, "Your answer - Correct")).toBe(3);
    expect(count(html, "choice-correct")).toBe(3);
    expect(html).not.toContain("Missed");
    expect(html).not.toContain("Partly correct");
    expect(html).not.toContain("Not correct");
    expect(html).not.toContain("choice-wrong");
    expect(html).not.toContain("choice-missed");
  });

  it("shows partly correct when only some options are picked, with no wrong option to mark", () => {
    const set = allCorrectSet();
    const loaded = question(set);
    const draft = pick(initialDraft(loaded.question, layout), 2);
    expect(toResponse(draft)).toEqual({ type: "sata", picks: [2] });

    const html = shown(set, draft, score("partial", 1, "Partly correct"));
    expect(html).toContain('class="feedback feedback-partial"');
    expect(html).toContain("Partly correct");
    expect(html).toContain("1 of 3 points");
    expect(html).toContain(RULE);
    expect(count(html, "Your answer - Correct")).toBe(1);
    expect(count(html, ">Missed<")).toBe(2);
    expect(count(html, "choice-missed")).toBe(2);
    expect(html).not.toContain("Not correct");
    expect(html).not.toContain("choice-wrong");
  });

  it("shows not correct when nothing is picked, and every option was missed", () => {
    const set = allCorrectSet();
    const loaded = question(set);
    const html = shown(set, initialDraft(loaded.question, layout), score("incorrect", 0, "Not correct"));
    expect(html).toContain('class="feedback feedback-incorrect"');
    expect(html).toContain("Not correct");
    expect(html).toContain("0 of 3 points");
    expect(html).toContain(RULE);
    expect(count(html, ">Missed<")).toBe(3);
    expect(html).not.toContain("Your answer");
    expect(html).not.toContain("choice-wrong");
    expect(html).not.toContain("Partly correct");
  });
});
