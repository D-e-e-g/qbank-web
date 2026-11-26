import { describe, expect, it } from "vitest";
import { practiceLabel } from "./review-list";

describe("practiceLabel", () => {
  it("names one question without a count", () => {
    expect(practiceLabel(1)).toBe("Practice this question (shuffled)");
  });

  it("counts several questions", () => {
    expect(practiceLabel(2)).toBe("Practice these 2 (shuffled)");
    expect(practiceLabel(3)).toBe("Practice these 3 (shuffled)");
  });
});
