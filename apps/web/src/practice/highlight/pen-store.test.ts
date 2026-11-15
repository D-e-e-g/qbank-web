// What the pen is set to stays on the device: the color, or the eraser, for the next question
// and the next visit.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readPenColor, readPenTool, savePenTool } from "./pen-store";

function storage(): Map<string, string> {
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => {
      kept.set(key, value);
    },
  });
  return kept;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the device remembers about the pen", () => {
  it("starts with the yellow pen", () => {
    storage();
    expect(readPenTool()).toBe("yellow");
  });

  it("keeps the color last picked", () => {
    storage();
    savePenTool("pink");
    expect(readPenTool()).toBe("pink");
  });

  it("keeps the eraser once it is picked, and the color under it for when a color comes back", () => {
    storage();
    savePenTool("blue");
    savePenTool("eraser");
    expect(readPenTool()).toBe("eraser");
    expect(readPenColor()).toBe("blue");
  });

  it("goes back to highlighting when a color is picked after the eraser", () => {
    storage();
    savePenTool("eraser");
    savePenTool("pink");
    expect(readPenTool()).toBe("pink");
  });

  it("reads a color it does not know as yellow", () => {
    storage().set("qbank.highlighter.color", "green");
    expect(readPenTool()).toBe("yellow");
  });

  it("falls back to the yellow pen where storage is blocked, and saving does not throw", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => {
      savePenTool("eraser");
    }).not.toThrow();
    expect(readPenTool()).toBe("yellow");
  });
});
