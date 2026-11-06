import type { ReactNode } from "react";
import { navigate } from "../router";

export function ShellLink({
  to,
  className,
  current,
  label,
  children,
}: {
  to: string;
  className: string;
  current: boolean;
  /** What a link with only an icon is called, and says on hover. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={to}
      className={className}
      aria-current={current ? "page" : undefined}
      aria-label={label}
      title={label}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
