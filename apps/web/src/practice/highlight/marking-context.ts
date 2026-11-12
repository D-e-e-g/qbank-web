import { createContext, useContext, type PointerEvent } from "react";
import type { HighlightColor, Mark, Marks, Segment } from "./marks";

/** The drag in progress: the piece it is on and the range it would mark, in the pen's color. */
export interface LiveMark {
  piece: string;
  mark: Mark;
}

/** What the text of one question needs to be marked: its marks, the pen, and the drag in progress. */
export interface Marking {
  marks: Marks;
  color: HighlightColor;
  live: LiveMark | null;
  /** The user has highlighted on this device before, so the hint is no longer shown. */
  used: boolean;
  setColor: (color: HighlightColor) => void;
  clear: () => void;
  /** A press on a piece of text: the start of a drag, a touch and hold, or a tap on a mark. */
  press: (event: PointerEvent<HTMLElement>, piece: string, segments: readonly Segment[]) => void;
}

export const MarkingContext = createContext<Marking | null>(null);

/** The question's marking, or null where text cannot be marked (results, the owner's tools). */
export function useMarking(): Marking | null {
  return useContext(MarkingContext);
}
