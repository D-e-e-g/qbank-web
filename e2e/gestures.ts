// The highlighter's gestures as each kind of pointer makes them: a mouse, a finger, a pencil.
// `drag` moves the real mouse. `stroke` sends the pointer events of a finger or a pencil, which
// work in every browser but move no page. `realFinger` puts a real touch on the screen through
// Chromium, so the browser itself decides whether the page scrolls under it.

import type { Locator, Page } from "@playwright/test";

export interface Point {
  x: number;
  y: number;
}

/** The middle of what the locator finds, scrolled into view first. */
export async function middle(of: Locator): Promise<Point> {
  await of.scrollIntoViewIfNeeded();
  const box = await of.boundingBox();
  if (!box) throw new Error("that is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press on the first word, drag to the last, let go: the mouse version of the gesture. */
export async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error("the words are not on screen");
  await page.mouse.move(start.x + 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 2, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
}

/**
 * One press by a finger ("touch") or a pencil ("pen") on the middle of `on`, a move to each point
 * of `path` in turn, and a lift at the last. `holdMs` rests on the press before it moves.
 */
export async function stroke(page: Page, pointerType: "touch" | "pen", on: Locator, path: readonly Point[], holdMs = 0): Promise<void> {
  const start = await middle(on);
  const pointer = { pointerId: 7, pointerType, isPrimary: true, button: 0 };
  await on.dispatchEvent("pointerdown", { ...pointer, bubbles: true, clientX: start.x, clientY: start.y });
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await page.evaluate(
    ({ pointer, points }) => {
      const send = (type: string, point: { x: number; y: number }) => {
        window.dispatchEvent(new PointerEvent(type, { ...pointer, bubbles: true, clientX: point.x, clientY: point.y }));
      };
      for (const point of points) send("pointermove", point);
      const last = points.at(-1);
      if (last) send("pointerup", last);
    },
    { pointer, points: path.length > 0 ? [...path] : [start] },
  );
}

/** The points between two, in even steps, ending on the second: the path of a steady swipe. */
export function steps(from: Point, to: Point, count = 8): Point[] {
  return Array.from({ length: count }, (_, index) => ({
    x: from.x + ((to.x - from.x) * (index + 1)) / count,
    y: from.y + ((to.y - from.y) * (index + 1)) / count,
  }));
}

/**
 * A real finger on a Chromium page: it touches `from`, swipes to `to`, and lifts, and the
 * browser scrolls the page or not as it would under a hand. The context needs `hasTouch`.
 */
export async function realFinger(page: Page): Promise<(from: Point, to: Point) => Promise<void>> {
  const session = await page.context().newCDPSession(page);
  return async (from, to) => {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
    for (const point of steps(from, to)) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, id: 1 }] });
      await page.waitForTimeout(12);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
}
