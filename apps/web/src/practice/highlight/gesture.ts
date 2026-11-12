// The highlighter's one gesture, Press and drag. With a mouse: press, drag across words, let go.
// On a touch screen: touch and hold a word first, then drag and lift, so a quick swipe still
// scrolls. A plain tap or click is left alone (it still picks an answer), except on a mark,
// where it erases that mark. Words are found under the pointer by the segment spans Markable
// draws, so this works inside answer buttons, where the browser selects no text.

import { snapRange, type Segment } from "./marks";

/** How long a finger rests on a word before the drag marks instead of scrolling. */
export const HOLD_MS = 450;
const TOUCH_SLOP = 10;
const MOUSE_SLOP = 4;
const CLICK_SLOP = 12;

export interface Range {
  start: number;
  end: number;
}

export interface PressHandlers {
  /** The range the drag would mark now, or null once it ends. */
  live: (range: Range | null) => void;
  /** The drag ended on this range. */
  commit: (range: Range) => void;
  /** A tap at this offset. True when it erased a mark, so the tap picks nothing. */
  tap: (offset: number) => boolean;
}

/**
 * Follows one press on `root`, a piece of markable text, until the pointer lifts. Returns a
 * function that abandons it, or null when the press was not on a word of `root`.
 */
export function followPress(event: PointerEvent, root: HTMLElement, segments: readonly Segment[], handlers: PressHandlers): (() => void) | null {
  const touch = event.pointerType === "touch";
  if (!touch && event.button !== 0) return null;
  const anchor = segmentIndex(event.target, root);
  if (anchor === null) return null;
  const pointerId = event.pointerId;
  const x0 = event.clientX;
  const y0 = event.clientY;
  let current = anchor;
  let dragging = false;
  let held = false;

  const show = () => {
    handlers.live(snapRange(segments, anchor, current));
  };
  const timer = touch
    ? window.setTimeout(() => {
        held = true;
        dragging = true;
        show();
      }, HOLD_MS)
    : null;

  const move = (moved: PointerEvent) => {
    if (moved.pointerId !== pointerId) return;
    if (!dragging) {
      const far = Math.hypot(moved.clientX - x0, moved.clientY - y0);
      if (touch) {
        // Moving before the hold is a scroll.
        if (far > TOUCH_SLOP) finish();
        return;
      }
      if (far < MOUSE_SLOP) return;
      dragging = true;
    }
    const at = pointIndex(moved.clientX, moved.clientY, root);
    if (at !== null) current = at;
    show();
  };

  const up = (lifted: PointerEvent) => {
    if (lifted.pointerId !== pointerId) return;
    const range = dragging ? snapRange(segments, anchor, current) : null;
    const wasDrag = dragging;
    finish();
    if (wasDrag) {
      if (range) handlers.commit(range);
      // The drag marked words; it does not also pick the answer they belong to.
      swallowClick(lifted, touch);
      return;
    }
    const segment = segments[anchor];
    if (segment && handlers.tap(segment.start)) swallowClick(lifted, touch);
  };

  const cancel = (cancelled: PointerEvent) => {
    if (cancelled.pointerId === pointerId) finish();
  };

  // Once the hold has begun, the finger drags the highlight, not the page.
  const holdPage = (moved: TouchEvent) => {
    if (held && moved.cancelable) moved.preventDefault();
  };

  // A long press opens the context menu on some phones, and on a choice the menu strikes it out.
  // Touch and hold belongs to highlighting; the X still strikes.
  const keepMenu = (opened: Event) => {
    if (!touch) return;
    opened.preventDefault();
    opened.stopPropagation();
  };

  function finish() {
    if (timer !== null) window.clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("touchmove", holdPage);
    window.removeEventListener("contextmenu", keepMenu, true);
    handlers.live(null);
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("touchmove", holdPage, { passive: false });
  window.addEventListener("contextmenu", keepMenu, true);
  return finish;
}

/** The segment a span of `root` draws, from its data-i. Null for anything else. */
function segmentIndex(target: EventTarget | null, root: HTMLElement): number | null {
  if (!(target instanceof Element)) return null;
  const span = target.closest("[data-i]");
  if (!span || !root.contains(span)) return null;
  const index = Number(span.getAttribute("data-i"));
  return Number.isInteger(index) ? index : null;
}

function pointIndex(x: number, y: number, root: HTMLElement): number | null {
  return segmentIndex(document.elementFromPoint(x, y), root);
}

/**
 * Drops the click the browser sends where the pointer lifted, and no other. A tap's click can
 * come a little later than a mouse's.
 */
function swallowClick(lifted: PointerEvent, touch: boolean): void {
  const swallow = (click: MouseEvent) => {
    if (Math.abs(click.clientX - lifted.clientX) > CLICK_SLOP || Math.abs(click.clientY - lifted.clientY) > CLICK_SLOP) return;
    click.preventDefault();
    click.stopPropagation();
    stop();
  };
  const timer = window.setTimeout(stop, touch ? 700 : 100);
  function stop() {
    window.clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
  }
  window.addEventListener("click", swallow, true);
}
