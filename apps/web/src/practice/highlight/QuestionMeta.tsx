import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { useMarking } from "./marking-context";
import { hasMarks, HIGHLIGHT_COLORS, type HighlightColor } from "./marks";

const COLOR_NAMES: Record<HighlightColor, string> = { yellow: "Yellow", blue: "Blue", pink: "Pink" };

/**
 * The line over the stem: the question's format, its topic, anything the screen adds, and at its
 * end the highlighter pen, which is how the user finds that highlighting is there.
 */
export function QuestionMeta({ format, topic, children }: { format: string; topic: string; children?: ReactNode }) {
  const marking = useMarking();
  return (
    <p className="runner-meta">
      <span className="runner-format">{format}</span>
      {topic ? <span>{topic}</span> : null}
      {children}
      {marking ? <HighlightPen /> : null}
    </p>
  );
}

/**
 * A button that shows the pen's color and opens the three colors beside it, with Clear when the
 * question has a mark. Picking a color closes it; so do a tap outside and Escape.
 */
function HighlightPen() {
  const marking = useMarking();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const pen = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && wrap.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      pen.current?.focus();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!marking) return null;
  const { color, setColor, clear } = marking;
  const marked = hasMarks(marking.marks);

  return (
    <span className="pen-wrap" ref={wrap}>
      {open ? (
        <span className="pen-menu" role="group" aria-label="Highlighter colors">
          {HIGHLIGHT_COLORS.map((choice, index) => (
            <button
              key={choice}
              type="button"
              className={`pen-dot hl-${choice}${choice === color ? " pen-dot-current" : ""}`}
              aria-label={COLOR_NAMES[choice]}
              aria-pressed={choice === color}
              aria-keyshortcuts={String(index + 1)}
              onClick={() => {
                setColor(choice);
                setOpen(false);
              }}
            >
              <span className="pen-dot-key" aria-hidden="true">
                {index + 1}
              </span>
            </button>
          ))}
          {marked ? (
            <button
              type="button"
              className="pen-clear"
              aria-label="Clear highlights"
              onClick={() => {
                clear();
                setOpen(false);
                pen.current?.focus();
              }}
            >
              Clear
            </button>
          ) : null}
        </span>
      ) : null}
      <button
        ref={pen}
        type="button"
        className={`pen hl-${color}`}
        aria-label={`Highlighter, ${color}`}
        aria-expanded={open}
        title="Highlighter"
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <Icon name="highlighter" size={18} />
      </button>
    </span>
  );
}
