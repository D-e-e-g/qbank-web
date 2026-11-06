import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  api,
  type CourseDetail,
  type ExamSetup,
  type ExamSetupFolder,
  type ExamSummary,
  type ExamView,
  type QuestionMakerStatus,
  type TwinJob,
} from "../api";
import { useCatalogCourse } from "../catalog";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { Switch } from "../components/Switch";
import { useFrozen } from "../frozen";
import { navigate } from "../router";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";
import { folderLabel } from "../course/folders";
import { courseLine, courseName, type ExamPreset } from "../course/pages";
import { useCourseVersion } from "../course/deletion";
import { useCourse, useCourseNaming } from "../course/useCourse";
import { when } from "../when";
import { PastExamList } from "./PastExamList";
import { foldersText, minutesText, practiceFoldersText } from "./names";
import { canTwin, courseTwinJobs, listsTwinJobs, twinJobMeta, twinJobPath, twinJobState, twinJobTitle } from "./twins";

/** How long the plan for new ticks may take before the last one is dimmed. */
const SLOW_PLAN_MS = 300;

/** Exam setup. Opened from an exam page's Start exam, it arrives with that page's folders ticked (`preset`). */
export function ExamSetupScreen({ courseId, preset }: { courseId: string; preset: ExamPreset | null }) {
  const { guard } = useFrozen();
  const course = useCatalogCourse(courseId);
  // Her exam pages and folder order, to group the folders as she sees them.
  const { course: detail, error: detailError } = useCourse(courseId);
  const { words } = useCourseNaming(courseId, detail);
  const [loaded, setLoaded] = useState<{ path: string; setup: ExamSetup; at: number } | null>(null);
  const [slowPath, setSlowPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(preset?.folderIds ?? []));
  const [wrongOnly, setWrongOnly] = useState(false);
  const [starting, setStarting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  // The Twin option and her twin jobs over this course, for the one account that may make questions.
  const [maker, setMaker] = useState<QuestionMakerStatus | null>(null);
  const [twinJobs, setTwinJobs] = useState<TwinJob[] | null>(null);
  const [twinning, setTwinning] = useState(false);
  // A refusal is about the folders and pool it was asked for, so it shows only until she changes them.
  const [twinError, setTwinError] = useState<{ path: string; message: string } | null>(null);
  const error = startError ?? loadError;
  // A deleted past exam, or one brought back, changes the list and her Wrong questions, so the setup is read again.
  const version = useCourseVersion(courseId);
  // The server works out the exam over the ticked folders, so the setup is read again as she ticks.
  // The first read already asks for the folders the exam page ticked.
  const path = setupPath(courseId, ticked, wrongOnly);
  const setup = loaded?.setup ?? null;
  // The last plan stays on screen until the next one arrives. When that takes a moment, it is
  // dimmed, so it is not read as the plan for the folders ticked now.
  const updating = slowPath === path && loaded?.path !== path;

  useEffect(() => {
    document.title = detail ? `${courseName(detail)} Exam · Qbank` : "Exam · Qbank";
  }, [detail]);

  useEffect(() => {
    let cancel = false;
    const slow = setTimeout(() => {
      setSlowPath(path);
    }, SLOW_PLAN_MS);
    void api<ExamSetup>(path)
      .then((body) => {
        if (cancel) return;
        setLoadError(null);
        setLoaded({ path, setup: body, at: Date.now() });
      })
      .catch((caught: unknown) => {
        if (!cancel) setLoadError(caught instanceof ApiError ? caught.message : "Could not load the exam setup.");
      });
    return () => {
      cancel = true;
      clearTimeout(slow);
    };
  }, [path, version]);

  useEffect(() => {
    let cancel = false;
    void api<QuestionMakerStatus>("/api/question-maker")
      .then((status) => {
        if (cancel) return null;
        setMaker(status);
        return listsTwinJobs(status) ? api<{ jobs: TwinJob[] }>("/api/twin-jobs") : null;
      })
      .then((body) => {
        if (!cancel && body !== null) setTwinJobs(courseTwinJobs(body.jobs, courseId));
      })
      .catch((caught: unknown) => {
        console.error(caught);
      });
    return () => {
      cancel = true;
    };
  }, [courseId]);

  const folders = setup?.folders ?? [];
  // Grouped by exam page once the course is read, so a folder never shows under the wrong heading.
  const groups = detail === null && detailError === null ? null : groupByPage(folders, detail);
  // With Wrong questions only on, a folder with none cannot be ticked. Its tick comes back when the switch is off.
  const poolSize = (folder: ExamSetupFolder) => (wrongOnly ? folder.wrongCount : folder.questionCount);
  const picked = folders.filter((folder) => ticked.has(folder.id) && poolSize(folder) > 0);
  // The server's plan for the ticked folders. After a tick, the last plan shows until the new one arrives.
  const preview = picked.length > 0 ? (setup?.preview ?? null) : null;
  const drawnByFolder = new Map((preview?.folders ?? []).map((folder) => [folder.id, folder.drawn]));
  // Folders without an exam bank, named only once the course has one.
  const fallback = preview?.practiceWeeks ?? [];
  const rules = setup?.rules ?? null;
  const noneWrong = folders.every((folder) => folder.wrongCount === 0);
  // The folders the exam page ticked that this course can still draw from.
  const presetCount = preset === null ? 0 : folders.filter((folder) => preset.folderIds.includes(folder.id) && folder.questionCount > 0).length;
  const label = (id: string, name: string) => (detail ? folderLabel(detail, id, name) : name);

  const start = () => {
    setReplacing(false);
    setStarting(true);
    setStartError(null);
    const json = { folderIds: picked.map((folder) => folder.id), pool: wrongOnly ? "wrong" : "all" };
    void api<ExamView>(`/api/courses/${courseId}/exams`, { method: "POST", json })
      .then((exam) => {
        navigate(`/course/${courseId}/exam/${exam.id}`);
      })
      .catch((caught: unknown) => {
        setStarting(false);
        setStartError(caught instanceof ApiError ? caught.message : "Could not start the exam.");
      });
  };

  // Instead of an exam on these questions, QBank writes exam twins of them; its page follows the job.
  const twin = () => {
    setTwinning(true);
    setTwinError(null);
    const json = { courseId, folderIds: picked.map((folder) => folder.id), pool: wrongOnly ? "wrong" : "all" };
    void api<TwinJob>("/api/twin-jobs", { method: "POST", json })
      .then((job) => {
        navigate(twinJobPath(courseId, job.id));
      })
      .catch((caught: unknown) => {
        setTwinning(false);
        setTwinError({ path, message: caught instanceof ApiError ? caught.message : "Could not start the exam twins." });
      });
  };

  const dismiss = useCallback(() => {
    setReplacing(false);
  }, []);

  return (
    <Screen title="Exam">
      <ShellLink to={`/course/${courseId}`} className="text-action" current={false}>
        {words.Container}
      </ShellLink>
      <p className="note">{course ? courseLine(course) : "A timed exam over the folders you pick"}</p>
      {error ? <p className="form-error">{error}</p> : null}
      {setup === null && error === null ? <p className="note">Loading the exam setup.</p> : null}
      {setup?.inProgress ? <RunningExam exam={setup.inProgress} loadedAt={loaded?.at ?? 0} /> : null}
      {setup !== null && folders.length === 0 ? (
        <div className="empty-card">
          <EmptyState icon="timer" message={`This ${words.container} has no questions yet. An exam draws from the folders your sets are in.`} />
        </div>
      ) : null}
      {folders.length > 0 ? (
        <ul className="review-list">
          <li>
            <label className="review-row switch-row">
              <span className="review-copy">
                <span className="review-topic">Wrong questions only</span>
                <span className="review-meta">Last answer not fully right</span>
              </span>
              <Switch checked={wrongOnly} onChange={setWrongOnly} />
            </label>
          </li>
        </ul>
      ) : null}
      {folders.length > 0 ? (
        <section className="group" aria-busy={updating || undefined}>
          <h2 className="group-header">Folders this exam covers</h2>
          {preset !== null && presetCount > 0 ? (
            <p className="group-footer exam-preset">
              {preset.name} · {presetCount} {presetCount === 1 ? "folder" : "folders"} ticked for you
            </p>
          ) : null}
          {groups === null ? <p className="note">Loading the folders.</p> : null}
          {(groups ?? []).map((group) => (
            <div key={group.key} className="exam-folder-group">
              {group.title === null ? null : <h3 className="folder-subhead">{group.title}</h3>}
              <ul className="review-list" aria-label={group.title ?? "Folders"}>
                {group.folders.map((folder) => {
                  const open = poolSize(folder) > 0;
                  const checked = open && ticked.has(folder.id);
                  const drawn = drawnByFolder.get(folder.id);
                  const meta = folderLine(folder, wrongOnly);
                  return (
                    <li key={folder.id}>
                      <label className={open ? "review-row tick-row" : "review-row tick-row tick-row-off"}>
                        <input
                          type="checkbox"
                          className="tick-check"
                          checked={checked}
                          disabled={!open}
                          onChange={(event) => {
                            const on = event.target.checked;
                            setTicked((current) => {
                              const next = new Set(current);
                              if (on) next.add(folder.id);
                              else next.delete(folder.id);
                              return next;
                            });
                          }}
                        />
                        <span className="review-copy">
                          <span className="review-topic">{folder.name}</span>
                          <span className="review-meta">{meta}</span>
                        </span>
                        {checked && drawn !== undefined ? <span className="tick-drawn">{drawn} in exam</span> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="group-footer">
            {wrongOnly
              ? "Questions are drawn only from the wrong ones in the folders you tick, in proportion to how many each folder has."
              : "Questions are drawn only from the folders you tick, in proportion to each folder’s size."}
          </p>
        </section>
      ) : null}
      {folders.length > 0 ? (
        <div className="exam-summary" aria-live="polite" aria-busy={updating || undefined}>
          {preview ? (
            <p className="exam-summary-head">
              <span className="exam-summary-count">
                {preview.questionCount} {preview.questionCount === 1 ? "question" : "questions"}
              </span>
              <span className="exam-summary-time">in {minutesText(preview.timeLimitSeconds)}</span>
            </p>
          ) : null}
          <p className="exam-summary-split">
            {picked.length === 0
              ? wrongOnly
                ? noneWrong
                  ? `No wrong questions in this ${words.container} right now.`
                  : "Tick at least one folder with wrong questions."
                : "Tick at least one folder."
              : (preview?.folders ?? []).map((folder) => `${String(folder.drawn)} from ${label(folder.id, folder.name)}`).join(" · ")}
            {preview && rules && preview.questionCount < rules.maxQuestions
              ? ` · Fewer than ${String(rules.maxQuestions)}, so it’s all of them at ${minutesText(rules.secondsPerQuestion)} each.`
              : ""}
          </p>
          {fallback.length > 0 ? <p className="exam-summary-split">{practiceFoldersText(fallback, "before")}</p> : null}
          <p className="exam-summary-note">Feedback comes at the end. Leaving midway ends the exam and scores what you answered.</p>
          <Button
            fullWidth
            className="btn-lg"
            disabled={picked.length === 0 || starting || twinning}
            onClick={guard(() => {
              if (setup?.inProgress) setReplacing(true);
              else start();
            })}
          >
            Start exam
          </Button>
          {canTwin(maker) ? (
            <>
              <p className="exam-summary-note">
                Or QBank writes a new exam twin of each {wrongOnly ? "wrong question" : "question"} in the folders you tick, and you take the exam on the
                twins. Your questions stay as they are.
              </p>
              {twinError?.path === path ? <p className="form-error">{twinError.message}</p> : null}
              <Button variant="secondary" fullWidth className="btn-lg" disabled={picked.length === 0 || starting || twinning} onClick={guard(twin)}>
                Write exam twins
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {twinJobs !== null && twinJobs.length > 0 ? <TwinJobs courseId={courseId} jobs={twinJobs} /> : null}
      {setup !== null && folders.length > 0 ? <PastExams courseId={courseId} exams={setup.exams} /> : null}
      {replacing ? (
        <ConfirmSheet
          title="Start a new exam?"
          message="The exam in progress ends now. What you answered on it is scored, and the rest score 0."
          confirmLabel="Start new exam"
          onConfirm={start}
          onCancel={dismiss}
        />
      ) : null}
    </Screen>
  );
}

function RunningExam({ exam, loadedAt }: { exam: ExamSummary; loadedAt: number }) {
  const minutesLeft = Math.max(1, Math.ceil((new Date(exam.endsAt).getTime() - loadedAt) / 60_000));
  const answered = `${String(exam.answeredCount)} of ${String(exam.questionCount)} answered`;
  return (
    <ul className="review-list">
      <li>
        <button
          type="button"
          className="review-row"
          onClick={() => {
            navigate(`/course/${exam.courseId}/exam/${exam.id}`);
          }}
        >
          <span className="row-icon">
            <Icon name="timer" size={20} />
          </span>
          <span className="review-copy">
            <span className="review-topic">Exam in progress</span>
            <span className="review-meta">
              {foldersText(exam.weeks)}
              {exam.pool === "wrong" ? " · Wrong questions only" : ""} · {answered} · {minutesLeft} min left
            </span>
          </span>
          <span className="exam-resume">Resume</span>
          <span className="review-chevron">
            <Icon name="chevron-right" size={18} />
          </span>
        </button>
      </li>
    </ul>
  );
}

/** Her exam twins over this course, newest first, so a job is found again after she leaves its page. */
function TwinJobs({ courseId, jobs }: { courseId: string; jobs: readonly TwinJob[] }) {
  return (
    <section className="group">
      <h2 className="group-header">Exam twins</h2>
      <ul className="review-list" aria-label="Exam twins">
        {jobs.map((job) => (
          <li key={job.id}>
            <button
              type="button"
              className="review-row"
              onClick={() => {
                navigate(twinJobPath(courseId, job.id));
              }}
            >
              <span className="review-copy">
                <span className="review-topic">
                  {twinJobTitle(job)} · {when(job.createdAt)}
                </span>
                <span className="review-meta">{twinJobMeta(job)}</span>
              </span>
              <span className={`twin-state twin-state-${job.status}`}>{twinJobState(job)}</span>
              <span className="review-chevron">
                <Icon name="chevron-right" size={18} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PastExams({ courseId, exams }: { courseId: string; exams: ExamSummary[] }) {
  return (
    <PastExamList
      courseId={courseId}
      exams={exams}
      title="Past exams"
      empty={
        <div className="empty-card">
          <EmptyState icon="timer" message="Exams you finish show up here with their scores." />
        </div>
      }
    />
  );
}

/**
 * The setup's address. With folders ticked it also asks for `preview`, the exam over them, from all
 * their questions or only the wrong ones. The order of the folders does not matter to the server.
 */
function setupPath(courseId: string, ticked: ReadonlySet<string>, wrongOnly: boolean): string {
  if (ticked.size === 0) return `/api/courses/${courseId}/exams`;
  const folders = [...ticked].sort().map((id): [string, string] => ["folderIds", id]);
  const query = new URLSearchParams([...folders, ["pool", wrongOnly ? "wrong" : "all"]]);
  return `/api/courses/${courseId}/exams?${query.toString()}`;
}

/**
 * The folders by exam page, then the ones on no exam page, so same names on two pages stay apart.
 * The server sends them in the course's order, which each group keeps. Without the course (it
 * could not be read), the page names are unknown, so the folders are one list with no heading.
 */
function groupByPage(folders: readonly ExamSetupFolder[], course: CourseDetail | null): { key: string; title: string | null; folders: ExamSetupFolder[] }[] {
  if (course === null) return [{ key: "all", title: null, folders: [...folders] }];
  const pages = course.exams;
  const groups: { key: string; title: string | null; folders: ExamSetupFolder[] }[] = pages.map((page) => ({
    key: page.id,
    title: page.name,
    folders: folders.filter((folder) => folder.examPageId === page.id),
  }));
  const known = new Set(pages.map((page) => page.id));
  groups.push({
    key: "loose",
    title: "On no page",
    folders: folders.filter((folder) => folder.examPageId === null || !known.has(folder.examPageId)),
  });
  return groups.filter((group) => group.folders.length > 0);
}

/** "27 questions", or "7 wrong of 20" with Wrong questions only on, and "· exam bank" when the folder has one. */
function folderLine(folder: ExamSetupFolder, wrongOnly: boolean): string {
  const count = wrongOnly
    ? `${String(folder.wrongCount)} wrong of ${String(folder.questionCount)}`
    : `${String(folder.questionCount)} ${folder.questionCount === 1 ? "question" : "questions"}`;
  return folder.source === "exam" ? `${count} · exam bank` : count;
}
