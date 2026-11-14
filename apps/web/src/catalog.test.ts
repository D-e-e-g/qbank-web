import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogRecord, SemesterCourse, SemesterRecord } from "./api";
import { courseMenu, courseStanding, currentCatalog, findCourse, forgetCatalog, fromRecord, homeLayout, refreshCatalog, retryCatalogWhenOnline, type Catalog } from "./catalog";

function card(id: string, kind: SemesterCourse["kind"], title: string, archivedAt: string | null = null): SemesterCourse {
  return {
    id,
    kind,
    code: kind === "topic" ? "" : id.toUpperCase(),
    title,
    sortOrder: 0,
    archivedAt,
    questionCount: 0,
    weekCount: 0,
    folderCount: 0,
    reviewCount: 0,
    answeredCount: 0,
    fullyRightCount: 0,
    points: 0,
    maxPoints: 0,
  };
}

function semester(number: number, courses: SemesterCourse[], archivedAt: string | null = null): SemesterRecord {
  return { id: `s${String(number)}`, number, name: `Semester ${String(number)}`, startsOn: null, endsOn: null, archivedAt, courses };
}

describe("the catalog from the server", () => {
  it("shows no semester for an account that has none, rather than three empty ones", () => {
    const empty = fromRecord({ semesters: [], topics: [] });
    expect(empty.semesters).toEqual([]);
    expect(empty.topics).toEqual([]);
    expect(empty.status).toBe("ready");
  });

  it("keeps her topics in the server's order and finds a course or a topic by id", () => {
    const record: CatalogRecord = {
      semesters: [semester(1, [card("nurs420", "course", "Health assessment")])],
      topics: [card("t2", "topic", "SWE Hire"), card("t1", "topic", "Spanish")],
    };
    const catalog = fromRecord(record);
    expect(catalog.topics.map((topic) => topic.title)).toEqual(["SWE Hire", "Spanish"]);
    expect(findCourse(catalog, "t1")?.kind).toBe("topic");
    expect(findCourse(catalog, "nurs420")?.code).toBe("NURS420");
    expect(findCourse(catalog, "gone")).toBeUndefined();
  });
});

describe("Home's groups", () => {
  it("shows what she studies now, and keeps what she archived for a closed group last", () => {
    const layout = homeLayout(
      fromRecord({
        semesters: [
          semester(1, [card("a", "course", "Fundamentals"), card("b", "course", "Pharm", "2026-10-01T00:00:00Z")]),
          semester(2, [card("c", "course", "Mental health")], "2026-10-02T00:00:00Z"),
        ],
        topics: [card("t1", "topic", "SWE Hire"), card("t2", "topic", "Spanish", "2026-10-03T00:00:00Z")],
      }),
    );
    expect(layout.semesters.map(({ semester: group, courses }) => [group.label, courses.map((course) => course.title)])).toEqual([
      ["Semester 1", ["Fundamentals"]],
    ]);
    expect(layout.topics.map((topic) => topic.title)).toEqual(["SWE Hire"]);
    expect(layout.archived.map((group) => [group.title, group.courses.map((course) => course.title)])).toEqual([
      ["Semester 1", ["Pharm"]],
      ["Semester 2", ["Mental health"]],
      ["Study topics", ["Spanish"]],
    ]);
  });

  it("has no Archived group when nothing is archived", () => {
    const layout = homeLayout(fromRecord({ semesters: [semester(1, [card("a", "course", "Fundamentals")])], topics: [card("t1", "topic", "SWE Hire")] }));
    expect(layout.archived).toEqual([]);
  });
});

describe("signing out", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Each /api/semesters request waits until the test answers it with that account's catalog. */
  function heldApi() {
    const waiting: ((record: CatalogRecord) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            waiting.push((record) => {
              resolve(new Response(JSON.stringify(record), { status: 200 }));
            });
          }),
      ),
    );
    return waiting;
  }

  const hers: CatalogRecord = { semesters: [semester(1, [card("nurs420", "course", "Health assessment")])], topics: [] };
  const theirs: CatalogRecord = { semesters: [], topics: [card("t1", "topic", "Spanish")] };

  it("forgets the last account's courses, even from an answer still on its way, and shows the next account's", async () => {
    const waiting = heldApi();
    const first = refreshCatalog();
    waiting[0]?.(hers);
    await first;
    expect(findCourse(currentCatalog(), "nurs420")?.title).toBe("Health assessment");

    // Her last read is still on its way when she signs out.
    const late = refreshCatalog();
    forgetCatalog();
    expect(findCourse(currentCatalog(), "nurs420")).toBeUndefined();
    expect(currentCatalog()).toEqual({ status: "loading" });

    const next = refreshCatalog();
    waiting[1]?.(hers);
    await late;
    expect(findCourse(currentCatalog(), "nurs420")).toBeUndefined();
    waiting[2]?.(theirs);
    await next;
    expect(courseMenu(currentCatalog()).topics.map((topic) => topic.title)).toEqual(["Spanish"]);
    forgetCatalog();
  });
});

describe("a load that fails", () => {
  afterEach(() => {
    forgetCatalog();
    vi.unstubAllGlobals();
  });

  type Answer = { record: CatalogRecord } | { refusal: { error: string; message: string } } | "dropped";

  /** Each /api/semesters request waits until the test answers it: the catalog, a refusal, or a dropped connection. */
  function heldApi() {
    const waiting: ((answer: Answer) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve, reject) => {
            waiting.push((answer) => {
              if (answer === "dropped") reject(new TypeError("Failed to fetch"));
              else if ("refusal" in answer) resolve(new Response(JSON.stringify(answer.refusal), { status: 503 }));
              else resolve(new Response(JSON.stringify(answer.record), { status: 200 }));
            });
          }),
      ),
    );
    return waiting;
  }

  const hers: CatalogRecord = { semesters: [semester(1, [card("nurs420", "course", "Health assessment")])], topics: [] };

  it("is loading until the server answers", () => {
    expect(currentCatalog()).toEqual({ status: "loading" });
  });

  it("says a first load failed, rather than showing an account with no courses", async () => {
    const waiting = heldApi();
    const first = refreshCatalog();
    expect(currentCatalog()).toEqual({ status: "loading" });
    waiting[0]?.("dropped");
    await first;
    expect(currentCatalog()).toEqual({ status: "failed", message: "Could not load your courses." });
  });

  it("shows the server's own sentence when it refused", async () => {
    const waiting = heldApi();
    const first = refreshCatalog();
    waiting[0]?.({ refusal: { error: "unavailable", message: "QBank is restarting. Try again in a moment." } });
    await first;
    expect(currentCatalog()).toEqual({ status: "failed", message: "QBank is restarting. Try again in a moment." });
  });

  it("is loading again while Try again asks, then shows the courses", async () => {
    const waiting = heldApi();
    const first = refreshCatalog();
    waiting[0]?.("dropped");
    await first;

    const again = refreshCatalog();
    expect(currentCatalog()).toEqual({ status: "loading" });
    waiting[1]?.({ record: hers });
    await again;
    expect(findCourse(currentCatalog(), "nurs420")?.title).toBe("Health assessment");
  });

  it("keeps the courses on screen when a later read fails", async () => {
    const waiting = heldApi();
    const first = refreshCatalog();
    waiting[0]?.({ record: hers });
    await first;
    const shown = currentCatalog();

    const refresh = refreshCatalog();
    expect(currentCatalog()).toBe(shown);
    waiting[1]?.("dropped");
    await refresh;
    expect(currentCatalog()).toBe(shown);
  });

  it("drops a failure that arrives after sign-out", async () => {
    const waiting = heldApi();
    const late = refreshCatalog();
    forgetCatalog();
    waiting[0]?.("dropped");
    await late;
    expect(currentCatalog()).toEqual({ status: "loading" });
  });

  it("tries again by itself when the device comes back online, and only after a failure", async () => {
    const device = new EventTarget();
    vi.stubGlobal("window", device);
    const waiting = heldApi();
    const stop = retryCatalogWhenOnline();

    // Nothing failed yet: coming online asks for nothing.
    device.dispatchEvent(new Event("online"));
    expect(waiting).toHaveLength(0);

    const first = refreshCatalog();
    waiting[0]?.("dropped");
    await first;
    expect(currentCatalog().status).toBe("failed");

    device.dispatchEvent(new Event("online"));
    expect(waiting).toHaveLength(2);
    expect(currentCatalog()).toEqual({ status: "loading" });
    waiting[1]?.({ record: hers });
    await vi.waitFor(() => {
      expect(findCourse(currentCatalog(), "nurs420")?.title).toBe("Health assessment");
    });

    // The courses are on screen: coming online again reads nothing.
    device.dispatchEvent(new Event("online"));
    expect(waiting).toHaveLength(2);

    // Once the shell is gone, nothing listens.
    stop();
    forgetCatalog();
    const next = refreshCatalog();
    waiting[2]?.("dropped");
    await next;
    device.dispatchEvent(new Event("online"));
    expect(waiting).toHaveLength(3);
  });
});

describe("whether an id is one of the user's courses", () => {
  const ready = fromRecord({
    semesters: [
      semester(1, [card("a", "course", "Fundamentals"), card("b", "course", "Pharm", "2026-10-01T00:00:00Z")]),
      semester(2, [card("c", "course", "Mental health")], "2026-10-02T00:00:00Z"),
    ],
    topics: [card("t1", "topic", "SWE Hire"), card("t2", "topic", "Spanish", "2026-10-03T00:00:00Z")],
  });
  const loading: Catalog = { status: "loading" };
  const failed: Catalog = { status: "failed", message: "Could not load your courses." };

  it("is not known yet while the catalog is loading, or after it failed", () => {
    for (const catalog of [loading, failed]) {
      expect(courseStanding(catalog, "a")).toBe("unknown-yet");
      expect(courseStanding(catalog, "gone")).toBe("unknown-yet");
      expect(courseStanding(catalog, null)).toBe("unknown-yet");
    }
  });

  it("is theirs for a course or a topic in use, as the course menus list them", () => {
    expect(courseStanding(ready, "a")).toBe("theirs");
    expect(courseStanding(ready, "t1")).toBe("theirs");
    expect(courseMenu(ready).courses.map((course) => course.id)).toEqual(["a"]);
    expect(courseMenu(ready).topics.map((topic) => topic.id)).toEqual(["t1"]);
  });

  it("is not theirs for an id the catalog does not have, an archived one, or none", () => {
    expect(courseStanding(ready, "gone")).toBe("not-theirs");
    expect(courseStanding(ready, "b")).toBe("not-theirs");
    expect(courseStanding(ready, "c")).toBe("not-theirs");
    expect(courseStanding(ready, "t2")).toBe("not-theirs");
    expect(courseStanding(ready, null)).toBe("not-theirs");
  });

  it("lists no course until the catalog is ready", () => {
    expect(courseMenu(loading)).toEqual({ courses: [], topics: [] });
    expect(courseMenu(failed)).toEqual({ courses: [], topics: [] });
  });
});
