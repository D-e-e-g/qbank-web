import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  api,
  isConflict,
  type CourseDetail,
  type ImportConflict,
  type ImportReport,
  type ImportedSet,
} from "../api";
import { courseMenu, courseStanding, findCourse, refreshCatalog, useCatalog, type CourseLink } from "../catalog";
import { Button } from "../components/Button";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { CourseFieldWaiting } from "../components/CourseFieldWaiting";
import { FolderPicker, UNSORTED } from "../components/FolderPicker";
import { Icon } from "../components/Icon";
import { SegmentedControl } from "../components/SegmentedControl";
import { TextField } from "../components/TextField";
import { courseLine, courseName, kindWords } from "../course/pages";
import { useFrozen } from "../frozen";
import { MakeHub } from "../make/MakeHub";
import type { FolderChoice } from "../make/states";
import { folderPath, readImportPreset, useSearch } from "../router";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";

type SourceMode = "paste" | "file";

/** What the menu offers besides her courses and topics: a new course, or a new topic. */
const NEW_COURSE = "new";
const NEW_TOPIC = "new-topic";

/**
 * Import. The + of a course or an exam page opens it with `?course=` picked (an exam page adds `?page=`,
 * which lists that page's folders first), and a folder's + or "Import here" adds `?folder=`, picked. The set
 * goes to Unsorted unless she picks a folder.
 */
export function ImportScreen() {
  const { guard } = useFrozen();
  const catalog = useCatalog();
  const search = useSearch();
  const [preset] = useState(() => readImportPreset(search));
  const [mode, setMode] = useState<SourceMode>("paste");
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [courseId, setCourseId] = useState(preset?.courseId ?? NEW_COURSE);
  const [code, setCode] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const [topicTitle, setTopicTitle] = useState("");
  const [semesterNumber, setSemesterNumber] = useState("1");
  const [course, setCourse] = useState<CourseDetail | null>(null);
  // Counts imports, so the picker reads the course's folders again after one made a folder.
  const [imports, setImports] = useState(0);
  const [folder, setFolder] = useState<FolderChoice>(preset?.folderId ? { kind: "folder", id: preset.folderId } : { kind: "unsorted" });
  const [newFolder, setNewFolder] = useState("");
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [conflict, setConflict] = useState<ImportConflict | null>(null);
  const [done, setDone] = useState<{ set: ImportedSet; examPageName: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const { courses, topics } = courseMenu(catalog);
  // Until the catalog is ready nothing says whether the picked course is one of the account's, so
  // the form offers neither the menu nor a new course, and Import waits: a course not known yet is
  // not a new one.
  const standing = courseStanding(catalog, courseId);
  const known = standing === "theirs";
  const newTopic = courseId === NEW_TOPIC;
  const newCourse = standing === "not-theirs" && !newTopic;

  // Her folders in the picked course, for the picker. A new course has none yet.
  useEffect(() => {
    if (courseId === NEW_COURSE || courseId === NEW_TOPIC) return;
    let cancel = false;
    void api<CourseDetail>(`/api/courses/${courseId}`)
      .then((body) => {
        if (!cancel) setCourse(body);
      })
      .catch(() => {
        if (!cancel) setCourse(null);
      });
    return () => {
      cancel = true;
    };
  }, [courseId, imports]);

  const chooseCourse = (next: string) => {
    setCourseId(next);
    setCourse(null);
    setFolder({ kind: "unsorted" });
  };

  const check = () => {
    setError(null);
    setCopied(false);
    setBusy(true);
    void api<ImportReport>("/api/imports/check", { method: "POST", json: { source } })
      .then((next) => {
        setReport(next);
        if (!titleEdited && next.title) setTitle(next.title);
      })
      .catch((caught: unknown) => {
        setReport(null);
        setError(caught instanceof ApiError ? caught.message : "Could not check that file.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const commit = (decision: "import" | "replace" | "separate") => {
    if (standing === "unknown-yet") return;
    setConflict(null);
    setError(null);
    setBusy(true);
    const json: Record<string, unknown> = { source, decision };
    if (title.trim()) json.title = title.trim();
    if (newTopic) {
      json.newTopic = { title: topicTitle.trim() };
    } else if (newCourse) {
      json.newCourse = { code: code.trim(), title: courseTitle.trim(), semesterNumber: Number(semesterNumber) };
    } else {
      json.courseId = courseId;
    }
    // Unsorted is the server's default, so it is sent as no folder at all.
    if (folder.kind === "folder") json.folderId = folder.id;
    if (folder.kind === "new") json.folderName = newFolder.trim();
    void api<ImportedSet>("/api/imports", { method: "POST", json })
      .then(async (imported) => {
        await refreshCatalog();
        // Done names the exam page the folder is on, read from the course it landed in.
        const landed = imported.examPageId === null ? null : await api<CourseDetail>(`/api/courses/${imported.courseId}`).catch(() => null);
        setDone({ set: imported, examPageName: landed?.exams.find((page) => page.id === imported.examPageId)?.name ?? null });
      })
      .catch((caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 409 && isConflict(caught.body)) {
          setConflict(caught.body);
          return;
        }
        setError(caught instanceof ApiError ? caught.message : "Could not import that file.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const dismissConflict = useCallback(() => {
    setConflict(null);
  }, []);

  if (done) {
    const { set, examPageName } = done;
    // The catalog was read again before Done, so it has a course or topic the import just made.
    const landed = findCourse(catalog, set.courseId);
    const where =
      examPageName !== null
        ? ` It is on ${examPageName}.`
        : set.folderName === UNSORTED
          ? ` It is in the ${kindWords(landed?.kind ?? "course").container}’s Folders list until you move it.`
          : "";
    return (
      <Screen title="Import">
        <div className="done">
          <span className="done-mark">
            <Icon name={set.kind === "replaced" ? "rotate-ccw" : "check"} size={30} />
          </span>
          <h2 className="done-title">{set.kind === "replaced" ? "Replaced" : "Imported"}</h2>
          <p className="done-copy">
            “{set.title}” · {set.questionCount} {set.setKind === "exam" ? "exam " : ""}
            {set.questionCount === 1 ? "question" : "questions"} in {landed ? courseName(landed) : set.courseCode}, {set.folderName}.{where}
            {set.setKind === "exam" ? " Exams now ask them instead of that folder’s practice questions." : ""}
            {set.kind === "replaced" ? " The previous version can be restored from its folder." : ""}
          </p>
        </div>
        <ShellLink to={folderPath(set.courseId, set.folderId)} className="btn btn-secondary btn-full" current={false}>
          Open {set.folderName}
        </ShellLink>
        <Button
          variant="plain"
          fullWidth
          onClick={() => {
            // The next file goes to the same course, and to Unsorted unless she picks a folder.
            setDone(null);
            setCourseId(set.courseId);
            setFolder({ kind: "unsorted" });
            setNewFolder("");
            setImports(imports + 1);
            setReport(null);
            setSource("");
            setFileName(null);
            setTitle("");
            setTitleEdited(false);
          }}
        >
          Import another file
        </Button>
      </Screen>
    );
  }

  return (
    <Screen title="Import">
      <MakeHub />
      <SegmentedControl
        label="How to add the file"
        value={mode}
        options={[
          { value: "paste", label: "Paste JSON" },
          { value: "file", label: "Choose file" },
        ]}
        onChange={setMode}
      />
      {mode === "paste" ? (
        <TextField
          label="Paste JSON"
          multiline
          mono
          value={source}
          hint="Paste the JSON from your agent."
          onChange={(value) => {
            setSource(value);
            setReport(null);
          }}
        />
      ) : (
        <label className="file-pick">
          <Icon name="file-json" size={24} />
          <span className="file-pick-copy">
            <span className="file-pick-name">{fileName ?? "Choose a JSON file"}</span>
            <span className="field-hint">From Files or iCloud Drive.</span>
          </span>
          <input
            className="file-input"
            type="file"
            accept="application/json,.json,text/plain"
            aria-label="Question file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              void file.text().then((text) => {
                setSource(text);
                setReport(null);
              });
            }}
          />
        </label>
      )}

      <div className="form-grid">
        {standing === "unknown-yet" ? (
          <CourseFieldWaiting catalog={catalog} />
        ) : (
          <label className="field">
            <span className="field-label">Course</span>
            <select
              className="control"
              aria-label="Course"
              value={known || newTopic ? courseId : NEW_COURSE}
              onChange={(event) => {
                chooseCourse(event.target.value);
              }}
            >
              {/* Her courses as they always were; once she has a topic, her courses and topics in two groups. */}
              {topics.length === 0 ? (
                <CourseOptions courses={courses} />
              ) : (
                <>
                  {courses.length === 0 ? null : (
                    <optgroup label="Courses">
                      <CourseOptions courses={courses} />
                    </optgroup>
                  )}
                  <optgroup label="Study topics">
                    <CourseOptions courses={topics} />
                  </optgroup>
                </>
              )}
              <option value={NEW_COURSE}>New course</option>
              <option value={NEW_TOPIC}>New topic</option>
            </select>
          </label>
        )}
        <FolderPicker course={known ? course : null} firstPageId={courseId === preset?.courseId ? preset.examPageId : null} value={folder} newName={newFolder} onChange={setFolder} onNewName={setNewFolder} />
        {newTopic ? <TextField label="Topic name" value={topicTitle} onChange={setTopicTitle} /> : null}
        {newCourse ? (
          <>
            <TextField label="Course code" value={code} onChange={setCode} />
            <TextField label="Course name" value={courseTitle} onChange={setCourseTitle} />
            <label className="field">
              <span className="field-label">Semester</span>
              <select
                className="control"
                aria-label="Semester"
                value={semesterNumber}
                onChange={(event) => {
                  setSemesterNumber(event.target.value);
                }}
              >
                <option value="1">Semester 1</option>
                <option value="2">Semester 2</option>
                <option value="3">Semester 3</option>
              </select>
            </label>
          </>
        ) : null}
        <TextField
          label="Set name"
          value={title}
          hint="Filled from the file’s title. You can change it."
          onChange={(value) => {
            setTitle(value);
            setTitleEdited(true);
          }}
        />
      </div>

      {report?.ok === true ? (
        <div className="ready">
          <span className="ready-title">
            <Icon name="circle-check" size={20} />
            Ready: {report.questionCount} {report.questionCount === 1 ? "question" : "questions"}, {report.termCount}{" "}
            {report.termCount === 1 ? "term" : "terms"}
          </span>
          {report.kind === "exam" ? (
            <p className="ready-note">An exam set: its questions are asked only on exams over its folder, never in practice or Review.</p>
          ) : null}
          <div className="chips">
            {report.formats.map((format) => (
              <span key={format.type} className="chip">
                {format.count} {format.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {report && report.errors.length > 0 ? (
        <div className="issues issues-error">
          <ul>
            {report.errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(report.errors.join("\n")).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? "Copied" : "Copy these for your agent"}
          </Button>
        </div>
      ) : null}
      {report && report.warnings.length > 0 ? (
        <ul className="issues issues-warning">
          {report.warnings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}

      {report?.ok === true ? (
        <Button fullWidth disabled={busy || standing === "unknown-yet"} onClick={guard(() => { commit("import"); })}>
          Import
        </Button>
      ) : (
        <Button fullWidth disabled={busy || source.trim() === ""} onClick={check}>
          Check file
        </Button>
      )}

      {conflict ? (
        <ConfirmSheet
          title={`Replace “${conflict.title}”?`}
          message={`${conflictName(conflict, findCourse(catalog, conflict.courseId))}, ${conflict.folderName} already has a set with this name. Replacing swaps its ${String(conflict.existingQuestionCount)} questions for the ${String(conflict.incomingQuestionCount)} in this file, and it stays in ${conflict.folderName}. Answers on unchanged questions are kept, and the old version stays restorable.`}
          confirmLabel="Replace"
          secondaryLabel="Import as a separate set"
          onConfirm={() => {
            commit("replace");
          }}
          onSecondary={() => {
            commit("separate");
          }}
          onCancel={dismissConflict}
        />
      ) : null}
    </Screen>
  );
}

/** Her courses by code and name, or her topics by name. */
export function CourseOptions({ courses }: { courses: readonly CourseLink[] }) {
  return courses.map((course) => (
    <option key={course.id} value={course.id}>
      {courseLine(course)}
    </option>
  ));
}

/** The course or topic a replace is in, as the rest of the screens call it. */
function conflictName(conflict: ImportConflict, landed: CourseLink | undefined): string {
  return landed ? courseName(landed) : conflict.courseCode || conflict.courseTitle;
}
