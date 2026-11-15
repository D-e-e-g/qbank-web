// The highlighter's one gesture, Press and drag, and how each kind of pointer begins it. A mouse
// or a pencil presses on a word and drags across words, in any direction. A finger swipes
// sideways across words, the way a line reads, and scrolls the question by swiping up or down,
// even over words. A plain tap or click is left alone (it still picks an answer), except on a
// mark, where it erases that mark. Words are found under the pointer by the segment spans
// Markable draws, so this works inside answer buttons, where the browser selects no text.

/** How far a finger moves before its swipe has a direction. Less than a browser waits before it scrolls. */
export const SWIPE_SLOP = 6;
/** A finger's swipe marks when it runs within this many degrees of level; a steeper one scrolls. */
export const SWIPE_ANGLE = 35;
const DRAG_SLOP = 4;
const CLICK_SLOP = 12;
const LEVEL = Math.tan((SWIPE_ANGLE * Math.PI) / 180);

/**
 * How a press begins a drag: "drag" as soon as it moves (a mouse's main button, a pencil),
 * "swipe" by its direction (a finger). Null for a press that never marks.
 */
export function pressBegins(pointerType: string, button: number): "drag" | "swipe" | null {
  if (pointerType === "touch") return "swipe";
  return button === 0 ? "drag" : null;
}

/**
 * What a finger that has moved this far from where it touched a word is doing: "mark" for a
 * swipe along the line, to either side; "scroll" for one up or down the page. Null while it has
 * not moved far enough to tell. The first answer holds for the rest of the gesture.
 */
export function swipeIntent(dx: number, dy: number): "mark" | "scroll" | null {
  if (Math.hypot(dx, dy) < SWIPE_SLOP) return null;
  return Math.abs(dy) <= Math.abs(dx) * LEVEL ? "mark" : "scroll";
}

export interface PressHandlers {
  /** The drag now runs from the segment it began on to this one. */
  live: (from: number, to: number) => void;
  /** The press is over: lifted, cancelled, or abandoned. */
  end: () => void;
  /** The drag ended, from the segment it began on to this one. */
  commit: (from: number, to: number) => void;
  /** A tap on this segment. True when it erased a mark, so the tap picks nothing. */
  tap: (segment: number) => boolean;
}

export interface Press {
  /** Ends the press without marking. */
  abandon: () => void;
  /**
   * Takes a touchmove of the press's finger or pencil. Once the drag marks, the page stays
   * still under it. The listener that passes it must not be passive, and must be in place
   * before the touch begins: iPhone Safari lets no later one hold the page.
   */
  holdTouch: (moved: TouchEvent) => void;
}

/**
 * Follows one press on `root`, a piece of markable text, until the pointer lifts. Null when the
 * press was not on a segment of `root`, or never marks. The segment under the pointer must stay
 * in the page, where it is, for as long as the press lasts: a finger's events go to the element
 * it first touched, wherever that element is by then.
 */
export function followPress(event: PointerEvent, root: HTMLElement, handlers: PressHandlers): Press | null {
  const begins = pressBegins(event.pointerType, event.button);
  const anchor = segmentIndex(event.target, root);
  if (begins === null || anchor === null) return null;
  const touch = begins === "swipe";
  const pointerId = event.pointerId;
  const x0 = event.clientX;
  const y0 = event.clientY;
  let current = anchor;
  let dragging = false;
  let over = false;

  const show = () => {
    handlers.live(anchor, current);
  };

  const move = (moved: PointerEvent) => {
    if (moved.pointerId !== pointerId) return;
    if (!dragging) {
      const dx = moved.clientX - x0;
      const dy = moved.clientY - y0;
      if (touch) {
        const intent = swipeIntent(dx, dy);
        if (intent === "scroll") finish();
        if (intent !== "mark") return;
      } else if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      dragging = true;
    }
    const at = pointIndex(moved.clientX, moved.clientY, root);
    if (at !== null) current = at;
    show();
  };

  const up = (lifted: PointerEvent) => {
    if (lifted.pointerId !== pointerId) return;
    const wasDrag = dragging;
    finish();
    if (wasDrag) {
      // The browser selected the words as they were dragged over. Leaving that selection would make
      // the next press inside it start a native text drag, which cancels the gesture.
      window.getSelection()?.removeAllRanges();
      handlers.commit(anchor, current);
      // The drag marked words; it does not also pick the answer they belong to.
      swallowClick(lifted);
      return;
    }
    if (handlers.tap(anchor)) swallowClick(lifted);
  };

  const cancel = (cancelled: PointerEvent) => {
    if (cancelled.pointerId === pointerId) finish();
  };

  // A second finger makes it a pinch or a two-finger scroll, which belong to the browser.
  const second = (pressed: PointerEvent) => {
    if (touch && pressed.pointerType === "touch" && pressed.pointerId !== pointerId) finish();
  };

  // A long press opens the context menu on some phones, and on a choice the menu strikes it out.
  // A finger resting on a word is reading, or about to swipe; the X still strikes.
  const keepMenu = (opened: Event) => {
    if (!touch) return;
    opened.preventDefault();
    opened.stopPropagation();
  };

  function finish() {
    if (over) return;
    over = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("pointerdown", second, true);
    window.removeEventListener("contextmenu", keepMenu, true);
    handlers.end();
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("pointerdown", second, true);
  window.addEventListener("contextmenu", keepMenu, true);
  return {
    abandon: finish,
    holdTouch: (moved) => {
      if (over) return;
      if (moved.touches.length > 1) finish();
      else if (dragging && moved.cancelable) moved.preventDefault();
    },
  };
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
 * Drops the click the browser sends where the pointer lifted, and no other. The click of a
 * finger or a pencil can come a little later than a mouse's.
 */
function swallowClick(lifted: PointerEvent): void {
  const swallow = (click: MouseEvent) => {
    if (Math.abs(click.clientX - lifted.clientX) > CLICK_SLOP || Math.abs(click.clientY - lifted.clientY) > CLICK_SLOP) return;
    click.preventDefault();
    click.stopPropagation();
    stop();
  };
  const timer = window.setTimeout(stop, lifted.pointerType === "mouse" ? 100 : 700);
  function stop() {
    window.clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
  }
  window.addEventListener("click", swallow, true);
}
