// How a press becomes a drag. A mouse and a pencil mark as soon as they move, any way. A finger
// marks by swiping along the line and scrolls by swiping up or down, wherever it starts.

import { describe, expect, it } from "vitest";
import { pressBegins, SWIPE_ANGLE, SWIPE_SLOP, swipeIntent } from "./gesture";

/** A move of `length` at `degrees` up from level, to the right. */
function move(length: number, degrees: number): [number, number] {
  const angle = (degrees * Math.PI) / 180;
  return [length * Math.cos(angle), -length * Math.sin(angle)];
}

describe("how a press begins a drag", () => {
  it("lets a mouse drag from its main button only", () => {
    expect(pressBegins("mouse", 0)).toBe("drag");
    expect(pressBegins("mouse", 1)).toBeNull();
    expect(pressBegins("mouse", 2)).toBeNull();
  });

  it("lets a pencil drag at once, as a mouse does, and not from its side button", () => {
    expect(pressBegins("pen", 0)).toBe("drag");
    expect(pressBegins("pen", 2)).toBeNull();
  });

  it("makes a finger show by its swipe whether it marks or scrolls", () => {
    expect(pressBegins("touch", 0)).toBe("swipe");
  });
});

describe("what a finger's swipe is doing", () => {
  it("cannot tell before the finger has moved a little", () => {
    expect(swipeIntent(0, 0)).toBeNull();
    expect(swipeIntent(SWIPE_SLOP - 1, 0)).toBeNull();
    expect(swipeIntent(0, SWIPE_SLOP - 1)).toBeNull();
    expect(swipeIntent(3, -3)).toBeNull();
  });

  it("marks on a swipe along the line, left to right or right to left", () => {
    expect(swipeIntent(SWIPE_SLOP, 0)).toBe("mark");
    expect(swipeIntent(-SWIPE_SLOP, 0)).toBe("mark");
    expect(swipeIntent(40, 6)).toBe("mark");
    expect(swipeIntent(-40, -6)).toBe("mark");
  });

  it("scrolls on a swipe up or down the page", () => {
    expect(swipeIntent(0, SWIPE_SLOP)).toBe("scroll");
    expect(swipeIntent(0, -SWIPE_SLOP)).toBe("scroll");
    expect(swipeIntent(6, -40)).toBe("scroll");
    expect(swipeIntent(-6, 40)).toBe("scroll");
  });

  it("scrolls on a slanted swipe, which moves the page more than it follows a line", () => {
    expect(swipeIntent(20, 20)).toBe("scroll");
    expect(swipeIntent(-20, -20)).toBe("scroll");
  });

  it("draws the line between the two at the same angle on every side", () => {
    for (const [mirrorX, mirrorY] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const [nearX, nearY] = move(20, SWIPE_ANGLE - 2);
      const [steepX, steepY] = move(20, SWIPE_ANGLE + 2);
      expect(swipeIntent(nearX * mirrorX, nearY * mirrorY)).toBe("mark");
      expect(swipeIntent(steepX * mirrorX, steepY * mirrorY)).toBe("scroll");
    }
  });

  it("tells sooner than a browser begins to scroll, so the two never both move", () => {
    // Browsers wait for about 8 to 15 px before a touch scrolls the page.
    expect(SWIPE_SLOP).toBeLessThan(8);
  });
});
