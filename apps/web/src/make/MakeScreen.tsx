import { useEffect, useId, useRef, useState } from "react";
import { api, type CourseDetail, type QuestionJob, type QuestionLevel, type QuestionMakerStatus } from "../api";
import { homeLayout, useCatalog, type CourseLink } from "../catalog";
import { Button } from "../components/Button";
import { FolderPicker } from "../components/FolderPicker";
import { Icon } from "../components/Icon";
import { SegmentedControl } from "../components/SegmentedControl";
import { Switch } from "../components/Switch";
import { TextField } from "../components/TextField";
import { courseLine } from "../course/pages";
import { makeJobPath, readMakeQuery, redirect, useSearch } from "../router";
import { CourseOptions } from "../screens/ImportScreen";
import { Screen } from "../shell/Screen";
import { ShellLink } from "../shell/ShellLink";
import { fileBase64, fileMediaType, jpegBase64 } from "./files";
import {
  buildJob,
  canContinue,
  canMake,
  chooseLevel,
  defaultCourseId,
  countRange,
  countText,
  freshDraft,
  isCopies,
  LEVELS_NOTE,
  levelName,
  photoLine,
  problemText,
  questionKinds,
  saveDraft,
  stepText,
  takeDraft,
  writingTime,
  type FolderChoice,
  type MakeDraft,
  type MaterialSource,
} from "./states";

interface ReferenceGroup {
  id: string;
  title: string;
  sets: { id: string; title: string }[];
}

/**
 * Your material, then level and count. Photos of practice questions skip the level and start at
 * once. The iPhone's camera and photo library are the browser's file picker, which offers both.
 */
export function MakeScreen() {
  const search = useSearch();
  const [{ courseId: preset, keep }] = useState(() => readMakeQuery(search));
  const catalog = useCatalog();
  const [status, setStatus] = useState<QuestionMakerStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<MakeDraft>(() => takeDraft(freshDraft(null, preset), keep));
  const [step, setStep] = useState<"material" | "level">("material");
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [references, setReferences] = useState<ReferenceGroup[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const levelEdited = useRef(keep);

  useEffect(() => {
    const closed = status !== null && !canMake(status) && !keep;
    const title = closed ? "Make questions" : step === "level" ? "Level and count" : "Your material";
    document.title = `${title} · Qbank`;
  }, [step, status, keep]);

  useEffect(() => {
    let cancel = false;
    void api<QuestionMakerStatus>("/api/question-maker")
      .then((next) => {
        if (cancel) return;
        setStatus(next);
        setDraft((current) => {
          if (levelEdited.current) return current;
          const level = next.defaultLevel;
          return saveDraft({ ...current, level, count: countRange(next, level).defaultCount });
        });
      })
      .catch((error: unknown) => {
        if (!cancel) setProblem(problemText(error));
      })
      .finally(() => {
        if (!cancel) setReady(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!catalog.fromServer) return;
    const listed = homeLayout(catalog);
    const courseList = listed.semesters.flatMap(({ semester, courses: inUse }) => (semester.placeholder ? [] : inUse));
    const topicList = listed.topics;
    const held = (id: string | null) => id !== null && [...courseList, ...topicList].some((item) => item.id === id);
    if (held(draft.courseId) || (courseList.length === 0 && topicList.length === 0)) return;
    let cancel = false;
    void api<{ courseId: string | null }>("/api/me/place")
      .then((place) => place.courseId)
      .catch(() => null)
      .then((place) => {
        if (cancel) return;
        const id = defaultCourseId(courseList, topicList, place);
        setDraft((current) => {
          if (held(current.courseId) || id === null) return current;
          return saveDraft({ ...current, courseId: id });
        });
      });
    return () => {
      cancel = true;
    };
  }, [catalog, draft.courseId]);

  useEffect(() => {
    if (!draft.courseId) return;
    let cancel = false;
    void api<CourseDetail>(`/api/courses/${draft.courseId}`)
      .then((body) => {
        if (!cancel) setCourse(body);
      })
      .catch(() => {
        if (!cancel) setCourse(null);
      });
    return () => {
      cancel = true;
    };
  }, [draft.courseId]);

  useEffect(() => {
    if (step !== "level" || references !== null || !catalog.fromServer) return;
    let cancel = false;
    const layout = homeLayout(catalog);
    const courses = [...layout.semesters.flatMap((semester) => semester.courses), ...layout.topics];
    void Promise.all(
      courses.map(async (item) => {
        const detail = await api<CourseDetail>(`/api/courses/${item.id}`).catch(() => null);
        const sets = detail?.folders.flatMap((folder) => folder.sets).map((set) => ({ id: set.id, title: set.title })) ?? [];
        return sets.length === 0 ? null : { id: item.id, title: courseLine(item), sets };
      }),
    ).then((groups) => {
      if (!cancel) setReferences(groups.filter((group) => group !== null));
    });
    return () => {
      cancel = true;
    };
  }, [step, references, catalog]);

  const update = (patch: (current: MakeDraft) => MakeDraft) => {
    setProblem(null);
    setDraft((current) => saveDraft(patch(current)));
  };

  const layout = homeLayout(catalog);
  const courses = layout.semesters.flatMap(({ semester, courses: inUse }) => (semester.placeholder ? [] : inUse));
  const topics = layout.topics;
  const known = courses.some((item) => item.id === draft.courseId) || topics.some((item) => item.id === draft.courseId);
  // A native select shows its first option while the value is empty, which would look picked and
  // load no folders. Stay on "Loading" until the course is one of hers, or she has none.
  const catalogReady = catalog.fromServer && (known || (courses.length === 0 && topics.length === 0));
  const maxPhotos = status?.limits.photos ?? 20;
  const copies = isCopies(draft);
  const range = countRange(status, draft.level);

  const start = () => {
    const body = buildJob(draft);
    if (!body) return;
    setProblem(null);
    setStarting(true);
    void api<QuestionJob>("/api/question-jobs", { method: "POST", json: body })
      .then((started) => {
        redirect(makeJobPath(started.id));
      })
      .catch((error: unknown) => {
        setProblem(problemText(error));
        setStarting(false);
      });
  };

  if (!ready) {
    return (
      <Screen title="Your material">
        <p className="note">Loading.</p>
      </Screen>
    );
  }

  // A fresh visit while the server says no: the same sentence the Add tab shows, and no form.
  if (status && !canMake(status) && !keep) {
    return (
      <Screen title="Make questions">
        <ShellLink to="/import" className="text-action" current={false}>
          Import
        </ShellLink>
        <p className="note">{status.reason}</p>
      </Screen>
    );
  }

  return (
    <Screen title={step === "level" ? "Level and count" : "Your material"}>
      <p className="make-step">{step === "level" ? stepText(2, 4) : stepText(1, copies ? 2 : 4)}</p>
      {step === "material" ? (
        <ShellLink to="/import" className="text-action" current={false}>
          Import
        </ShellLink>
      ) : (
        <button
          type="button"
          className="text-action"
          onClick={() => {
            setStep("material");
          }}
        >
          Your material
        </button>
      )}
      {step === "material" ? (
        <MaterialStep
          draft={draft}
          courses={courses}
          topics={topics}
          known={known}
          catalogReady={catalogReady}
          course={known ? course : null}
          maxPhotos={maxPhotos}
          copies={copies}
          starting={starting}
          onChange={update}
          onLevel={() => {
            levelEdited.current = true;
            setStep("level");
          }}
          onStart={start}
          onPhotoProblem={setProblem}
        />
      ) : (
        <LevelStep
          draft={draft}
          status={status}
          range={range}
          references={references}
          starting={starting}
          onChange={(next) => {
            levelEdited.current = true;
            update(() => next);
          }}
          onStart={start}
        />
      )}
      {problem ? <p className="form-error">{problem}</p> : null}
    </Screen>
  );
}

function MaterialStep({
  draft,
  courses,
  topics,
  known,
  catalogReady,
  course,
  maxPhotos,
  copies,
  starting,
  onChange,
  onLevel,
  onStart,
  onPhotoProblem,
}: {
  draft: MakeDraft;
  courses: CourseLink[];
  topics: CourseLink[];
  known: boolean;
  catalogReady: boolean;
  course: CourseDetail | null;
  maxPhotos: number;
  copies: boolean;
  starting: boolean;
  onChange: (patch: (current: MakeDraft) => MakeDraft) => void;
  onLevel: () => void;
  onStart: () => void;
  onPhotoProblem: (message: string) => void;
}) {
  const photoInput = useId();
  const addPhotos = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    void (async () => {
      let added = 0;
      let failed = 0;
      for (const file of files) {
        if (draft.photos.length + added >= maxPhotos) break;
        const data = await jpegBase64(file);
        if (!data) {
          failed += 1;
          continue;
        }
        added += 1;
        const id = crypto.randomUUID();
        onChange((current) => (current.photos.length >= maxPhotos ? current : { ...current, photos: [...current.photos, { id, mediaType: "image/jpeg", data }] }));
      }
      if (added === 0 && failed > 0) onPhotoProblem("That photo could not be opened. Try choosing it again.");
    })();
  };

  return (
    <>
      <SegmentedControl
        label="Material"
        value={draft.source}
        options={[
          { value: "paste", label: "Paste" },
          { value: "photos", label: "Photos" },
          { value: "file", label: "File" },
        ]}
        onChange={(source: MaterialSource) => {
          onChange((current) => ({ ...current, source }));
        }}
      />
      {draft.source === "paste" ? (
        <TextField
          label="Your notes"
          multiline
          value={draft.text}
          hint="Paste or type your lecture notes. QBank writes new questions from them."
          onChange={(text) => {
            onChange((current) => ({ ...current, text }));
          }}
        />
      ) : null}
      {draft.source === "photos" ? (
        <>
          <section className="group">
            <h2 className="group-header">What is in the photos</h2>
            <ul className="list-group">
              <HoldingRow
                title="Notes or slides"
                detail="QBank writes new questions from them"
                picked={draft.holding === "notes"}
                onPick={() => {
                  onChange((current) => ({ ...current, holding: "notes" }));
                }}
              />
              <HoldingRow
                title="Practice questions"
                detail="A quiz, a worksheet, a review book page: QBank copies them in as they are"
                picked={draft.holding === "questions"}
                onPick={() => {
                  onChange((current) => ({ ...current, holding: "questions" }));
                }}
              />
            </ul>
          </section>
          <div className="photo-grid">
            {draft.photos.map((photo) => (
              <div key={photo.id} className="photo-tile">
                <img src={`data:image/jpeg;base64,${photo.data}`} alt="Photo" />
                <button
                  type="button"
                  className="photo-remove"
                  aria-label="Remove photo"
                  onClick={() => {
                    onChange((current) => ({ ...current, photos: current.photos.filter((item) => item.id !== photo.id) }));
                  }}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            {draft.photos.length < maxPhotos ? (
              <label className="photo-add" htmlFor={photoInput}>
                <Icon name="camera" size={22} />
                Take or
                <br />
                choose photo
                <input
                  id={photoInput}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    addPhotos(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
          <p className="field-hint">{photoLine(draft.photos.length, maxPhotos, draft.holding)} Paste takes typed notes; File takes a PDF of slides.</p>
        </>
      ) : null}
      {draft.source === "file" ? (
        <label className="file-pick">
          <Icon name="file-json" size={24} />
          <span className="file-pick-copy">
            <span className="file-pick-name">{draft.file?.name ?? "Choose a PDF or text file"}</span>
            <span className="field-hint">Slides saved as a PDF, or typed notes, from Files or iCloud Drive.</span>
          </span>
          <input
            className="file-input"
            type="file"
            accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown"
            aria-label="Choose a PDF or text file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void fileBase64(file)
                .then((data) => {
                  onChange((current) => ({ ...current, file: { name: file.name, mediaType: fileMediaType(file.name, file.type), data } }));
                })
                .catch(() => {
                  onPhotoProblem("That file could not be opened. Try choosing it again.");
                });
            }}
          />
        </label>
      ) : null}
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Course</span>
          {catalogReady ? (
            <select
              className="control"
              aria-label="Course"
              value={known ? (draft.courseId ?? "") : ""}
              onChange={(event) => {
                const courseId = event.target.value === "" ? null : event.target.value;
                onChange((current) => ({ ...current, courseId, folder: { kind: "unsorted" }, newFolder: "" }));
              }}
            >
              {courses.length === 0 && topics.length === 0 ? <option value="">No courses yet</option> : null}
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
            </select>
          ) : (
            <p className="note">Loading your courses</p>
          )}
        </label>
        <FolderPicker
          course={course}
          firstPageId={null}
          value={draft.folder}
          newName={draft.newFolder}
          onChange={(folder: FolderChoice) => {
            onChange((current) => ({ ...current, folder }));
          }}
          onNewName={(newFolder) => {
            onChange((current) => ({ ...current, newFolder }));
          }}
        />
      </div>
      {copies ? (
        <TwinRow
          checked={draft.examTwins}
          detail="So the exam asks it in new words"
          onChange={(examTwins) => {
            onChange((current) => ({ ...current, examTwins }));
          }}
        />
      ) : null}
      <Button fullWidth className="btn-lg" disabled={!canContinue(draft) || starting} onClick={copies ? onStart : onLevel}>
        {copies ? "Find the questions" : "Next"}
      </Button>
    </>
  );
}

function HoldingRow({ title, detail, picked, onPick }: { title: string; detail: string; picked: boolean; onPick: () => void }) {
  return (
    <li>
      <button type="button" className="list-row" aria-pressed={picked} onClick={onPick}>
        <span className="list-icon">
          <Icon name={picked ? "circle-check" : "circle"} size={22} />
        </span>
        <span className="list-copy">
          <span className="list-title">{title}</span>
          <span className="list-meta">{detail}</span>
        </span>
      </button>
    </li>
  );
}

function LevelStep({
  draft,
  status,
  range,
  references,
  starting,
  onChange,
  onStart,
}: {
  draft: MakeDraft;
  status: QuestionMakerStatus | null;
  range: { min: number; max: number };
  references: ReferenceGroup[] | null;
  starting: boolean;
  onChange: (next: MakeDraft) => void;
  onStart: () => void;
}) {
  const kinds = questionKinds(draft.level);
  const referenceTitle = references?.flatMap((group) => group.sets).find((set) => set.id === draft.referenceSetId)?.title ?? "None";
  return (
    <>
      <section className="group">
        <h2 className="group-header">Level</h2>
        <SegmentedControl
          label="Level"
          value={draft.level}
          options={(["exam", "course", "board"] as const).map((level) => ({ value: level, label: levelName(level) }))}
          onChange={(level: QuestionLevel) => {
            onChange(chooseLevel(draft, status, level));
          }}
        />
        <p className="field-hint">{LEVELS_NOTE}</p>
      </section>
      <label className="field">
        <span className="field-label">Measured against</span>
        <select
          className="control"
          aria-label={`Measured against: ${referenceTitle}`}
          disabled={draft.level !== "exam"}
          value={draft.referenceSetId ?? ""}
          onChange={(event) => {
            const referenceSetId = event.target.value === "" ? null : event.target.value;
            onChange({ ...draft, referenceSetId });
          }}
        >
          <option value="">None</option>
          {(references ?? []).map((group) => (
            <optgroup key={group.id} label={group.title}>
              {group.sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="field-hint">Exam level only: the questions you treat as the bar, like Success Coach, NURS 420</span>
      </label>
      <section className="group">
        <h2 className="group-header">How many questions</h2>
        <div className="count-row">
          <span className="list-copy">
            <span className="list-title">{countText(draft.count, "question")}</span>
            <span className="list-meta">{writingTime(draft.count)}</span>
          </span>
          <span className="count-stepper">
            <Button
              variant="secondary"
              aria-label="Fewer questions"
              disabled={draft.count <= range.min}
              onClick={() => {
                onChange({ ...draft, count: draft.count - 1 });
              }}
            >
              −
            </Button>
            <Button
              variant="secondary"
              aria-label="More questions"
              disabled={draft.count >= range.max}
              onClick={() => {
                onChange({ ...draft, count: draft.count + 1 });
              }}
            >
              +
            </Button>
          </span>
        </div>
      </section>
      <section className="group">
        <h2 className="group-header">Question kinds</h2>
        <div className="count-row">
          <span className="list-copy">
            <span className="list-title">{kinds.title}</span>
            <span className="list-meta">{kinds.detail}</span>
          </span>
        </div>
        <TwinRow
          checked={draft.examTwins}
          detail="Same topic, different format and wording, for exams only"
          onChange={(examTwins) => {
            onChange({ ...draft, examTwins });
          }}
        />
      </section>
      <Button fullWidth className="btn-lg" disabled={starting} onClick={onStart}>
        Write 5 samples first
      </Button>
    </>
  );
}

function TwinRow({ checked, detail, onChange }: { checked: boolean; detail: string; onChange: (checked: boolean) => void }) {
  return (
    <div className="count-row">
      <span className="list-copy">
        <span className="list-title">Also write an exam twin for each</span>
        <span className="list-meta">{detail}</span>
      </span>
      <Switch checked={checked} label="Also write an exam twin for each" onChange={onChange} />
    </div>
  );
}

