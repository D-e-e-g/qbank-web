import type { CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { Markable } from "./highlight/Markable";
import {
  choiceLetter,
  clozeParts,
  FORMAT_LABELS,
  moveOrder,
  toggleMatrixColumn,
  togglePick,
  type Draft,
  type HighlightSegment,
  type Layout,
  type LoadedQuestion,
  type QuestionOption,
} from "./model";

/**
 * The answer in the question's format. With onStrike, each choice of a choice-list question gets a
 * control to strike it out; struck choices are drawn crossed out and cannot be picked.
 */
export function AnswerArea({
  loaded,
  layout,
  draft,
  struck = [],
  revealed,
  onDraft,
  onStrike,
}: {
  loaded: LoadedQuestion;
  layout: Layout;
  draft: Draft;
  struck?: readonly number[];
  revealed: boolean;
  onDraft: (draft: Draft) => void;
  onStrike?: ((index: number) => void) | undefined;
}) {
  const question = loaded.question;
  switch (question.type) {
    case "single":
    case "priority":
    case "sata":
      if (layout.kind !== "options") return null;
      if (draft.type !== question.type) return null;
      return (
        <OptionList
          label={FORMAT_LABELS[question.type]}
          multi={question.type === "sata"}
          options={question.options}
          order={layout.order}
          picked={draft.type === "sata" ? draft.picks : draft.choice === null ? [] : [draft.choice]}
          struck={revealed ? [] : struck}
          revealed={revealed}
          onStrike={revealed ? undefined : onStrike}
          onPick={(index) => {
            if (struck.includes(index)) return;
            if (question.type === "sata" && draft.type === "sata") {
              onDraft({ type: "sata", picks: togglePick(draft.picks, index) });
              return;
            }
            if (question.type === "single") onDraft({ type: "single", choice: index });
            if (question.type === "priority") onDraft({ type: "priority", choice: index });
          }}
        />
      );
    case "highlight":
      if (draft.type !== "highlight") return null;
      return (
        <HighlightList
          segments={question.segments}
          picks={draft.picks}
          revealed={revealed}
          onToggle={(index) => {
            onDraft({ type: "highlight", picks: togglePick(draft.picks, index) });
          }}
        />
      );
    case "order":
      if (draft.type !== "order") return null;
      return (
        <OrderList
          items={question.items}
          positions={draft.positions}
          revealed={revealed}
          onMove={(index, direction) => {
            onDraft({ type: "order", positions: moveOrder(draft.positions, index, direction) });
          }}
        />
      );
    case "match":
      if (layout.kind !== "match" || draft.type !== "match") return null;
      return (
        <MatchList
          pairs={question.pairs}
          choices={layout.choices}
          selected={draft.choices}
          revealed={revealed}
          onSelect={(row, value) => {
            onDraft({
              type: "match",
              choices: draft.choices.map((choice, index) => (index === row ? value : choice)),
            });
          }}
        />
      );
    case "matrix":
      if (draft.type !== "matrix") return null;
      return (
        <MatrixList
          columns={question.columns}
          rows={question.rows}
          selected={draft.choices}
          revealed={revealed}
          onSelect={(row, value) => {
            onDraft({
              type: "matrix",
              choices: draft.choices.map((choice, index) => (index === row ? value : choice)),
            });
          }}
        />
      );
    case "matrixmulti":
      if (draft.type !== "matrixmulti") return null;
      return (
        <MatrixMultiList
          rowIdPrefix={loaded.id}
          columns={question.columns}
          rows={question.rows}
          selected={draft.choices}
          revealed={revealed}
          onToggle={(row, column) => {
            onDraft({
              type: "matrixmulti",
              choices: draft.choices.map((picked, index) => (index === row ? toggleMatrixColumn(question.columns, picked, column) : picked)),
            });
          }}
        />
      );
    case "cloze":
      if (layout.kind !== "cloze" || draft.type !== "cloze") return null;
      return (
        <ClozePassage
          text={question.cloze.text}
          blanks={question.cloze.blanks}
          orders={layout.blanks}
          selected={draft.choices}
          revealed={revealed}
          onSelect={(blank, value) => {
            onDraft({
              type: "cloze",
              choices: draft.choices.map((choice, index) => (index === blank ? value : choice)),
            });
          }}
        />
      );
  }
}

function OptionList({
  label,
  multi,
  options,
  order,
  picked,
  struck,
  revealed,
  onPick,
  onStrike,
}: {
  label: string;
  multi: boolean;
  options: readonly QuestionOption[];
  order: readonly number[];
  picked: readonly number[];
  struck: readonly number[];
  revealed: boolean;
  onPick: (index: number) => void;
  onStrike: ((index: number) => void) | undefined;
}) {
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label={label} className="choice-list">
      {order.map((original, position) => {
        const option = options[original];
        if (!option) return null;
        const selected = picked.includes(original);
        const correct = option.ok === true;
        const out = struck.includes(original);
        const letter = choiceLetter(position);
        const strikeLabel = `${out ? "Restore" : "Strike out"} ${letter}`;
        return (
          <div key={original} className={out ? "choice-row choice-row-struck" : "choice-row"}>
            <button
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={selected}
              aria-disabled={out || undefined}
              className={[choiceClass(revealed, selected, correct), onStrike ? "choice-strikeable" : ""].filter(Boolean).join(" ")}
              onClick={() => {
                if (!revealed && !out) onPick(original);
              }}
              onContextMenu={
                onStrike
                  ? (event) => {
                      event.preventDefault();
                      onStrike(original);
                    }
                  : undefined
              }
            >
              <ChoiceLetter letter={letter} badge={revealed && selected ? (correct ? "check" : "x") : null} />
              <span className="choice-body">
                <span className="choice-text">
                  <Markable piece={`option:${String(original)}`} text={option.t} />
                </span>
                {revealed ? <ChoiceMark selected={selected} correct={correct} /> : null}
                {revealed && option.why ? <span className="choice-reason">{option.why}</span> : null}
              </span>
            </button>
            {onStrike ? (
              <button
                type="button"
                className="choice-strike"
                aria-label={strikeLabel}
                title={strikeLabel}
                onClick={() => {
                  onStrike(original);
                }}
              >
                <Icon name={out ? "rotate-ccw" : "x"} size={18} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function HighlightList({
  segments,
  picks,
  revealed,
  onToggle,
}: {
  segments: readonly HighlightSegment[];
  picks: readonly number[];
  revealed: boolean;
  onToggle: (index: number) => void;
}) {
  return (
    <div className="passage">
      {segments.map((segment, index) => {
        const selected = picks.includes(index);
        const correct = segment.ok === true;
        const state = revealed ? segmentClass(selected, correct) : selected ? "passage-segment-selected" : "";
        return (
          <button
            key={index}
            type="button"
            className={["passage-segment", state].filter(Boolean).join(" ")}
            aria-pressed={selected}
            onClick={() => {
              if (!revealed) onToggle(index);
            }}
          >
            {segment.t}
            {revealed && markText(selected, correct) !== "Not selected" ? (
              <span className="sr-only">{markText(selected, correct)}</span>
            ) : null}
          </button>
        );
      })}
      {revealed ? (
        <ul className="segment-notes">
          {segments.map((segment, index) => {
            const selected = picks.includes(index);
            const correct = segment.ok === true;
            return (
              <li key={index} className={`segment-note segment-note-${revealState(selected, correct)}`}>
                <span className="choice-text">{segment.t}</span>
                <ChoiceMark selected={selected} correct={correct} />
                {segment.why ? <span className="choice-reason">{segment.why}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function OrderList({
  items,
  positions,
  revealed,
  onMove,
}: {
  items: readonly { t: string; why?: string }[];
  positions: readonly number[];
  revealed: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  return (
    <ol className="order-list">
      {positions.map((original, index) => {
        const item = items[original];
        if (!item) return null;
        const right = original === index;
        const state = revealed ? (right ? "order-correct" : "order-wrong") : "";
        return (
          <li key={original} className={["order-row", state].filter(Boolean).join(" ")}>
            <span className="order-pos">{index + 1}</span>
            <span className="order-copy">
              <span className="order-text">
                <Markable piece={`order:${String(original)}`} text={item.t} />
              </span>
              {revealed ? (
                <span className="choice-tag">{right ? "Right position" : `Belongs in position ${String(original + 1)}`}</span>
              ) : null}
              {revealed && item.why ? <span className="choice-reason">{item.why}</span> : null}
            </span>
            {revealed ? null : (
              <>
                <button
                  type="button"
                  className="order-move"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => {
                    onMove(index, -1);
                  }}
                >
                  <Icon name="chevron-up" />
                </button>
                <button
                  type="button"
                  className="order-move"
                  aria-label="Move down"
                  disabled={index === positions.length - 1}
                  onClick={() => {
                    onMove(index, 1);
                  }}
                >
                  <Icon name="chevron-down" />
                </button>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MatchList({
  pairs,
  choices,
  selected,
  revealed,
  onSelect,
}: {
  pairs: readonly { l: string; r: string; why?: string }[];
  choices: readonly string[];
  selected: readonly (string | null)[];
  revealed: boolean;
  onSelect: (row: number, value: string | null) => void;
}) {
  return (
    <div className="choice-list">
      {pairs.map((pair, row) => {
        const value = selected[row] ?? null;
        const state = revealed ? (value === pair.r ? "correct" : "wrong") : null;
        return (
          <div key={row} className="answer-card">
            <span className="answer-card-label">
              <Markable piece={`match:${String(row)}`} text={pair.l} />
            </span>
            <Picker
              label={`Match for ${pair.l}`}
              placeholder="Choose a match"
              options={choices.map((choice) => ({ value: choice, text: choice }))}
              value={value}
              state={state}
              onChange={(next) => {
                onSelect(row, next);
              }}
            />
            {state === "wrong" ? <CorrectAnswer text={pair.r} label="Correct match" /> : null}
            {revealed && pair.why ? <span className="choice-reason">{pair.why}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function MatrixList({
  columns,
  rows,
  selected,
  revealed,
  onSelect,
}: {
  columns: readonly string[];
  rows: readonly { t: string; ans: string; why?: string }[];
  selected: readonly (string | null)[];
  revealed: boolean;
  onSelect: (row: number, value: string) => void;
}) {
  return (
    <div className="choice-list">
      {rows.map((row, rowIndex) => {
        const value = selected[rowIndex] ?? null;
        return (
          <div key={rowIndex} className="answer-card">
            <span className="answer-card-label" id={`matrix-row-${String(rowIndex)}`}>
              <Markable piece={`matrix:${String(rowIndex)}`} text={row.t} />
            </span>
            <div className="matrix-choices" role="radiogroup" aria-labelledby={`matrix-row-${String(rowIndex)}`}>
              {columns.map((column) => {
                const picked = value === column;
                const state = revealed ? revealState(picked, row.ans === column) : picked ? "selected" : "idle";
                return (
                  <button
                    key={column}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    aria-disabled={revealed}
                    className={`matrix-choice matrix-choice-${state}`}
                    onClick={() => {
                      if (!revealed) onSelect(rowIndex, column);
                    }}
                  >
                    <MatrixMark state={state} />
                    <span>{column}</span>
                    {revealed && state !== "dim" ? <span className="sr-only">{markText(picked, row.ans === column)}</span> : null}
                  </button>
                );
              })}
            </div>
            {revealed && row.why ? <span className="choice-reason">{row.why}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function MatrixMark({ state }: { state: "idle" | "selected" | "correct" | "wrong" | "missed" | "dim" }) {
  if (state === "correct" || state === "missed") return <Icon name="circle-check" />;
  if (state === "wrong") return <Icon name="circle-x" />;
  return <span className="matrix-radio" aria-hidden="true" />;
}

function MatrixMultiList({
  rowIdPrefix,
  columns,
  rows,
  selected,
  revealed,
  onToggle,
}: {
  rowIdPrefix: string;
  columns: readonly string[];
  rows: readonly { t: string; ans: readonly string[]; why?: string }[];
  selected: readonly (readonly string[])[];
  revealed: boolean;
  onToggle: (row: number, column: string) => void;
}) {
  return (
    <div className="matrix-multi" style={{ "--matrix-columns": String(columns.length) } as CSSProperties}>
      <div className="matrix-multi-head" aria-hidden="true">
        <span className="matrix-multi-corner" />
        {columns.map((column) => (
          <span key={column} className="matrix-multi-col">
            {column}
          </span>
        ))}
      </div>
      {rows.map((row, rowIndex) => {
        const picked = new Set(selected[rowIndex] ?? []);
        const right = new Set(row.ans);
        const rowId = `matrix-multi-${rowIdPrefix}-${String(rowIndex)}`;
        return (
          <div key={rowIndex} className="matrix-multi-row answer-card">
            <span className="answer-card-label" id={rowId}>
              <Markable piece={`matrix:${String(rowIndex)}`} text={row.t} />
            </span>
            <div className="matrix-choices" role="group" aria-labelledby={rowId}>
              {columns.map((column) => {
                const on = picked.has(column);
                const state = revealed ? revealState(on, right.has(column)) : on ? "selected" : "idle";
                return (
                  <button
                    key={column}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-disabled={revealed}
                    className={`matrix-choice matrix-choice-${state}`}
                    onClick={() => {
                      if (!revealed) onToggle(rowIndex, column);
                    }}
                  >
                    <MatrixCheckMark state={state} />
                    <span className="matrix-choice-label">{column}</span>
                    {revealed && state !== "dim" ? <span className="sr-only">{markText(on, right.has(column))}</span> : null}
                  </button>
                );
              })}
            </div>
            {revealed && row.why ? <span className="choice-reason matrix-multi-why">{row.why}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function MatrixCheckMark({ state }: { state: "idle" | "selected" | "correct" | "wrong" | "missed" | "dim" }) {
  if (state === "correct" || state === "missed") return <Icon name="circle-check" />;
  if (state === "wrong") return <Icon name="circle-x" />;
  return (
    <span className="matrix-box" aria-hidden="true">
      {state === "selected" ? <Icon name="check" /> : null}
    </span>
  );
}

function ClozePassage({
  text,
  blanks,
  orders,
  selected,
  revealed,
  onSelect,
}: {
  text: string;
  blanks: readonly { opts: readonly string[]; ans: number; why?: string }[];
  orders: readonly (readonly number[])[];
  selected: readonly (number | null)[];
  revealed: boolean;
  onSelect: (blank: number, value: number | null) => void;
}) {
  return (
    <div className="passage cloze">
      <p className="cloze-line">
        {clozeParts(text).map((part, index) => {
          if (typeof part === "string")
            return (
              <span key={index}>
                <Markable piece={`cloze:${String(index)}`} text={part} />
              </span>
            );
          const blank = blanks[part];
          const order = orders[part];
          if (!blank || !order) return null;
          const value = selected[part] ?? null;
          const state = revealed ? (value === blank.ans ? "correct" : "wrong") : null;
          return (
            <span key={index} className="cloze-blank">
              <Picker
                inline
                label={`Blank ${String(part + 1)}`}
                placeholder="Select"
                options={order.flatMap((original) => {
                  const opt = blank.opts[original];
                  return opt === undefined ? [] : [{ value: String(original), text: opt }];
                })}
                value={value === null ? null : String(value)}
                state={state}
                onChange={(next) => {
                  onSelect(part, next === null ? null : Number(next));
                }}
              />
              {state === "wrong" ? <CorrectAnswer text={blank.opts[blank.ans] ?? ""} label="Correct" /> : null}
            </span>
          );
        })}
      </p>
      {revealed && blanks.some((blank) => blank.why) ? (
        <ul className="segment-notes">
          {blanks.map((blank, index) => {
            if (!blank.why) return null;
            const right = selected[index] === blank.ans;
            return (
              <li key={index} className={`segment-note segment-note-${right ? "correct" : "wrong"}`}>
                <span className="choice-tag">{`Blank ${String(index + 1)} - ${right ? "Correct" : "Not correct"}`}</span>
                <span className="choice-reason">{blank.why}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** A native select, so iPhone shows its own wheel. State colors the border and swaps the chevron for a mark. */
function Picker({
  label,
  placeholder,
  options,
  value,
  state,
  inline = false,
  onChange,
}: {
  label: string;
  placeholder: string;
  options: readonly { value: string; text: string }[];
  value: string | null;
  state: "correct" | "wrong" | null;
  inline?: boolean;
  onChange: (value: string | null) => void;
}) {
  const tone = state ?? (value === null ? "empty" : "filled");
  return (
    <span className={inline ? `picker picker-inline picker-${tone}` : `picker picker-${tone}`}>
      <select
        className="picker-select"
        aria-label={label}
        value={value ?? ""}
        disabled={state !== null}
        onChange={(event) => {
          onChange(event.target.value === "" ? null : event.target.value);
        }}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option, index) => (
          <option key={`${option.value}-${String(index)}`} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
      <span className="picker-icon" aria-hidden="true">
        <Icon name={state === "correct" ? "circle-check" : state === "wrong" ? "circle-x" : "chevron-down"} />
      </span>
      {state ? <span className="sr-only">{state === "correct" ? "Correct" : "Not correct"}</span> : null}
    </span>
  );
}

/** A choice's letter, or once it is checked, a filled check or cross on the one she picked. */
function ChoiceLetter({ letter, badge }: { letter: string; badge: "check" | "x" | null }) {
  if (badge) {
    return (
      <span className="choice-letter choice-badge" aria-hidden="true">
        <Icon name={badge} size={14} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="choice-letter" aria-hidden="true">
      {letter}
    </span>
  );
}

function CorrectAnswer({ label, text }: { label: string; text: string }) {
  return (
    <span className="correct-answer">
      <span className="correct-answer-label">{label}:</span> {text}
    </span>
  );
}

function ChoiceMark({ selected, correct }: { selected: boolean; correct: boolean }) {
  const text = markText(selected, correct);
  if (text === "Not selected") return null;
  return <span className="choice-tag">{text}</span>;
}

function markText(selected: boolean, correct: boolean): string {
  if (selected && correct) return "Your answer - Correct";
  if (selected) return "Your answer - Not correct";
  if (correct) return "Missed";
  return "Not selected";
}

function choiceClass(revealed: boolean, selected: boolean, correct: boolean): string {
  if (!revealed) return selected ? "choice choice-selected" : "choice";
  if (selected && correct) return "choice choice-correct";
  if (selected) return "choice choice-wrong";
  if (correct) return "choice choice-missed";
  return "choice choice-dim";
}

function segmentClass(selected: boolean, correct: boolean): string {
  return `passage-segment-${revealState(selected, correct)}`;
}

function revealState(selected: boolean, correct: boolean): "correct" | "wrong" | "missed" | "dim" {
  if (selected && correct) return "correct";
  if (selected) return "wrong";
  if (correct) return "missed";
  return "dim";
}
