/** The Review button that practices the filtered list, in the iPhone app's words. */
export function practiceLabel(count: number): string {
  return count === 1 ? "Practice this question (shuffled)" : `Practice these ${String(count)} (shuffled)`;
}
