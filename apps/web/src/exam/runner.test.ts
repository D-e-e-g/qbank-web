import { describe, expect, it } from "vitest";
import {
  endRetryDelay,
  initialPhase,
  nextStop,
  runnerReduce,
  runnerStep,
  type ItemState,
  type RunnerEvent,
  type RunnerPhase,
  type RunnerState,
} from "./runner";

function item(over: Partial<ItemState> = {}): ItemState {
  return {
    layout: { kind: "options", order: [0, 1, 2] },
    draft: { type: "single", choice: null },
    struck: [],
    marks: {},
    guessed: false,
    clientAttemptId: "attempt",
    submitted: false,
    skipped: false,
    ...over,
  };
}

const answered = (over: Partial<ItemState> = {}) => item({ draft: { type: "single", choice: 0 }, ...over });
const submitted = () => answered({ submitted: true });
const pick = (choice: number): RunnerEvent => ({ type: "edit", change: () => ({ draft: { type: "single", choice } }) });

function open(items: ItemState[]): RunnerState {
  return { items, phase: initialPhase(items) };
}

function run(state: RunnerState, ...events: RunnerEvent[]): RunnerState {
  return events.reduce(runnerReduce, state);
}

const answering = (index: number, over: Partial<Extract<RunnerPhase, { phase: "answering" }>> = {}): RunnerPhase => ({
  phase: "answering",
  index,
  returning: false,
  wrappedTo: null,
  error: null,
  ...over,
});
const OFFLINE = { kind: "offline" } as const;

describe("nextStop", () => {
  it("goes to the next question not submitted, then wraps back to a skipped one", () => {
    const items = [item(), submitted(), item(), submitted()];
    expect(nextStop(items, 0)).toEqual({ index: 2, wrapped: false });
    expect(nextStop(items, 2)).toEqual({ index: 0, wrapped: true });
    expect(nextStop([submitted(), submitted()], 1)).toBeNull();
  });
});

describe("initialPhase", () => {
  it("opens on the first question not yet submitted", () => {
    expect(initialPhase([submitted(), item(), item()])).toEqual(answering(1));
  });

  it("leaves an exam with no questions alone instead of asking to finish it", () => {
    expect(initialPhase([])).toEqual(answering(0));
  });

  it("opens asking to finish when a reload finds every answer in, instead of on question 1", () => {
    expect(initialPhase([submitted(), submitted()])).toEqual({ phase: "endPending", reason: "finished", problem: null, tries: 0, retryInMs: 0 });
  });
});

describe("runnerStep, each transition", () => {
  const items = [answered(), item()];

  it("submit: answering to saving, only for an answered question not yet submitted", () => {
    expect(runnerStep(answering(0), items, { type: "submit" })).toEqual({ phase: "saving", index: 0, returning: false, wrappedTo: null, retrying: false });
    const blank = answering(1);
    expect(runnerStep(blank, items, { type: "submit" })).toBe(blank);
    const done = answering(0);
    expect(runnerStep(done, [submitted(), item()], { type: "submit" })).toBe(done);
  });

  it("saveRetrying: marks the save as waiting for the connection", () => {
    const saving = runnerStep(answering(0), items, { type: "submit" });
    expect(runnerStep(saving, items, { type: "saveRetrying" })).toMatchObject({ phase: "saving", retrying: true });
  });

  it("saved: moves to the next question, or with none left, asks to finish", () => {
    const saving: RunnerPhase = { phase: "saving", index: 0, returning: false, wrappedTo: null, retrying: true };
    expect(runnerStep(saving, [submitted(), item()], { type: "saved" })).toEqual(answering(1));
    expect(runnerStep(saving, [submitted(), submitted()], { type: "saved" })).toEqual({ phase: "ending", reason: "finished", problem: null, tries: 0 });
  });

  it("saved: wrapping back to a skipped question says so", () => {
    const saving: RunnerPhase = { phase: "saving", index: 2, returning: false, wrappedTo: null, retrying: false };
    expect(runnerStep(saving, [item({ skipped: true }), submitted(), submitted()], { type: "saved" })).toEqual(answering(0, { returning: true, wrappedTo: 0 }));
  });

  it("saveFailed: back to the same question with the server's sentence", () => {
    const saving: RunnerPhase = { phase: "saving", index: 1, returning: true, wrappedTo: 1, retrying: false };
    expect(runnerStep(saving, items, { type: "saveFailed", message: "No." })).toEqual(answering(1, { returning: true, wrappedTo: 1, error: "No." }));
  });

  it("examClosed: the server ended it already, so the runner asks for it as it ended", () => {
    const saving: RunnerPhase = { phase: "saving", index: 0, returning: false, wrappedTo: null, retrying: false };
    expect(runnerStep(saving, items, { type: "examClosed" })).toMatchObject({ phase: "ending" });
  });

  it("end: from answering or saving, ending with the reason given", () => {
    expect(runnerStep(answering(0), items, { type: "end", reason: "left" })).toEqual({ phase: "ending", reason: "left", problem: null, tries: 0 });
    const saving: RunnerPhase = { phase: "saving", index: 0, returning: false, wrappedTo: null, retrying: false };
    expect(runnerStep(saving, items, { type: "end", reason: "finished" })).toMatchObject({ phase: "ending", reason: "finished" });
  });

  it("endFailed: offline is tried again with backoff, a refusal waits for the button", () => {
    const ending: RunnerPhase = { phase: "ending", reason: "finished", problem: null, tries: 0 };
    expect(runnerStep(ending, items, { type: "endFailed", problem: OFFLINE })).toEqual({
      phase: "endPending",
      reason: "finished",
      problem: OFFLINE,
      tries: 1,
      retryInMs: 1_000,
    });
    const refused = { kind: "refused", message: "That exam is not here." } as const;
    expect(runnerStep(ending, items, { type: "endFailed", problem: refused })).toMatchObject({ phase: "endPending", problem: refused, retryInMs: null });
  });

  it("retryEnd: asks again with the same reason, keeping the last problem on screen", () => {
    const pending: RunnerPhase = { phase: "endPending", reason: "left", problem: OFFLINE, tries: 2, retryInMs: 2_000 };
    expect(runnerStep(pending, items, { type: "retryEnd" })).toEqual({ phase: "ending", reason: "left", problem: OFFLINE, tries: 2 });
  });

  it("tick: time out ends a running exam, and nothing else", () => {
    expect(runnerStep(answering(0), items, { type: "tick", secondsLeft: 0 })).toEqual({ phase: "ending", reason: "timeout", problem: null, tries: 0 });
    const still = answering(0);
    expect(runnerStep(still, items, { type: "tick", secondsLeft: 12 })).toBe(still);
  });

  it("ignores every event that does not belong to the phase", () => {
    const phases: RunnerPhase[] = [
      answering(0),
      { phase: "saving", index: 0, returning: false, wrappedTo: null, retrying: false },
      { phase: "ending", reason: "finished", problem: null, tries: 0 },
      { phase: "endPending", reason: "finished", problem: OFFLINE, tries: 1, retryInMs: 1_000 },
    ];
    const allowed: Record<RunnerPhase["phase"], RunnerEvent["type"][]> = {
      answering: ["submit", "skip", "end", "tick"],
      saving: ["saveRetrying", "saved", "saveFailed", "examClosed", "end", "tick"],
      ending: ["endFailed"],
      endPending: ["retryEnd"],
    };
    const events: RunnerEvent[] = [
      { type: "submit" },
      { type: "saveRetrying" },
      { type: "saved" },
      { type: "saveFailed", message: "No." },
      { type: "examClosed" },
      { type: "skip" },
      pick(1),
      { type: "end", reason: "left" },
      { type: "endFailed", problem: OFFLINE },
      { type: "retryEnd" },
      { type: "tick", secondsLeft: 0 },
    ];
    for (const phase of phases) {
      for (const event of events) {
        if (allowed[phase.phase].includes(event.type)) continue;
        expect(runnerStep(phase, items, event), `${phase.phase} + ${event.type}`).toBe(phase);
      }
    }
  });
});

describe("endRetryDelay", () => {
  it("backs off as a dropped answer does, up to 15 seconds", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(endRetryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
  });
});

describe("runnerReduce, the audit's sequences", () => {
  it("last answer lands, the finish fails: one Finish that retries, never back on a submitted question", () => {
    const start = open([submitted(), item({ draft: { type: "single", choice: null } })]);
    let state = run(start, pick(0), { type: "submit" }, { type: "saved" });
    expect(state.phase).toEqual({ phase: "ending", reason: "finished", problem: null, tries: 0 });
    state = run(state, { type: "endFailed", problem: OFFLINE });
    expect(state.phase).toMatchObject({ phase: "endPending", reason: "finished", retryInMs: 1_000 });

    // Changing the answer and submitting again, Skip for now, End exam and the clock change nothing:
    // no second payload under the same attempt id, no exam recorded as left, no new finish every second.
    const after = run(state, pick(2), { type: "submit" }, { type: "skip" }, { type: "end", reason: "left" }, { type: "tick", secondsLeft: 0 });
    expect(after).toBe(state);

    // The retry asks to finish again, and backs off while the connection stays down.
    state = run(state, { type: "retryEnd" });
    expect(state.phase).toEqual({ phase: "ending", reason: "finished", problem: OFFLINE, tries: 1 });
    state = run(state, { type: "endFailed", problem: OFFLINE }, { type: "retryEnd" }, { type: "endFailed", problem: OFFLINE });
    expect(state.phase).toMatchObject({ phase: "endPending", reason: "finished", tries: 3, retryInMs: 4_000 });
  });

  it("time runs out with no connection: one timeout, retried with backoff instead of every second", () => {
    let state = run(open([item(), item()]), { type: "tick", secondsLeft: 0 }, { type: "endFailed", problem: OFFLINE });
    expect(state.phase).toMatchObject({ phase: "endPending", reason: "timeout", tries: 1, retryInMs: 1_000 });
    const ticked = run(state, { type: "tick", secondsLeft: -1 }, { type: "tick", secondsLeft: -2 }, { type: "tick", secondsLeft: -3 });
    expect(ticked).toBe(state);
    state = run(state, { type: "retryEnd" });
    expect(state.phase).toMatchObject({ phase: "ending", reason: "timeout", problem: OFFLINE });
  });

  it("a reload with every answer in asks to finish at once, and its Finish retries", () => {
    let state = open([submitted(), submitted()]);
    expect(state.phase).toMatchObject({ phase: "endPending", reason: "finished", retryInMs: 0 });
    state = run(state, { type: "retryEnd" }, { type: "endFailed", problem: { kind: "refused", message: "Not now." } });
    expect(state.phase).toMatchObject({ phase: "endPending", retryInMs: null, problem: { kind: "refused", message: "Not now." } });
    expect(run(state, { type: "retryEnd" }).phase).toMatchObject({ phase: "ending", reason: "finished" });
  });

  it("time running out while an answer is on its way ends the exam as a timeout", () => {
    const state = run(open([answered(), item()]), { type: "submit" }, { type: "saveRetrying" }, { type: "tick", secondsLeft: 0 });
    expect(state.phase).toEqual({ phase: "ending", reason: "timeout", problem: null, tries: 0 });
    // The answer that lands late changes nothing.
    expect(run(state, { type: "saved" })).toBe(state);
  });

  it("skips past questions, wraps back to the first skipped one, and finishes after the last", () => {
    let state = run(open([item(), item(), answered()]), { type: "skip" });
    expect(state.phase).toEqual(answering(1));
    state = run(state, { type: "skip" }, { type: "submit" }, { type: "saved" });
    expect(state.phase).toEqual(answering(0, { returning: true, wrappedTo: 0 }));
    expect(state.items.map((entry) => [entry.submitted, entry.skipped])).toEqual([
      [false, true],
      [false, true],
      [true, false],
    ]);
    state = run(state, { type: "skip" });
    expect(state.phase).toEqual(answering(1, { returning: true, wrappedTo: null }));
    state = run(state, pick(1), { type: "submit" }, { type: "saved" });
    expect(state.phase).toEqual(answering(0, { returning: true, wrappedTo: 0 }));
    state = run(state, pick(0), { type: "submit" }, { type: "saved" });
    expect(state.phase).toMatchObject({ phase: "ending", reason: "finished" });
  });

  it("skipping the only question left comes back to it", () => {
    const state = run(open([submitted(), item()]), { type: "skip" });
    expect(state.phase).toEqual(answering(1, { returning: true, wrappedTo: 1 }));
  });

  it("an answer cannot change while it is on its way, or after a refusal is shown on a submitted one", () => {
    const saving = run(open([answered(), item()]), { type: "submit" });
    expect(run(saving, pick(2), { type: "edit", change: () => ({ guessed: true, struck: [1] }) })).toBe(saving);
    const refused = run(saving, { type: "saveFailed", message: "That answer is not complete." });
    expect(refused.phase).toEqual(answering(0, { error: "That answer is not complete." }));
    expect(run(refused, pick(2)).items[0]?.draft).toEqual({ type: "single", choice: 2 });
  });

  it("End exam confirmed while answering records leaving, and its failure offers the same retry", () => {
    const state = run(open([item(), item()]), { type: "end", reason: "left" }, { type: "endFailed", problem: OFFLINE });
    expect(state.phase).toMatchObject({ phase: "endPending", reason: "left", retryInMs: 1_000 });
  });
});
