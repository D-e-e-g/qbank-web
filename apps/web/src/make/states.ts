import { ApiError, type DraftQuestion, type NewQuestionJob, type QuestionCopies, type QuestionJob, type QuestionJobStep, type QuestionLevel, type QuestionMakerStatus, type QuestionResult } from "../api";
import type { IconName } from "../components/Icon";
import { FORMAT_LABELS } from "../practice/model";

/** How often a running set is read again while its screen is open. */
export const MAKE_POLL_MS = 2000;

const DAY_MS = 86_400_000;

/** Where the set goes: Unsorted, one of her folders, or a new one she names. */
export type FolderChoice = { kind: "unsorted" } | { kind: "folder"; id: string } | { kind: "new" };

export type MaterialSource = "paste" | "photos" | "file";
/** What her photos hold: notes to write from, or practice questions to copy. */
export type MaterialHolding = "notes" | "questions";

export interface MaterialImage {
  id: string;
  mediaType: "image/jpeg";
  /** Base64, without a data-URL prefix. */
  data: string;
}

export interface MaterialFile {
  name: string;
  mediaType: "application/pdf" | "text/plain" | "text/markdown";
  data: string;
}

/** Her material and picks while she makes a set, kept so starting over keeps her photos. */
export interface MakeDraft {
  source: MaterialSource;
  text: string;
  photos: MaterialImage[];
  holding: MaterialHolding;
  file: MaterialFile | null;
  courseId: string | null;
  folder: FolderChoice;
  newFolder: string;
  level: QuestionLevel;
  count: number;
  referenceSetId: string | null;
  examTwins: boolean;
}

/** Her word on a sample. The server hears a Change as her notes. */
export type Verdict = "notChecked" | "looksRight" | "change";

/** "1 question", "2 questions". */
export function countText(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/** A course by its code, a topic by its name. A question job carries no kind: only a topic's code is empty. */
export function jobCourseName(course: { code: string; title: string }): string {
  return course.code === "" ? course.title : course.code;
}

/** "course" or "topic", inside a sentence about where the set was going. */
export function jobContainer(course: { code: string }): "course" | "topic" {
  return course.code === "" ? "topic" : "course";
}

/** Make questions shows only when the server says she may start a set now. */
export function canMake(status: QuestionMakerStatus | null): boolean {
  return status?.available === true;
}

/**
 * How many sets are left today, or why she cannot make questions now, in the server's words:
 * not on this account, not set up yet, or the daily limit.
 */
export function makeNote(status: QuestionMakerStatus | null): string | null {
  if (!status) return null;
  if (status.available) return allowance(status.startedToday, status.dailyLimit);
  return status.reason;
}

/** "2 of 3 sets left today". */
export function allowance(started: number, limit: number): string {
  return `${String(Math.max(0, limit - started))} of ${countText(limit, "set")} left today`;
}

/**
 * The sets under In progress: those still going or waiting for her, those that stopped, and those
 * finished in the last day. A cancelled set is not listed.
 */
export function inProgressJobs(jobs: readonly QuestionJob[], now: number): QuestionJob[] {
  const since = now - DAY_MS;
  return jobs.filter((job) => {
    if (job.status === "cancelled") return false;
    if (job.status === "done") return Date.parse(job.finishedAt ?? job.updatedAt) > since;
    return true;
  });
}

/** The server's own sentence, or a plain line when QBank could not be reached. */
export function problemText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "QBank could not be reached. Try again in a moment.";
  return "Something went wrong. Try again.";
}

/** Listing her sets is refused for an account that may not make questions, and while it is not set up. */
export function makerClosed(error: unknown): boolean {
  if (!(error instanceof ApiError) || typeof error.body !== "object" || error.body === null || !("error" in error.body)) return false;
  const code = error.body.error;
  return code === "not_allowed" || code === "not_set_up";
}

/** How many questions a set at her level may have. Without the server's choices, 10 to 15. */
export function countRange(status: QuestionMakerStatus | null, level: QuestionLevel): { min: number; max: number; defaultCount: number } {
  const found = status?.levels.find((item) => item.level === level);
  if (!found || found.minCount > found.maxCount) return { min: 10, max: 15, defaultCount: 15 };
  return { min: found.minCount, max: found.maxCount, defaultCount: found.defaultCount };
}

/**
 * The course Make questions opens on when she did not pick one: the course she studied last,
 * else her first course, else her first topic. The iPhone does this in SetDestination.load.
 */
export function defaultCourseId(courses: readonly { id: string }[], topics: readonly { id: string }[], place: string | null): string | null {
  const every = [...courses, ...topics];
  const first = every[0];
  if (first === undefined) return null;
  return every.find((item) => item.id === place)?.id ?? first.id;
}

export function freshDraft(status: QuestionMakerStatus | null, courseId: string | null): MakeDraft {
  const level = status?.defaultLevel ?? "exam";
  return {
    source: "photos",
    text: "",
    photos: [],
    holding: "notes",
    file: null,
    courseId,
    folder: { kind: "unsorted" },
    newFolder: "",
    level,
    count: countRange(status, level).defaultCount,
    referenceSetId: null,
    examTwins: true,
  };
}

/** Photos of practice questions are copied in as they are; anything else is written from. */
export function isCopies(draft: MakeDraft): boolean {
  return draft.source === "photos" && draft.holding === "questions";
}

export function hasMaterial(draft: MakeDraft): boolean {
  if (draft.source === "paste") return draft.text.trim() !== "";
  if (draft.source === "photos") return draft.photos.length > 0;
  return draft.file !== null;
}

/** A new folder with no name is not a place yet. Unsorted and one of her folders are. */
export function folderReady(draft: MakeDraft): boolean {
  if (draft.folder.kind === "new") return draft.newFolder.trim() !== "";
  return true;
}

/** Next on Your material: material, one of her courses, and a folder. */
export function canContinue(draft: MakeDraft): boolean {
  return hasMaterial(draft) && draft.courseId !== null && folderReady(draft);
}

export function chooseLevel(draft: MakeDraft, status: QuestionMakerStatus | null, level: QuestionLevel): MakeDraft {
  const range = countRange(status, level);
  return {
    ...draft,
    level,
    count: Math.min(Math.max(draft.count, range.min), range.max),
    referenceSetId: level === "exam" ? draft.referenceSetId : null,
  };
}

/** "4 photos · slides or handwritten notes, up to 20." */
export function photoLine(count: number, max: number, holding: MaterialHolding): string {
  const kind = holding === "notes" ? "slides or handwritten notes" : "quiz, worksheet, or review book pages";
  if (count === 0) return `Up to ${String(max)} photos of ${kind}.`;
  return `${countText(count, "photo")} · ${kind}, up to ${String(max)}.`;
}

/** "About 20 minutes to write", an estimate until real sets are measured. */
export function writingTime(count: number): string {
  const minutes = Math.max(5, Math.ceil((count * 4) / 3 / 5) * 5);
  return `About ${String(minutes)} minutes to write`;
}

export const LEVELS_NOTE =
  "Exam: short four-option questions like your class exam, tricky through the wrong answers. Course: NCLEX formats one step below the board. Board: hard NCLEX board items.";

export function levelName(level: QuestionLevel): string {
  if (level === "exam") return "Exam";
  if (level === "course") return "Course";
  return "Board";
}

/** The formats a level writes. */
export function questionKinds(level: QuestionLevel): { title: string; detail: string } {
  if (level === "exam") {
    return {
      title: "Four-option single answer",
      detail: "Exam level asks like your class exam. Board and Course mix all 8 NCLEX formats.",
    };
  }
  return {
    title: "All 8 NCLEX formats, mixed",
    detail: "Board and Course. Exam level uses four-option single answer only.",
  };
}

/** What she starts, as the server takes it. Null until the material, course and folder are set. */
export function buildJob(draft: MakeDraft): NewQuestionJob | null {
  if (!draft.courseId || !folderReady(draft)) return null;
  const copies = isCopies(draft);
  let material: NewQuestionJob["material"] | null = null;
  if (draft.source === "paste") {
    const text = draft.text.trim();
    if (text === "") return null;
    material = { text };
  } else if (draft.source === "photos") {
    if (draft.photos.length === 0) return null;
    material = { images: draft.photos.map((photo) => ({ mediaType: photo.mediaType, data: photo.data })) };
  } else if (draft.file) {
    material = { file: { name: draft.file.name, mediaType: draft.file.mediaType, data: draft.file.data } };
  }
  if (!material) return null;
  const job: NewQuestionJob = {
    courseId: draft.courseId,
    materialKind: copies ? "questions" : "notes",
    material,
    examTwins: draft.examTwins,
  };
  if (draft.folder.kind === "folder") job.folderId = draft.folder.id;
  if (draft.folder.kind === "new") job.folderName = draft.newFolder.trim();
  if (!copies) {
    job.level = draft.level;
    job.count = draft.count;
    if (draft.level === "exam" && draft.referenceSetId) job.referenceSetId = draft.referenceSetId;
  }
  return job;
}

/** The step QBank is on or waits at: the first that is neither done nor still ahead. */
export function currentStep(job: QuestionJob): QuestionJobStep | null {
  return job.steps.find((step) => step.state !== "done" && step.state !== "todo") ?? null;
}

/** Where a set being made is, in a few words. */
export function jobState(job: QuestionJob): string {
  if (job.status === "waiting") return job.waitingFor === "copies" ? "Questions to check" : "Samples to check";
  if (job.status === "done") return "Ready";
  if (job.status === "failed") return "Stopped";
  if (job.status === "cancelled") return "Cancelled";
  const step = currentStep(job);
  switch (step?.key) {
    case "read":
      if (job.materialKind === "questions") return "Copying the questions";
      return job.photoCount > 0 ? `Reading your ${countText(job.photoCount, "photo")}` : "Reading your material";
    case "samples":
      return "Writing the samples";
    case "write":
      if (step.done !== null && step.total !== null) return `${String(step.done)} of ${String(step.total)} written`;
      return "Writing the rest";
    case "check":
      return "Blind check";
    case "twins":
      return "Writing exam twins";
    case "file":
      return "Filing the set";
    default:
      return "Working";
  }
}

/** "NURS 406 · Week 4 · 9 of 15 written". A topic is named by its name. */
export function jobProgress(job: QuestionJob): string {
  return `${jobCourseName(job.course)} · ${job.folder.name} · ${jobState(job)}`;
}

/** The set's name, or what it is while it has none yet. */
export function jobTitle(job: QuestionJob): string {
  if (job.title) return job.title;
  const filed = job.sets[0];
  if (filed) return filed.title;
  return job.materialKind === "questions" ? "Questions from your photos" : "Your new set";
}

/** "Schizophrenia and Antipsychotics · NURS 406 · Week 4". */
export function jobPlace(job: QuestionJob): string {
  return `${jobTitle(job)} · ${jobCourseName(job.course)} · ${job.folder.name}`;
}

/** The big line of the writing screen: "9 of 15 written", or the step it is on. */
export function jobHeadline(job: QuestionJob): string {
  const step = currentStep(job);
  if (step?.done != null && step.total != null) {
    if (step.key === "write") return `${String(step.done)} of ${String(step.total)} written`;
    if (step.key === "twins") return `${String(step.done)} of ${String(step.total)} exam twins written`;
  }
  return jobState(job);
}

/** How far the step the headline counts has got, from 0 to 1. Null while the step counts nothing. */
export function jobFraction(job: QuestionJob): number | null {
  const step = currentStep(job);
  if (step?.done == null || step.total == null || step.total <= 0) return null;
  return Math.min(1, step.done / step.total);
}

/** The title of the screen that follows a running set. */
export function runningTitle(job: QuestionJob): string {
  const key = currentStep(job)?.key;
  if (key === "read") {
    if (job.materialKind === "questions") return "Copying the questions";
    return job.photoCount > 0 ? "Reading your photos" : "Reading your material";
  }
  if (key === "samples") return "Writing 5 samples";
  return job.materialKind === "questions" ? "Adding your questions" : "Writing your set";
}

/** The screen's title for whichever step the set is on. */
export function jobScreenTitle(job: QuestionJob, copiesFound: number | null): string {
  if (job.status === "running") return runningTitle(job);
  if (job.status === "waiting") {
    if (job.waitingFor === "copies") return copiesFound === null ? "Check the copies" : `${countText(copiesFound, "question")} found`;
    return "Check 5 samples";
  }
  if (job.status === "done") return "Your set is ready";
  if (job.status === "cancelled") return "Set stopped";
  return "This set stopped";
}

/** "Step 1 of 4". */
export function stepText(step: number, of: number): string {
  return `Step ${String(step)} of ${String(of)}`;
}

/** Where she is in making the set: "Step 3 of 4", or "Check the copies". None once it has ended. */
export function jobStepLabel(job: QuestionJob): string | null {
  if (job.status === "running") {
    if (job.materialKind === "questions") return stepText(2, 2);
    const key = currentStep(job)?.key;
    return stepText(key === "read" || key === "samples" ? 3 : 4, 4);
  }
  if (job.status === "waiting") return job.waitingFor === "copies" ? "Check the copies" : stepText(3, 4);
  return null;
}

/** Said without a promise of a notification. Import is where the web shows In progress. */
export const LEAVE_NOTE =
  "You can leave this screen. The set keeps going on QBank and shows under In progress on Import until it is ready.";

/** The server is working on it, so the screen keeps reading it. A set not loaded yet still is, until it is gone. */
export function isWorking(job: QuestionJob | null, gone: boolean): boolean {
  if (!job) return !gone;
  return job.status === "running";
}

/** The mark before a step's label. */
export function stepIcon(step: QuestionJobStep): IconName {
  if (step.state === "done") return "circle-check";
  if (step.state === "current") return "clock";
  if (step.state === "waiting") return "info";
  if (step.state === "failed") return "circle-x";
  if (step.state === "cancelled") return "circle-minus";
  return "circle";
}

/** How far a step is, at the right of its row. A step not reached yet says nothing. */
export function stepProgress(step: QuestionJobStep): string {
  if (step.state === "done") return "Done";
  if (step.state === "failed" || step.state === "cancelled") return "Stopped";
  if (step.state === "waiting") return "Waiting for you";
  if (step.state === "todo") return "";
  if (step.done !== null && step.total !== null) return `${String(step.done)} of ${String(step.total)}`;
  return "Working";
}

export function verdictLabel(verdict: Verdict): string {
  if (verdict === "looksRight") return "Looks right";
  if (verdict === "change") return "Change";
  return "Not checked";
}

/** The choices of a question whose answer she can set here: single, priority, select all. */
export function choiceOptions(question: DraftQuestion): { text: string; correct: boolean }[] | null {
  if (question.type !== "single" && question.type !== "priority" && question.type !== "sata") return null;
  if (!("options" in question.body)) return null;
  return question.body.options.map((option) => ({ text: option.t, correct: option.ok === true }));
}

/** The choices the question's key marks right, in order. */
export function choiceKey(question: DraftQuestion): number[] {
  const options = choiceOptions(question);
  if (!options) return [];
  return options.flatMap((option, index) => (option.correct ? [index] : []));
}

/** "Single answer · 4 choices". */
export function questionShape(question: DraftQuestion): string {
  const format = FORMAT_LABELS[question.type];
  const options = choiceOptions(question);
  if (!options) return format;
  return `${format} · ${String(options.length)} choices`;
}

/** "B", "A, C, D": the letters of the picked choices, in order. */
export function letters(picks: readonly number[]): string | null {
  if (picks.length === 0) return null;
  return [...picks].sort((a, b) => a - b).map((index) => String.fromCharCode(65 + (index % 26))).join(", ");
}

export function letter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

/** Her answer when it differs from the one copied; the same answer clears it. */
export function answerOverride(question: DraftQuestion, picks: readonly number[]): number[] | null {
  const key = choiceKey(question);
  const chosen = new Set(picks);
  const same = key.length === chosen.size && key.every((index) => chosen.has(index));
  return same ? null : [...picks];
}

/** The answer line on a copied question: hers, from the photo, or QBank's suggestion to check. */
export function copyAnswer(copy: QuestionCopies["questions"][number], chosen: readonly number[] | null): string | null {
  if (chosen) {
    const hers = letters(chosen);
    if (hers) return `Your answer: ${hers}`;
  }
  const marked = letters(choiceKey(copy.question));
  if (!marked) return null;
  if (copy.answerFrom === "suggested") return `No answer in the photo · QBank suggests ${marked}, check it`;
  return `Answer from the photo: ${marked}`;
}

/** "From 2 photos · NURS 402 · Week 3. Tap a question to check its answer or leave it out." */
export function copiesNote(copies: QuestionCopies, job: QuestionJob): string {
  const from = copies.photoCount > 0 ? `From ${countText(copies.photoCount, "photo")}` : "From your material";
  return `${from} · ${jobCourseName(job.course)} · ${job.folder.name}. Tap a question to check its answer or leave it out.`;
}

/** "Retake photo 2" when a photo could not be read, else "Start over". */
export function retakeTitle(copies: QuestionCopies): string {
  const photo = copies.unreadable.find((item) => item.photo !== null)?.photo;
  return photo === undefined ? "Start over" : `Retake photo ${String(photo)}`;
}

/** How many questions the rest is: the count less the samples. */
export function restCount(job: QuestionJob | null, sampleCount: number): number {
  return Math.max(0, (job?.count ?? 0) - sampleCount);
}

/** Her notes on the samples she marked Change, without the empty ones. */
export function sampleChanges(
  questions: readonly { id: string }[],
  verdicts: Readonly<Record<string, Verdict>>,
  notes: Readonly<Record<string, string>>,
): { questionId: string; note: string }[] {
  return questions.flatMap((question) => {
    if (verdicts[question.id] !== "change") return [];
    const note = (notes[question.id] ?? "").trim();
    return note === "" ? [] : [{ questionId: question.id, note }];
  });
}

/** The samples can be written again: she wrote a note, and the server allows another round. */
export function canReviseSamples(canRevise: boolean, changes: readonly unknown[]): boolean {
  return canRevise && changes.length > 0;
}

/** What she said about the samples, one line each, or null when she said nothing. */
export function acceptWords(questions: readonly { id: string }[], changes: readonly { questionId: string; note: string }[]): string | null {
  const lines = changes.flatMap((change) => {
    const index = questions.findIndex((question) => question.id === change.questionId);
    return index < 0 ? [] : [`Sample ${String(index + 1)}: ${change.note}`];
  });
  return lines.length === 0 ? null : lines.join("\n");
}

/**
 * A copied question in the set file format with her answer: the picked choices marked `"ok": true`
 * and the rest unmarked.
 */
export function fileWithAnswer(file: Record<string, unknown>, picks: ReadonlySet<number>): Record<string, unknown> {
  const options = file.options;
  if (!Array.isArray(options)) return file;
  return {
    ...file,
    options: options.map((option: unknown, index) => {
      if (typeof option !== "object" || option === null) return option;
      const choice: Record<string, unknown> = { ...(option as Record<string, unknown>) };
      if (picks.has(index)) choice.ok = true;
      else delete choice.ok;
      return choice;
    }),
  };
}

/** The copies she keeps, in order, each with her answer when she set one. */
export function keptCopies(
  copies: QuestionCopies,
  skipped: ReadonlySet<string>,
  answers: Readonly<Record<string, readonly number[] | undefined>>,
): { id: string; question?: Record<string, unknown> }[] {
  return copies.questions.filter((copy) => !skipped.has(copy.id)).map((copy) => {
    const picks = answers[copy.id];
    if (!picks) return { id: copy.id };
    return { id: copy.id, question: fileWithAnswer(copy.file, new Set(picks)) };
  });
}

/** The blind check's line: "13 of 15 passed the blind check · 1 fixed, 1 removed". */
export function blindCheckLine(check: NonNullable<QuestionResult["blindCheck"]>): string {
  const total = check.passed + check.fixed + check.removed;
  const changes = [
    check.fixed > 0 ? `${String(check.fixed)} fixed` : null,
    check.removed > 0 ? `${String(check.removed)} removed` : null,
  ].filter((item) => item !== null);
  const line = `${String(check.passed)} of ${String(total)} passed the blind check`;
  return changes.length === 0 ? line : `${line} · ${changes.join(", ")}`;
}

/** "“Title” · 15 questions in NURS 406, Week 4." */
export function finishedLine(result: QuestionResult, course: string): string {
  return `“${result.set.title}” · ${countText(result.set.questionCount, "question")} in ${course}, ${result.set.folderName}.`;
}

/** You stopped it, or QBank could not finish it. Nothing was filed. */
export function stoppedMessage(job: QuestionJob): string {
  const container = jobContainer(job.course);
  if (job.status === "cancelled") return `You stopped this set. Nothing was added to your ${container}.`;
  return job.failure ?? `QBank could not finish this set. Nothing was added to your ${container}.`;
}

/** Her material for this session. Start over keeps it; opening Make questions again replaces it. */
let savedDraft: MakeDraft | null = null;

export function takeDraft(fresh: MakeDraft, keep: boolean): MakeDraft {
  if (keep && savedDraft) return savedDraft;
  savedDraft = fresh;
  return fresh;
}

export function saveDraft(next: MakeDraft): MakeDraft {
  savedDraft = next;
  return next;
}

/** Drops the session draft. Tests start from an empty one. */
export function resetDraft(): void {
  savedDraft = null;
}
