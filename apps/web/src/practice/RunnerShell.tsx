import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";

/**
 * The runner's frame: a header with the question count and a progress bar, the scrolling
 * question column, and a pinned footer. Practice closes from the leading X; an exam puts its
 * own controls at both ends of the header. With `strip`, the bar is one step per question.
 */
export function RunnerShell({
  wide,
  title,
  count,
  progress = 0,
  strip,
  onClose,
  leading,
  trailing,
  footer,
  children,
}: {
  wide: boolean;
  title: string;
  count: string;
  progress?: number;
  strip?: readonly StripStep[] | undefined;
  onClose?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [count]);
  const ends = leading !== undefined || trailing !== undefined;
  return (
    <div className={wide ? "runner runner-wide" : "runner"}>
      <div className="runner-top">
        <div className={ends ? "runner-header runner-header-ends" : "runner-header"}>
          <div className="runner-leading">
            {leading ??
              (onClose ? (
                <Button variant="plain" className="btn-icon" aria-label="Close" onClick={onClose}>
                  <Icon name="x" />
                </Button>
              ) : null)}
          </div>
          <div className="runner-heading">
            <div className="runner-count">{count}</div>
            <div className="runner-set">{title}</div>
          </div>
          <div className="runner-trailing">{trailing}</div>
        </div>
        <div
          className="runner-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Progress"
        >
          {strip ? (
            <div className="runner-strip" style={{ "--strip-gap": stripGap(strip.length) } as CSSProperties}>
              {strip.map((step, index) => (
                <span key={index} className={`runner-strip-step runner-strip-${step}`} />
              ))}
            </div>
          ) : (
            <div className="runner-progress-fill" style={{ width: `${String(Math.round(progress * 100))}%` }} />
          )}
        </div>
      </div>
      <div className="runner-scroll" ref={scroller}>
        <div className="runner-column">{children}</div>
      </div>
      {footer ? (
        <div className="runner-footer">
          <div className="runner-footer-inner">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One question on the progress strip. In practice a checked question shows its result (right,
 * partial, missed); a timed exam shows only answered and skipped, never right or wrong.
 */
export type StripStep = "right" | "partial" | "missed" | "answered" | "skipped" | "now" | "todo";

/** Steps keep a gap while each stays wide enough to read; a long set becomes one continuous bar. */
function stripGap(count: number): string {
  if (count <= 40) return "2px";
  if (count <= 100) return "1px";
  return "0px";
}
