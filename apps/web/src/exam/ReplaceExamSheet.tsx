import { ConfirmSheet } from "../components/ConfirmSheet";

/** The one question before a new exam ends the running one, on Exam setup and on a twin job. */
export function ReplaceExamSheet({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmSheet
      title="Start a new exam?"
      message="The exam in progress ends now. What you answered on it is scored, and the rest score 0."
      confirmLabel="Start new exam"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
