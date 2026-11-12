import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { followPress } from "./gesture";
import { MarkingContext, useMarking, type LiveMark, type Marking } from "./marking-context";
import { eraseAt, HIGHLIGHT_COLORS, markAt, paint, segmentText, setPiece, textRuns, type HighlightColor, type Mark, type Marks, type Segment } from "./marks";
import { readHighlighterUsed, readPenColor, saveHighlighterUsed, savePenColor } from "./pen-store";

const NO_MARKS: readonly Mark[] = [];

/**
 * Lets the user highlight the question inside it: every Markable below draws its marks and takes
 * the gesture. `onChange` gets the question's marks after each change; the screen keeps them with
 * the attempt. Keys 1, 2 and 3 switch the pen's color while the question is on screen.
 */
export function MarkingProvider({ marks, onChange, children }: { marks: Marks; onChange: (marks: Marks) => void; children: ReactNode }) {
  const [color, setColorState] = useState<HighlightColor>(readPenColor);
  const [used, setUsed] = useState(readHighlighterUsed);
  const [live, setLive] = useState<LiveMark | null>(null);
  const latest = useRef({ marks, onChange, color });
  useLayoutEffect(() => {
    latest.current = { marks, onChange, color };
  });
  const abandon = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      abandon.current?.();
    },
    [],
  );

  const setColor = useCallback((next: HighlightColor) => {
    setColorState(next);
    savePenColor(next);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || typing(event.target)) return;
      const next = HIGHLIGHT_COLORS[Number(event.key) - 1];
      if (next && /^[123]$/.test(event.key)) setColor(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [setColor]);

  const press = useCallback<Marking["press"]>((event, piece, segments) => {
    if (abandon.current) return;
    const root = event.currentTarget;
    const change = (edit: (marks: readonly Mark[]) => readonly Mark[]) => {
      const { marks: all, onChange: report } = latest.current;
      const before = all[piece] ?? NO_MARKS;
      const after = edit(before);
      if (after !== before) report(setPiece(all, piece, after));
    };
    abandon.current = followPress(event.nativeEvent, root, segments, {
      live: (range) => {
        if (range === null) abandon.current = null;
        setLive(range ? { piece, mark: { ...range, color: latest.current.color } } : null);
      },
      commit: (range) => {
        change((marks) => paint(marks, range.start, range.end, latest.current.color));
        setUsed(true);
        saveHighlighterUsed();
      },
      tap: (offset) => {
        const marks = latest.current.marks[piece] ?? NO_MARKS;
        if (!markAt(marks, offset)) return false;
        change((current) => eraseAt(current, offset));
        return true;
      },
    });
  }, []);

  const clear = useCallback(() => {
    latest.current.onChange({});
  }, []);

  const value = useMemo<Marking>(() => ({ marks, color, live, used, setColor, clear, press }), [marks, color, live, used, setColor, clear, press]);
  return <MarkingContext value={value}>{children}</MarkingContext>;
}

/**
 * One piece of question text the user can highlight. `piece` names it among the question's pieces
 * (stem, ask, caption, head:1, cell:0:2, option:3, ...). Outside a MarkingProvider it is plain text.
 */
export function Markable({ piece, text }: { piece: string; text: string }) {
  const marking = useMarking();
  if (!marking) return text;
  return <MarkableText marking={marking} piece={piece} text={text} />;
}

function MarkableText({ marking, piece, text }: { marking: Marking; piece: string; text: string }) {
  const segments = useMemo(() => segmentText(text), [text]);
  const live = marking.live?.piece === piece ? marking.live.mark : null;
  const runs = textRuns(text, marking.marks[piece] ?? NO_MARKS, live);
  return (
    <span
      className="markable"
      data-piece={piece}
      onPointerDown={(event) => {
        marking.press(event, piece, segments);
      }}
    >
      {runs.map((run) => {
        const words = spans(text, segments, run.start, run.end);
        if (run.color === null) return words;
        return (
          <mark key={run.start} className={`hl hl-${run.color}${run.live ? " hl-live" : ""}`}>
            {words}
          </mark>
        );
      })}
    </span>
  );
}

/** The segments between `start` and `end`, each in a span that tells the gesture which one it is. */
function spans(text: string, segments: readonly Segment[], start: number, end: number): ReactNode[] {
  const out: ReactNode[] = [];
  segments.forEach((segment, index) => {
    const from = Math.max(segment.start, start);
    const to = Math.min(segment.end, end);
    if (to <= from) return;
    out.push(
      <span key={from} data-i={index}>
        {text.slice(from, to)}
      </span>,
    );
  });
  return out;
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
