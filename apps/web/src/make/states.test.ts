import { describe, expect, it } from "vitest";
import { ApiError, type DraftQuestion, type QuestionCopies, type QuestionJob, type QuestionJobStep, type QuestionMakerStatus, type QuestionResult } from "../api";
import {
  acceptWords,
  allowance,
  answerOverride,
  blindCheckLine,
  buildJob,
  canContinue,
  canMake,
  canReviseSamples,
  choiceKey,
  chooseLevel,
  copiesNote,
  copyAnswer,
  countRange,
  defaultCourseId,
  currentStep,
  fileWithAnswer,
  finishedLine,
  freshDraft,
  inProgressJobs,
  isCopies,
  isWorking,
  jobCourseName,
  jobFraction,
  jobHeadline,
  jobPlace,
  jobProgress,
  jobScreenTitle,
  jobState,
  jobStepLabel,
  jobTitle,
  keptCopies,
  letters,
  makeNote,
  makerClosed,
  photoLine,
  problemText,
  questionKinds,
  questionShape,
  resetDraft,
  restCount,
  retakeTitle,
  runningTitle,
  sampleChanges,
  stepIcon,
  stepProgress,
  stepText,
  stoppedMessage,
  takeDraft,
  verdictLabel,
  writingTime,
} from "./states";

const COURSE = "8d3c56f1-5f43-4c62-9d0e-7a3b1f2e4c55";
const FOLDER = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const JOB = "6a1f0b8e-2c4d-4e6f-8a0b-1c2d3e4f5a6b";
const NOW = Date.parse("2026-11-03T18:00:00.000Z");

function status(over: Partial<QuestionMakerStatus> = {}): QuestionMakerStatus {
  return {
    available: true,
    reason: null,
    dailyLimit: 3,
    startedToday: 1,
    nextAvailableAt: null,
    levels: [
      { level: "exam", minCount: 10, maxCount: 15, defaultCount: 15 },
      { level: "course", minCount: 12, maxCount: 16, defaultCount: 15 },
      { level: "board", minCount: 12, maxCount: 16, defaultCount: 15 },
    ],
    defaultLevel: "exam",
    sampleSize: 5,
    limits: { photos: 20, photoBytes: 5_000_000, fileBytes: 20_000_000, textCharacters: 200_000 },
    imageTypes: ["image/jpeg"],
    fileTypes: ["application/pdf", "text/plain", "text/markdown"],
    ...over,
  };
}

function step(key: QuestionJobStep["key"], state: QuestionJobStep["state"], done: number | null = null, total: number | null = null): QuestionJobStep {
  return { key, label: key, state, done, total };
}

function job(over: Partial<QuestionJob> = {}): QuestionJob {
  return {
    id: JOB,
    status: "running",
    step: "write",
    waitingFor: null,
    steps: [step("read", "done"), step("samples", "done"), step("review", "done"), step("write", "current", 9, 15), step("check", "todo"), step("file", "todo")],
    course: { id: COURSE, code: "NURS 406", title: "Mental Health" },
    folder: { id: FOLDER, name: "Week 4" },
    materialKind: "notes",
    level: "exam",
    reference: null,
    count: 15,
    examTwins: true,
    title: null,
    photoCount: 0,
    sets: [],
    createdAt: "2026-11-03T17:00:00.000Z",
    updatedAt: "2026-11-03T17:30:00.000Z",
    finishedAt: null,
    failure: null,
    warnings: [],
    usage: { calls: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ...over,
  };
}

function question(over: Partial<DraftQuestion> = {}): DraftQuestion {
  return {
    id: "A01",
    type: "single",
    topic: "Invented topic",
    cj: "Recognize cues",
    need: null,
    difficulty: 2,
    stem: "An invented patient reports cool hands.",
    ask: "Which finding does the nurse report?",
    rationale: "Cool hands follow the invented walk.",
    takeaway: "Report the new finding.",
    body: { options: [{ t: "Warm feet", ok: false }, { t: "Cool hands", ok: true }, { t: "A dry cough" }, { t: "Clear speech" }] },
    table: null,
    images: [],
    terms: [],
    source: null,
    twinOf: null,
    ...over,
  };
}

describe("who may make questions", () => {
  it("shows the row only while the server says she may start a set now", () => {
    expect(canMake(status())).toBe(true);
    expect(canMake(status({ available: false, reason: "Making questions is not available on this account. Import works on every account." }))).toBe(false);
    expect(canMake(null)).toBe(false);
  });

  it("says how many sets are left, or the server's reason, and nothing until the server answers", () => {
    expect(makeNote(null)).toBeNull();
    expect(makeNote(status())).toBe("2 of 3 sets left today");
    expect(allowance(3, 3)).toBe("0 of 3 sets left today");
    const reason = "You have started 3 sets in the last 24 hours, the most for one day.";
    expect(makeNote(status({ available: false, reason, startedToday: 3, nextAvailableAt: "2026-11-04T09:00:00.000Z" }))).toBe(reason);
    expect(makeNote(status({ available: false, reason: "Making questions is not set up yet." }))).toBe("Making questions is not set up yet.");
  });

  it("lists a running, waiting, failed, or freshly finished set, and drops a cancelled one and an old one", () => {
    const running = job();
    const waiting = job({ id: "b", status: "waiting", waitingFor: "samples" });
    const failed = job({ id: "c", status: "failed" });
    const fresh = job({ id: "d", status: "done", finishedAt: "2026-11-03T17:00:00.000Z" });
    const old = job({ id: "e", status: "done", finishedAt: "2026-11-02T17:59:59.000Z" });
    const cancelled = job({ id: "f", status: "cancelled" });
    const boundary = job({ id: "g", status: "done", finishedAt: new Date(NOW - 86_400_000).toISOString() });
    expect(inProgressJobs([running, waiting, failed, fresh, old, cancelled, boundary], NOW).map((item) => item.id)).toEqual([JOB, "b", "c", "d"]);
  });

  it("shows the server's sentence, and a plain line when it could not be reached", () => {
    expect(problemText(new ApiError(429, { error: "daily_limit", message: "You have started 3 sets in the last 24 hours, the most for one day. You can start another in 2 hours." }))).toBe(
      "You have started 3 sets in the last 24 hours, the most for one day. You can start another in 2 hours.",
    );
    expect(problemText(new TypeError("Failed to fetch"))).toBe("QBank could not be reached. Try again in a moment.");
    expect(problemText(new Error("nope"))).toBe("Something went wrong. Try again.");
    expect(makerClosed(new ApiError(403, { error: "not_allowed", message: "Making questions is not available on this account. Import works on every account." }))).toBe(true);
    expect(makerClosed(new ApiError(503, { error: "not_set_up", message: "Making questions is not set up yet." }))).toBe(true);
    expect(makerClosed(new ApiError(429, { error: "daily_limit", message: "Later." }))).toBe(false);
  });
});

describe("your material", () => {
  it("starts on photos, at the server's level and count, in the course that opened it", () => {
    const draft = freshDraft(status({ defaultLevel: "course" }), COURSE);
    expect(draft.source).toBe("photos");
    expect(draft.level).toBe("course");
    expect(draft.count).toBe(15);
    expect(draft.courseId).toBe(COURSE);
    expect(draft.examTwins).toBe(true);
    expect(countRange(null, "exam")).toEqual({ min: 10, max: 15, defaultCount: 15 });
  });

  it("copies photos of practice questions and writes from everything else", () => {
    const notes = freshDraft(status(), COURSE);
    expect(isCopies(notes)).toBe(false);
    expect(isCopies({ ...notes, holding: "questions" })).toBe(true);
    expect(isCopies({ ...notes, holding: "questions", source: "paste", text: "notes" })).toBe(false);
  });

  it("opens on the course she studied last, else her first course, else her first topic", () => {
    const courses = [{ id: "a" }, { id: "b" }];
    const topics = [{ id: "t" }];
    expect(defaultCourseId(courses, topics, "t")).toBe("t");
    expect(defaultCourseId(courses, topics, "missing")).toBe("a");
    expect(defaultCourseId(courses, topics, null)).toBe("a");
    expect(defaultCourseId([], topics, null)).toBe("t");
    expect(defaultCourseId([], [], "a")).toBeNull();
  });

  it("goes on with material, a course, and a named folder", () => {
    const draft = { ...freshDraft(status(), COURSE), source: "paste" as const, text: "  lecture  " };
    expect(canContinue(draft)).toBe(true);
    expect(canContinue({ ...draft, text: "  " })).toBe(false);
    expect(canContinue({ ...draft, courseId: null })).toBe(false);
    expect(canContinue({ ...draft, folder: { kind: "new" }, newFolder: "  " })).toBe(false);
    expect(canContinue({ ...draft, folder: { kind: "new" }, newFolder: "Week 9" })).toBe(true);
  });

  it("clamps the count when the level changes, and drops the reference set off exam level", () => {
    const draft = { ...freshDraft(status(), COURSE), count: 10, referenceSetId: FOLDER };
    const course = chooseLevel(draft, status(), "course");
    expect(course.count).toBe(12);
    expect(course.referenceSetId).toBeNull();
    expect(chooseLevel({ ...draft, count: 20 }, status(), "exam").count).toBe(15);
  });

  it("describes the photos and the time to write", () => {
    expect(photoLine(0, 20, "notes")).toBe("Up to 20 photos of slides or handwritten notes.");
    expect(photoLine(4, 20, "questions")).toBe("4 photos · quiz, worksheet, or review book pages, up to 20.");
    expect(photoLine(1, 20, "notes")).toBe("1 photo · slides or handwritten notes, up to 20.");
    expect(writingTime(15)).toBe("About 20 minutes to write");
    expect(writingTime(1)).toBe("About 5 minutes to write");
    expect(questionKinds("exam").title).toBe("Four-option single answer");
    expect(questionKinds("board").title).toBe("All 8 NCLEX formats, mixed");
  });

  it("sends notes with a level and count, and copies without them", () => {
    const notes = { ...freshDraft(status(), COURSE), source: "paste" as const, text: "  dopamine  ", referenceSetId: FOLDER, folder: { kind: "folder" as const, id: FOLDER } };
    expect(buildJob(notes)).toEqual({
      courseId: COURSE,
      folderId: FOLDER,
      materialKind: "notes",
      material: { text: "dopamine" },
      level: "exam",
      count: 15,
      referenceSetId: FOLDER,
      examTwins: true,
    });
    const copies = { ...freshDraft(status(), COURSE), holding: "questions" as const, photos: [{ id: "p", mediaType: "image/jpeg" as const, data: "aaa" }], folder: { kind: "new" as const }, newFolder: " Quiz " };
    expect(buildJob(copies)).toEqual({
      courseId: COURSE,
      folderName: "Quiz",
      materialKind: "questions",
      material: { images: [{ mediaType: "image/jpeg", data: "aaa" }] },
      examTwins: true,
    });
    expect(buildJob({ ...notes, text: " " })).toBeNull();
    expect(buildJob({ ...notes, folder: { kind: "new" }, newFolder: "" })).toBeNull();
  });

  it("keeps her photos when she starts over, and replaces them when she opens Make questions again", () => {
    resetDraft();
    const first = freshDraft(status(), COURSE);
    expect(takeDraft(first, false)).toBe(first);
    const again = freshDraft(status(), null);
    expect(takeDraft(again, true)).toBe(first);
    expect(takeDraft(again, false)).toBe(again);
    resetDraft();
  });
});

describe("a set being made", () => {
  it("names a course by its code and a topic by its name", () => {
    expect(jobCourseName({ code: "NURS 406", title: "Mental Health" })).toBe("NURS 406");
    expect(jobCourseName({ code: "", title: "Fluids" })).toBe("Fluids");
  });

  it("says where a running set is, from the step that is neither done nor still ahead", () => {
    expect(currentStep(job())?.key).toBe("write");
    expect(jobState(job())).toBe("9 of 15 written");
    expect(jobProgress(job())).toBe("NURS 406 · Week 4 · 9 of 15 written");
    expect(jobHeadline(job())).toBe("9 of 15 written");
    expect(jobFraction(job())).toBe(0.6);
    expect(jobState(job({ status: "waiting", waitingFor: "samples" }))).toBe("Samples to check");
    expect(jobState(job({ status: "waiting", waitingFor: "copies" }))).toBe("Questions to check");
    expect(jobState(job({ status: "done" }))).toBe("Ready");
    expect(jobState(job({ status: "failed" }))).toBe("Stopped");
    expect(jobState(job({ status: "cancelled" }))).toBe("Cancelled");
    const reading = job({ step: "read", photoCount: 2, steps: [step("read", "current", 1, 2)] });
    expect(jobState(reading)).toBe("Reading your 2 photos");
    expect(jobState(job({ materialKind: "questions", steps: [step("read", "current")] }))).toBe("Copying the questions");
    expect(jobState(job({ steps: [step("samples", "current")] }))).toBe("Writing the samples");
    expect(jobState(job({ steps: [step("write", "current")] }))).toBe("Writing the rest");
    expect(jobState(job({ steps: [step("check", "current")] }))).toBe("Blind check");
    expect(jobState(job({ steps: [step("file", "current")] }))).toBe("Filing the set");
    expect(jobState(job({ steps: [step("review", "waiting")] }))).toBe("Working");
    const twins = job({ steps: [step("twins", "current", 3, 15)] });
    expect(jobHeadline(twins)).toBe("3 of 15 exam twins written");
    expect(jobFraction(job({ steps: [step("check", "current")] }))).toBeNull();
    expect(jobFraction(job({ steps: [step("write", "current", 20, 10)] }))).toBe(1);
  });

  it("titles the screen for the step, and says which step of the set it is", () => {
    expect(jobTitle(job())).toBe("Your new set");
    expect(jobTitle(job({ title: "Antipsychotics" }))).toBe("Antipsychotics");
    expect(jobTitle(job({ sets: [{ id: FOLDER, title: "Week 4 - Set 1", kind: "practice" }] }))).toBe("Week 4 - Set 1");
    expect(jobTitle(job({ materialKind: "questions" }))).toBe("Questions from your photos");
    expect(jobPlace(job({ title: "Antipsychotics" }))).toBe("Antipsychotics · NURS 406 · Week 4");
    expect(runningTitle(job({ steps: [step("read", "current")], photoCount: 2 }))).toBe("Reading your photos");
    expect(runningTitle(job({ steps: [step("read", "current")] }))).toBe("Reading your material");
    expect(runningTitle(job({ materialKind: "questions", steps: [step("read", "current")] }))).toBe("Copying the questions");
    expect(runningTitle(job({ steps: [step("samples", "current")] }))).toBe("Writing 5 samples");
    expect(runningTitle(job())).toBe("Writing your set");
    expect(runningTitle(job({ materialKind: "questions", steps: [step("file", "current")] }))).toBe("Adding your questions");
    expect(jobScreenTitle(job(), null)).toBe("Writing your set");
    expect(jobScreenTitle(job({ status: "waiting", waitingFor: "samples" }), null)).toBe("Check 5 samples");
    expect(jobScreenTitle(job({ status: "waiting", waitingFor: "copies" }), null)).toBe("Check the copies");
    expect(jobScreenTitle(job({ status: "waiting", waitingFor: "copies" }), 4)).toBe("4 questions found");
    expect(jobScreenTitle(job({ status: "waiting", waitingFor: "copies" }), 1)).toBe("1 question found");
    expect(jobScreenTitle(job({ status: "done" }), null)).toBe("Your set is ready");
    expect(jobScreenTitle(job({ status: "failed" }), null)).toBe("This set stopped");
    expect(jobScreenTitle(job({ status: "cancelled" }), null)).toBe("Set stopped");
    expect(stepText(1, 4)).toBe("Step 1 of 4");
    expect(jobStepLabel(job({ steps: [step("read", "current")] }))).toBe("Step 3 of 4");
    expect(jobStepLabel(job())).toBe("Step 4 of 4");
    expect(jobStepLabel(job({ materialKind: "questions", steps: [step("read", "current")] }))).toBe("Step 2 of 2");
    expect(jobStepLabel(job({ status: "waiting", waitingFor: "samples" }))).toBe("Step 3 of 4");
    expect(jobStepLabel(job({ status: "waiting", waitingFor: "copies" }))).toBe("Check the copies");
    expect(jobStepLabel(job({ status: "done" }))).toBeNull();
    expect(isWorking(null, false)).toBe(true);
    expect(isWorking(null, true)).toBe(false);
    expect(isWorking(job(), false)).toBe(true);
    expect(isWorking(job({ status: "waiting" }), false)).toBe(false);
  });

  it("marks a step done, working, waiting, or stopped", () => {
    expect(stepIcon(step("write", "done"))).toBe("circle-check");
    expect(stepIcon(step("write", "current"))).toBe("clock");
    expect(stepIcon(step("review", "waiting"))).toBe("info");
    expect(stepIcon(step("write", "failed"))).toBe("circle-x");
    expect(stepIcon(step("write", "cancelled"))).toBe("circle-minus");
    expect(stepIcon(step("file", "todo"))).toBe("circle");
    expect(stepProgress(step("write", "done"))).toBe("Done");
    expect(stepProgress(step("write", "current", 9, 15))).toBe("9 of 15");
    expect(stepProgress(step("write", "current"))).toBe("Working");
    expect(stepProgress(step("review", "waiting"))).toBe("Waiting for you");
    expect(stepProgress(step("write", "failed"))).toBe("Stopped");
    expect(stepProgress(step("file", "todo"))).toBe("");
  });
});

describe("her check", () => {
  const sample = question();

  it("describes a sample and the choices its key marks", () => {
    expect(questionShape(sample)).toBe("Single answer · 4 choices");
    expect(questionShape(question({ type: "matrix", body: { columns: [], rows: [] } }))).toBe("Matrix");
    expect(choiceKey(sample)).toEqual([1]);
    expect(verdictLabel("looksRight")).toBe("Looks right");
    expect(verdictLabel("change")).toBe("Change");
    expect(verdictLabel("notChecked")).toBe("Not checked");
  });

  it("sends her notes on the samples she marked Change, and writes the rest from them", () => {
    const questions = [{ id: "A01" }, { id: "A02" }];
    const verdicts = { A01: "change" as const, A02: "looksRight" as const };
    expect(sampleChanges(questions, verdicts, { A01: "  shorter stem  ", A02: "ignored" })).toEqual([{ questionId: "A01", note: "shorter stem" }]);
    expect(sampleChanges(questions, verdicts, { A01: "  " })).toEqual([]);
    const changes = [{ questionId: "A02", note: "name the drug" }];
    expect(acceptWords(questions, changes)).toBe("Sample 2: name the drug");
    expect(acceptWords(questions, [])).toBeNull();
    expect(canReviseSamples(true, changes)).toBe(true);
    expect(canReviseSamples(true, [])).toBe(false);
    expect(canReviseSamples(false, changes)).toBe(false);
    expect(restCount(job({ count: 15 }), 5)).toBe(10);
    expect(restCount(job({ count: null }), 5)).toBe(0);
  });

  it("keeps her answer on a copy only when it differs from the photo, and says whose answer it is", () => {
    const copy = {
      id: "P01",
      photo: 1,
      answerFrom: "photo" as const,
      explanationsFrom: "qbank" as const,
      question: sample,
      file: { id: "P01", options: [{ t: "Warm feet", ok: false }, { t: "Cool hands", ok: true }] },
    };
    expect(answerOverride(sample, [1])).toBeNull();
    expect(answerOverride(sample, [0])).toEqual([0]);
    expect(copyAnswer(copy, null)).toBe("Answer from the photo: B");
    expect(copyAnswer({ ...copy, answerFrom: "suggested" }, null)).toBe("No answer in the photo · QBank suggests B, check it");
    expect(copyAnswer(copy, [0, 2])).toBe("Your answer: A, C");
    expect(letters([])).toBeNull();
    const copies: QuestionCopies = { title: "Invented quiz", photoCount: 2, questions: [copy, { ...copy, id: "P02" }], unreadable: [{ photo: 2, reason: "The bottom of photo 2 is blurry." }] };
    expect(copiesNote(copies, job())).toBe("From 2 photos · NURS 406 · Week 4. Tap a question to check its answer or leave it out.");
    expect(copiesNote({ ...copies, photoCount: 0 }, job())).toContain("From your material");
    expect(retakeTitle(copies)).toBe("Retake photo 2");
    expect(retakeTitle({ ...copies, unreadable: [{ photo: null, reason: "A line was cut off." }] })).toBe("Start over");
    expect(keptCopies(copies, new Set(["P02"]), { P01: [0] })).toEqual([
      { id: "P01", question: { id: "P01", options: [{ t: "Warm feet", ok: true }, { t: "Cool hands" }] } },
    ]);
    expect(keptCopies(copies, new Set(), {})).toEqual([{ id: "P01" }, { id: "P02" }]);
    expect(fileWithAnswer({ stem: "no options" }, new Set([0]))).toEqual({ stem: "no options" });
  });

  it("says what the blind check did, and that a stopped set filed nothing", () => {
    const result: QuestionResult = {
      set: { setId: FOLDER, title: "Week 4 - Set 1", folderId: FOLDER, folderName: "Week 4", examPageId: null, questionCount: 15, termCount: 2 },
      examSet: null,
      blindCheck: { passed: 13, fixed: 1, removed: 1, questions: [], changeList: "" },
      examBlindCheck: null,
      suggestedAnswers: [],
      warnings: [],
    };
    const check = result.blindCheck ?? { passed: 0, fixed: 0, removed: 0, questions: [], changeList: "" };
    expect(blindCheckLine(check)).toBe("13 of 15 passed the blind check · 1 fixed, 1 removed");
    expect(blindCheckLine({ ...check, fixed: 0, removed: 0, passed: 15 })).toBe("15 of 15 passed the blind check");
    expect(finishedLine(result, "NURS 406")).toBe("“Week 4 - Set 1” · 15 questions in NURS 406, Week 4.");
    expect(stoppedMessage(job({ status: "cancelled" }))).toBe("You stopped this set. Nothing was added to your course.");
    expect(stoppedMessage(job({ status: "failed", failure: "The photos could not be read.", course: { id: COURSE, code: "", title: "Fluids" } }))).toBe("The photos could not be read.");
    expect(stoppedMessage(job({ status: "failed", failure: null, course: { id: COURSE, code: "", title: "Fluids" } }))).toBe("QBank could not finish this set. Nothing was added to your topic.");
  });
});
