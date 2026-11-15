import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { followPress, type Press } from "./gesture";
import { MarkingContext, useMarking, type LiveMark, type Marking } from "./marking-context";
import { eraseAt, HIGHLIGHT_COLORS, liveClass, markAt, segmentText, setPiece, stroke, strokeRange, textRuns, type LiveStroke, type Mark, type Marks, type Run, type Segment, type Tool } from "./marks";
import { readPenTool, savePenTool } from "./pen-store";

const NO_MARKS: readonly Mark[] = [];

/**
 * Lets the user highlight the question inside it: every Markable below draws its marks and takes
 * the gesture. `onChange` gets the question's marks after each change; the screen keeps them with
 * the attempt. Keys 1, 2 and 3 switch the pen to a color while the question is on screen.
 */
export function MarkingProvider({ marks, onChange, children }: { marks: Marks; onChange: (marks: Marks) => void; children: ReactNode }) {
  const [tool, setToolState] = useState<Tool>(readPenTool);
  const [live, setLive] = useState<LiveMark | null>(null);
  const latest = useRef({ marks, onChange, tool });
  useLayoutEffect(() => {
    latest.current = { marks, onChange, tool };
  });
  const pressed = useRef<Press | null>(null);
  useEffect(
    () => () => {
      pressed.current?.abandon();
    },
    [],
  );

  const setTool = useCallback((next: Tool) => {
    setToolState(next);
    savePenTool(next);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || typing(event.target)) return;
      const next = HIGHLIGHT_COLORS[Number(event.key) - 1];
      if (next && /^[123]$/.test(event.key)) setTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [setTool]);

  const press = useCallback<Marking["press"]>((event, piece, segments) => {
    if (pressed.current) return;
    const change = (edit: (marks: readonly Mark[]) => readonly Mark[]) => {
      const { marks: all, onChange: report } = latest.current;
      const before = all[piece] ?? NO_MARKS;
      const after = edit(before);
      if (after !== before) report(setPiece(all, piece, after));
    };
    pressed.current = followPress(event.nativeEvent, event.currentTarget, {
      live: (from, to) => {
        const { tool: now } = latest.current;
        const range = strokeRange(segments, from, to, now);
        setLive(range ? { piece, ...range, tool: now } : null);
      },
      end: () => {
        pressed.current = null;
        setLive(null);
      },
      commit: (from, to) => {
        change((marks) => stroke(marks, segments, from, to, latest.current.tool));
      },
      tap: (index) => {
        const offset = segments[index]?.start;
        if (offset === undefined || !markAt(latest.current.marks[piece] ?? NO_MARKS, offset)) return false;
        change((marks) => eraseAt(marks, offset));
        return true;
      },
    });
  }, []);

  const holdTouch = useCallback((event: TouchEvent) => {
    pressed.current?.holdTouch(event);
  }, []);

  const clear = useCallback(() => {
    latest.current.onChange({});
  }, []);

  const value = useMemo<Marking>(() => ({ marks, tool, live, setTool, clear, press, holdTouch }), [marks, tool, live, setTool, clear, press, holdTouch]);
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
  const live = marking.live?.piece === piece ? marking.live : null;
  const root = useRef<HTMLSpanElement>(null);
  const { holdTouch } = marking;
  // React listens to touchmove passively, and a passive listener cannot hold the page still.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    element.addEventListener("touchmove", holdTouch, { passive: false });
    return () => {
      element.removeEventListener("touchmove", holdTouch);
    };
  }, [holdTouch]);
  return (
    <span
      ref={root}
      className="markable"
      data-piece={piece}
      onPointerDown={(event) => {
        marking.press(event, piece, segments);
      }}
    >
      {textRuns(text, marking.marks[piece] ?? NO_MARKS).map((run) => {
        const words = spans(text, segments, run, live);
        if (run.color === null) return words;
        return (
          <mark key={run.start} className={`hl hl-${run.color}`}>
            {words}
          </mark>
        );
      })}
    </span>
  );
}

/**
 * The segments of `run`, each in a span that tells the gesture which one it is. The drag in
 * progress shows on these spans and adds no element, so the one the pointer went down on stays
 * where it is until the pointer lifts.
 */
function spans(text: string, segments: readonly Segment[], run: Run, live: LiveStroke | null): ReactNode[] {
  const out: ReactNode[] = [];
  segments.forEach((segment, index) => {
    const start = Math.max(segment.start, run.start);
    const end = Math.min(segment.end, run.end);
    if (end <= start) return;
    out.push(
      <span key={start} data-i={index} className={liveClass({ start, end }, run, live) || undefined}>
        {text.slice(start, end)}
      </span>,
    );
  });
  return out;
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
