import { useEffect, useState } from "react";
import { api, type QuestionJob, type QuestionMakerStatus } from "../api";
import { Icon } from "../components/Icon";
import { makeJobPath, makePath } from "../router";
import { ShellLink } from "../shell/ShellLink";
import { canMake, inProgressJobs, jobProgress, jobTitle, makerClosed, makeNote } from "./states";

/**
 * The Add tab's Make questions row, on Import: the way in when this account may start a set, the
 * server's reason when it may not, and the sets still being made.
 */
export function MakeHub() {
  const [status, setStatus] = useState<QuestionMakerStatus | null>(null);
  const [jobs, setJobs] = useState<QuestionJob[]>([]);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let cancel = false;
    void api<QuestionMakerStatus>("/api/question-maker")
      .then((next) => {
        if (cancel) return null;
        setStatus(next);
        return api<{ jobs: QuestionJob[] }>("/api/question-jobs");
      })
      .then((body) => {
        if (!cancel && body) {
          setNow(Date.now());
          setJobs(body.jobs);
        }
      })
      .catch((error: unknown) => {
        if (cancel) return;
        // Import works either way. The job routes refuse an account the server does not allow.
        if (makerClosed(error)) setJobs([]);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const note = makeNote(status);
  const listed = now === null ? [] : inProgressJobs(jobs, now);
  if (!note && listed.length === 0) return null;

  return (
    <section className="group" aria-label="Make questions">
      {canMake(status) ? (
        <ul className="list-group">
          <li>
            <ShellLink to={makePath()} className="list-row" current={false}>
              <span className="list-icon">
                <Icon name="sparkles" size={22} />
              </span>
              <span className="list-copy">
                <span className="list-title list-title-strong">Make questions from your material</span>
                <span className="list-meta">Paste notes or photograph slides. QBank writes NCLEX-style questions and checks them.</span>
              </span>
              <span className="list-chevron">
                <Icon name="chevron-right" size={18} strokeWidth={2} />
              </span>
            </ShellLink>
          </li>
        </ul>
      ) : null}
      {note ? <p className="note">{note}</p> : null}
      {listed.length > 0 ? (
        <>
          <h2 className="group-header">In progress</h2>
          <ul className="list-group">
            {listed.map((job) => (
              <li key={job.id}>
                <ShellLink to={makeJobPath(job.id)} className="list-row" current={false}>
                  <span className="list-copy">
                    <span className="list-title">{jobTitle(job)}</span>
                    <span className="list-meta">{jobProgress(job)}</span>
                  </span>
                  <span className="list-chevron">
                    <Icon name="chevron-right" size={18} strokeWidth={2} />
                  </span>
                </ShellLink>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
