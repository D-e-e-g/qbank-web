import { useEffect, useId, useRef } from "react";
import { Button } from "./Button";

export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  confirmVariant = "primary",
  secondaryLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onSecondary,
  onCancel,
}: {
  title: string;
  /** Left out when the title asks everything there is to ask. */
  message?: string;
  confirmLabel: string;
  confirmVariant?: "primary" | "destructive";
  secondaryLabel?: string;
  /** Cancel always changes nothing; an exam calls it "Keep going". */
  cancelLabel?: string;
  onConfirm: () => void;
  onSecondary?: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape cancels with the latest onCancel, so a caller's new function never moves the focus again.
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        {message !== undefined ? <p className="sheet-message">{message}</p> : null}
        <div className="sheet-actions">
          <Button variant={confirmVariant} fullWidth onClick={onConfirm}>
            {confirmLabel}
          </Button>
          {secondaryLabel !== undefined && onSecondary !== undefined ? (
            <Button variant="secondary" fullWidth onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          ) : null}
          <Button variant="plain" fullWidth onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
