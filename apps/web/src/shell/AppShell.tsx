import { useEffect, useMemo } from "react";
import { AGENTS_PATH } from "../agents/agents";
import { api } from "../api";
import { refreshCatalog } from "../catalog";
import { ExamScreen } from "../exam/ExamScreen";
import { readExamPreset } from "../course/pages";
import { ExamSetupScreen } from "../exam/ExamSetupScreen";
import { TwinJobScreen } from "../exam/TwinJobScreen";
import { PracticeScreen } from "../practice/PracticeScreen";
import { practiceSource } from "../practice/source";
import { JobScreen } from "../make/JobScreen";
import { MakeScreen } from "../make/MakeScreen";
import { matchDetail, matchExam, matchMake, matchPractice, navigate, normalizePath, usePathname, useSearch } from "../router";
import { inSection, matchRoute, navigationFor } from "../routes";
import { FrozenLine } from "../components/FrozenLine";
import { FrozenNote } from "../components/FrozenNote";
import { UndoToast } from "../components/UndoToast";
import { CourseScreen } from "../screens/CourseScreen";
import { DeletedScreen } from "../screens/DeletedScreen";
import { ExamPageScreen } from "../screens/ExamPageScreen";
import { FolderScreen } from "../screens/FolderScreen";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { ReviewScreen } from "../screens/ReviewScreen";
import { TermsScreen } from "../screens/TermsScreen";
import type { Role } from "../session";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "./useMediaQuery";

export function AppShell({ role }: { role: Role }) {
  const pathname = usePathname();
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const items = navigationFor(role);
  const route = matchRoute(pathname);
  const detail = useMemo(() => matchDetail(pathname), [pathname]);
  const search = useSearch();
  const practice = useMemo(() => matchPractice(pathname), [pathname]);
  const source = useMemo(() => (practice ? practiceSource(practice, search) : null), [practice, search]);
  const exam = useMemo(() => matchExam(pathname), [pathname]);
  const make = useMemo(() => matchMake(pathname), [pathname]);
  const preset = useMemo(() => readExamPreset(search), [search]);
  // The runner fills the screen: no tab bar, and the screen does not scroll behind it.
  const runner = practice !== null || exam !== null;
  const ScreenBody = route?.Screen ?? NotFoundScreen;
  // Admin and Settings are the admin's own. Every other screen is the account being viewed, frozen.
  const frozenScreen = role === "admin" && !inSection(pathname, "/admin") && !inSection(pathname, "/settings");
  const width = make ? "reading" : (detail?.width ?? route?.width);

  useEffect(() => {
    void refreshCatalog();
  }, []);

  // She lands on the course she used last. Home stays one tap back.
  useEffect(() => {
    if (role !== "student") return;
    let cancel = false;
    void api<{ courseId: string | null }>("/api/me/place")
      .then((place) => {
        if (cancel || place.courseId === null) return;
        if (normalizePath(window.location.pathname) !== "/") return;
        navigate(`/course/${place.courseId}`);
      })
      .catch((caught: unknown) => {
        console.error(caught);
      });
    return () => {
      cancel = true;
    };
  }, [role]);

  useEffect(() => {
    if (runner || make) return;
    document.title = `${detail?.label ?? route?.label ?? "Not found"} · Qbank`;
  }, [detail, route, runner, make]);

  return (
    <div className={`${wide ? "shell shell-wide" : "shell shell-phone"}${frozenScreen ? " shell-frozen" : ""}`}>
      {frozenScreen ? <FrozenLine /> : null}
      {wide ? <Sidebar items={items} pathname={pathname} /> : null}
      <div className="shell-main">
        <main className={runner ? "screen screen-practice" : "screen"}>
          {exam ? (
            <ExamScreen key={exam.examId} courseId={exam.courseId} examId={exam.examId} wide={wide} />
          ) : practice && source ? (
            <PracticeScreen key={source.key} courseId={practice.courseId} source={source} wide={wide} />
          ) : (
            <div className={width === "reading" ? "screen-body screen-body-narrow" : "screen-body"}>
              {/* Keyed, so another course, exam page, or folder starts fresh: out of Edit and Select. */}
              {make?.jobId ? (
                <JobScreen key={make.jobId} jobId={make.jobId} />
              ) : make ? (
                <MakeScreen key={search} />
              ) : detail?.kind === "course" ? (
                <CourseScreen key={detail.courseId} courseId={detail.courseId} />
              ) : detail?.kind === "exam-page" ? (
                <ExamPageScreen key={detail.examPageId} courseId={detail.courseId} examPageId={detail.examPageId} />
              ) : detail?.kind === "folder" ? (
                <FolderScreen key={detail.folderId} courseId={detail.courseId} folderId={detail.folderId} />
              ) : detail?.kind === "terms" ? (
                <TermsScreen courseId={detail.courseId} />
              ) : detail?.kind === "deleted" ? (
                <DeletedScreen key={detail.courseId} courseId={detail.courseId} />
              ) : detail?.kind === "review" ? (
                <ReviewScreen courseId={detail.courseId} />
              ) : detail?.kind === "exam" ? (
                <ExamSetupScreen key={search} courseId={detail.courseId} preset={preset} />
              ) : detail?.kind === "twins" ? (
                <TwinJobScreen key={detail.jobId} courseId={detail.courseId} jobId={detail.jobId} />
              ) : (
                // Keyed by the query, so Import opened from a folder ("Import here") starts with that folder picked.
                // Connect an agent drops the ?code= it opened with once it has read it, which must not start it over.
                <ScreenBody key={route?.path === AGENTS_PATH ? AGENTS_PATH : search} />
              )}
            </div>
          )}
        </main>
      </div>
      {/* Undo after a delete stays while the screen changes, as a deleted folder's screen goes back. */}
      {runner ? null : <UndoToast />}
      {role === "admin" ? <FrozenNote /> : null}
      {wide || runner ? null : <TabBar items={items} pathname={pathname} />}
    </div>
  );
}
