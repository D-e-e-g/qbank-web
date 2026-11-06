import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { position, type MenuAnchor } from "./menu-position";

export type { MenuAnchor } from "./menu-position";

export interface MenuItem {
  /** Stable within the menu, for React and tests. */
  key: string;
  label: string;
  /** A second line, for a row whose label alone would leave her guessing. */
  detail?: string;
  icon?: IconName;
  /** Red, for a row that deletes. */
  destructive?: boolean;
  /** A line above the row, setting it apart from the rows before it. */
  separated?: boolean;
  onSelect: () => void;
}

/**
 * A short list of actions over the screen, as the iPhone's menus are: under the button that opened
 * it, right-aligned to it, or above it when there is no room below. A tap outside, Escape, Tab or a
 * resize closes it and changes nothing. Arrow keys move between rows; the first row has
 * focus when it opens, and focus goes back to the button when it closes.
 */
export function Menu({
  label,
  title,
  anchor,
  items,
  onClose,
}: {
  /** What a screen reader calls the menu. */
  label: string;
  /** A quiet heading over the rows ("Add to NURS 310"); none for a card's menu. */
  title?: string;
  anchor: MenuAnchor;
  items: readonly MenuItem[];
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const opener = "element" in anchor ? anchor.element : null;

  const close = useCallback(() => {
    onClose();
    opener?.focus();
  }, [onClose, opener]);

  const reposition = useCallback(() => {
    const menu = panel.current;
    if (menu !== null) setPlace(position(anchor, menu.offsetWidth, menu.offsetHeight, window.innerWidth, window.innerHeight));
  }, [anchor]);

  useLayoutEffect(reposition, [reposition]);

  // The first row takes focus once the menu is placed: a hidden one cannot.
  const placed = place !== null;
  useEffect(() => {
    if (placed) panel.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [placed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  useEffect(() => {
    // It follows its button when the screen scrolls under it (a scroll still settling as it opens);
    // a long menu scrolling its own rows stays put.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && panel.current?.contains(event.target) === true)) reposition();
    };
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, reposition]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      close();
      return;
    }
    const rows = [...(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[event.key];
    if (next === undefined || rows.length === 0) return;
    event.preventDefault();
    rows[(next + rows.length) % rows.length]?.focus();
  };

  return createPortal(
    // React sends a portal's events to its parents, so neither reaches the card that opened the menu.
    <div
      className="menu-layer"
      onClick={(event) => {
        event.stopPropagation();
        close();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div
        ref={panel}
        className="menu"
        role="menu"
        aria-label={label}
        style={place === null ? { visibility: "hidden" } : { top: place.top, left: place.left }}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {title === undefined ? null : (
          <p className="menu-title" aria-hidden="true">
            {title}
          </p>
        )}
        {items.map((item) => (
          <Fragment key={item.key}>
            {item.separated === true ? <div className="menu-separator" role="separator" /> : null}
            <button
              type="button"
              role="menuitem"
              className={item.destructive === true ? "menu-row menu-row-destructive" : "menu-row"}
              // The row is called by its label; its second line describes it.
              aria-labelledby={`${id}-${item.key}`}
              aria-describedby={item.detail === undefined ? undefined : `${id}-${item.key}-detail`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon === undefined ? null : (
                <span className="menu-icon">
                  <Icon name={item.icon} size={20} />
                </span>
              )}
              <span className="menu-copy">
                <span className="menu-label" id={`${id}-${item.key}`}>
                  {item.label}
                </span>
                {item.detail === undefined ? null : (
                  <span className="menu-detail" id={`${id}-${item.key}-detail`}>
                    {item.detail}
                  </span>
                )}
              </span>
            </button>
          </Fragment>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The + at the top right of a screen that holds things: Home, a course or topic, an exam or study
 * page. It opens a menu of what can be added there, and each row adds into that screen. A folder has
 * one way to add, so its + is a link straight to Import instead.
 */
export function AddMenu({ label, items }: { label: string; items: readonly MenuItem[] }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = useCallback(() => {
    setAnchor(null);
  }, []);
  return (
    <>
      <button
        type="button"
        className="add-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          setAnchor(anchor === null ? { element: event.currentTarget } : null);
        }}
      >
        <Icon name="plus" size={22} strokeWidth={2} />
      </button>
      {anchor === null ? null : <Menu label={label} title={label} anchor={anchor} items={items} onClose={close} />}
    </>
  );
}

/**
 * The quiet "…" just left of + on a course, topic, page or folder: what changes the screen itself
 * (Rename, Edit page) rather than adding into it.
 */
export function MoreMenu({ name, items }: { name: string; items: readonly MenuItem[] }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = useCallback(() => {
    setAnchor(null);
  }, []);
  return (
    <>
      <button
        type="button"
        className="card-more"
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          setAnchor(anchor === null ? { element: event.currentTarget } : null);
        }}
      >
        <Icon name="ellipsis" size={20} strokeWidth={2} />
      </button>
      {anchor === null ? null : <Menu label={name} anchor={anchor} items={items} onClose={close} />}
    </>
  );
}
