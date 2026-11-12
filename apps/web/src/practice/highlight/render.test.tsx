import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerArea } from "../Answers";
import { StemExhibits } from "../Exhibits";
import { initialDraft, makeLayout, type LoadedQuestion, type Question } from "../model";
import type { Marks } from "./marks";
import { Markable, MarkingProvider } from "./Markable";
import { QuestionMeta } from "./QuestionMeta";

function loaded(question: Question): LoadedQuestion {
  return {
    id: "q1",
    publicId: "q1",
    position: 0,
    topic: "Sepsis",
    cj: null,
    stem: "The urine is cloudy.",
    ask: "Which finding needs follow-up?",
    rationale: "Rationale",
    takeaway: "Takeaway",
    terms: [],
    table: { caption: "Vital signs", head: ["Time", "BP"], rows: [["4 PM", "86/48"]] },
    images: [],
    question,
  };
}

const single: Question = { type: "single", options: [{ t: "Blood pressure 86/48 mm Hg", ok: true }, { t: "Urine output 90 mL" }] };

function answers(marks: Marks, { struck = [] as number[], revealed = false } = {}): string {
  const question = loaded(single);
  const layout = makeLayout(question.question);
  return renderToStaticMarkup(
    <MarkingProvider marks={marks} onChange={() => undefined}>
      <AnswerArea
        loaded={question}
        layout={layout}
        draft={initialDraft(question.question, layout)}
        struck={struck}
        revealed={revealed}
        onDraft={() => undefined}
        onStrike={revealed ? undefined : () => undefined}
      />
    </MarkingProvider>,
  );
}

const OPTION_MARK: Marks = { "option:0": [{ start: 15, end: 20, color: "blue" }] };

describe("marked text", () => {
  it("draws a mark around the marked words only, in its color", () => {
    const html = renderToStaticMarkup(
      <MarkingProvider marks={{ stem: [{ start: 13, end: 19, color: "pink" }] }} onChange={() => undefined}>
        <Markable piece="stem" text="The urine is cloudy." />
      </MarkingProvider>,
    );
    expect(html).toMatch(/<mark class="hl hl-pink"[^>]*>(<span[^>]*>cloudy<\/span>)<\/mark>/);
    expect(html.match(/<mark /g)).toHaveLength(1);
  });

  it("is plain text where nothing can be marked, such as results", () => {
    expect(renderToStaticMarkup(<Markable piece="stem" text="The urine is cloudy." />)).toBe("The urine is cloudy.");
  });

  it("marks answer text, and the mark stays on a struck choice and after the answer is checked", () => {
    for (const html of [answers(OPTION_MARK), answers(OPTION_MARK, { struck: [0] }), answers(OPTION_MARK, { revealed: true })]) {
      expect(html).toMatch(/<mark class="hl hl-blue"[^>]*><span[^>]*>86<\/span><span[^>]*>\/<\/span><span[^>]*>48<\/span><\/mark>/);
    }
    expect(answers(OPTION_MARK, { struck: [0] })).toContain("choice-row-struck");
  });

  it("marks the exhibit table's caption and cells", () => {
    const html = renderToStaticMarkup(
      <MarkingProvider marks={{ caption: [{ start: 0, end: 5, color: "yellow" }], "cell:0:1": [{ start: 0, end: 5, color: "blue" }] }} onChange={() => undefined}>
        <StemExhibits loaded={loaded(single)} />
      </MarkingProvider>,
    );
    expect(html).toContain('data-piece="caption"');
    expect(html).toContain('data-piece="head:1"');
    expect(html).toContain('data-piece="cell:0:0"');
    expect(html).toMatch(/<mark class="hl hl-yellow"[^>]*><span[^>]*>Vital<\/span><\/mark>/);
    expect(html).toMatch(/<td><span class="markable" data-piece="cell:0:1"><mark class="hl hl-blue"/);
  });

  it("leaves the passage of a Highlight question alone, since tapping its phrases is the answer", () => {
    const question = loaded({ type: "highlight", segments: [{ t: "Cloudy urine", ok: true }, { t: "Clear urine" }, { t: "Dark urine", ok: true }] });
    const layout = makeLayout(question.question);
    const html = renderToStaticMarkup(
      <MarkingProvider marks={{}} onChange={() => undefined}>
        <AnswerArea loaded={question} layout={layout} draft={initialDraft(question.question, layout)} revealed={false} onDraft={() => undefined} />
      </MarkingProvider>,
    );
    expect(html).toContain("Cloudy urine");
    expect(html).not.toContain("markable");
  });
});

describe("the format line", () => {
  it("puts the pen at the end of the format line, showing the current color", () => {
    const html = renderToStaticMarkup(
      <MarkingProvider marks={{}} onChange={() => undefined}>
        <QuestionMeta format="Single answer" topic="Sepsis" />
      </MarkingProvider>,
    );
    expect(html).toMatch(/<span class="runner-format">Single answer<\/span><span>Sepsis<\/span>/);
    expect(html).toContain('aria-label="Highlighter, yellow"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("pen hl-yellow");
  });
});
