import { createContext, useContext, type PointerEvent } from "react";
import type { LiveStroke, Marks, Segment, Tool } from "./marks";

/** The drag in progress: the piece of text it is on, the range it would work on, and with what. */
export interface LiveMark extends LiveStroke {
  piece: string;
}

/** What the text of one question needs to be marked: its marks, the pen, and the drag in progress. */
export interface Marking {
  marks: Marks;
  /** What a drag does now: paints in this color, or erases. */
  tool: Tool;
  live: LiveMark | null;
  setTool: (tool: Tool) => void;
  clear: () => void;
  /** A press on a piece of text: the start of a drag or a swipe, or a tap on a mark. */
  press: (event: PointerEvent<HTMLElement>, piece: string, segments: readonly Segment[]) => void;
  /** A touchmove on a piece of text, heard by a listener that can hold the page still under a drag. */
  holdTouch: (event: TouchEvent) => void;
}

export const MarkingContext = createContext<Marking | null>(null);

/** The question's marking, or null where text cannot be marked (results, the owner's tools). */
export function useMarking(): Marking | null {
  return useContext(MarkingContext);
}
