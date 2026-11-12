import type { CSSProperties } from "react";

type Tone = "right" | "partial" | "missed" | "guess" | "none";

/**
 * The score at a glance: a bar split into fully right, partly right and missed (and not answered,
 * for an exam), then a tile per count with a dot in its color. The tiles carry the numbers; the
 * bar is only a picture of them.
 */
export function ScoreSummary({
  right,
  partial,
  missed,
  guessed,
  unanswered,
}: {
  right: number;
  partial: number;
  missed: number;
  guessed: number;
  /** An exam's questions left unanswered. Practice has none to show. */
  unanswered?: number;
}) {
  const parts: { tone: Tone; count: number }[] = [
    { tone: "right", count: right },
    { tone: "partial", count: partial },
    { tone: "missed", count: missed },
    { tone: "none", count: unanswered ?? 0 },
  ];
  const tiles: { tone: Tone; label: string; count: number }[] = [
    { tone: "right", label: "Fully right", count: right },
    { tone: "partial", label: "Partly right", count: partial },
    { tone: "missed", label: "Missed", count: missed },
    { tone: "guess", label: "Guessed", count: guessed },
  ];
  if (unanswered !== undefined) tiles.push({ tone: "none", label: "Not answered", count: unanswered });
  const shown = parts.filter((part) => part.count > 0);
  return (
    <div className="result-score">
      {shown.length > 0 ? (
        <div className="result-split" aria-hidden="true">
          {shown.map((part) => (
            <span key={part.tone} className={`result-split-part result-tone-${part.tone}`} style={{ flexGrow: part.count }} />
          ))}
        </div>
      ) : null}
      <ul className="result-stats" aria-label="Score summary" style={{ "--tiles": String(tiles.length) } as CSSProperties}>
        {tiles.map((tile) => (
          <li key={tile.tone}>
            <strong>{tile.count}</strong>
            <span className={`result-dot result-tone-${tile.tone}`} aria-hidden="true" />
            {tile.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A breakdown, such as by clinical judgment step: each row's count, and a meter of how much of it was right. */
export function MeterList({ label, rows }: { label: string; rows: readonly { label: string; right: number; total: number }[] }) {
  return (
    <ul className="judgment" aria-label={label}>
      {rows.map((row) => (
        <li key={row.label}>
          <span>{row.label}</span>
          <span className="judgment-count">
            {row.right} of {row.total}
          </span>
          <span className="judgment-meter" aria-hidden="true">
            <span style={{ width: `${String(row.total > 0 ? Math.round((row.right / row.total) * 100) : 0)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
