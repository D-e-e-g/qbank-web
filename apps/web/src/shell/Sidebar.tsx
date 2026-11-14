import { homeLayout, useCatalog, type CourseLink } from "../catalog";
import { Icon } from "../components/Icon";
import { inSection, type AppRoute } from "../routes";
import { ShellLink } from "./ShellLink";

export function Sidebar({ items, pathname }: { items: readonly AppRoute[]; pathname: string }) {
  const catalog = useCatalog();
  // No semester and no topic is listed until they are known: a load that failed is not an empty account.
  const layout = catalog.status === "ready" ? homeLayout(catalog) : null;
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar-title">Qbank</div>
      <nav className="sidebar-nav" aria-label="Sections">
        {items.map((item) => {
          const current = inSection(pathname, item.path);
          return (
            <ShellLink key={item.id} to={item.path} className="side-item" current={current}>
              <Icon name={item.icon} size={18} strokeWidth={current ? 2 : 1.75} />
              <span className="side-item-label">{item.label}</span>
            </ShellLink>
          );
        })}
      </nav>
      {layout?.semesters.map(({ semester, courses }) => (
        <div key={semester.id} className="sidebar-semester">
          <div className="sidebar-semester-label">{semester.label}</div>
          {courses.length === 0 ? <div className="sidebar-empty">No courses yet</div> : null}
          {courses.map((course) => (
            <SideCourse key={course.id} course={course} pathname={pathname} />
          ))}
        </div>
      ))}
      {layout ? (
        <div className="sidebar-semester">
          <div className="sidebar-semester-label">Study topics</div>
          {layout.topics.length === 0 ? <div className="sidebar-empty">No topics yet</div> : null}
          {layout.topics.map((topic) => (
            <SideCourse key={topic.id} course={topic} pathname={pathname} />
          ))}
        </div>
      ) : null}
    </aside>
  );
}

/** A course by its code and name; a topic by its name alone. */
function SideCourse({ course, pathname }: { course: CourseLink; pathname: string }) {
  const to = `/course/${course.id}`;
  const current = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <ShellLink to={to} className="side-item side-item-course" current={current}>
      <span className="side-course">
        {course.kind === "topic" ? null : <span className="side-course-code">{course.code}</span>}
        <span className="side-item-label">{course.title}</span>
      </span>
    </ShellLink>
  );
}
