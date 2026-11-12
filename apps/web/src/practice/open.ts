// Reads a practice set or Review for the runner and opens it where she stands.

import { ApiError, api, type CourseDetail } from "../api";
import { practiceSetIsFinished } from "../screens/set-status";
import { readPracticeSet } from "./model";
import { beginSession, type Session } from "./session";
import type { PracticeSource } from "./source";

/** The opened runner, or the words to show instead. */
export type Opening = { session: Session } | { error: string };

/**
 * One request: the set says where she stands in its `run`. A set from a server that does not send
 * `run` yet needs its row on the course to tell a finished set from a new one, and a course that
 * cannot be read leaves it not finished, as before.
 */
export async function openPractice(courseId: string, source: PracticeSource): Promise<Opening> {
  try {
    return await readOpening(courseId, source);
  } catch (caught: unknown) {
    return { error: caught instanceof ApiError ? caught.message : "Could not open that set." };
  }
}

async function readOpening(courseId: string, source: PracticeSource): Promise<Opening> {
  const body = await api<unknown>(source.loadPath);
  if (typeof body === "object" && body !== null && "kind" in body && body.kind === "exam") {
    return { error: "This set’s questions are asked only on exams." };
  }
  const loaded = readPracticeSet(body);
  if (loaded?.courseId !== courseId) {
    return { error: loaded ? "That set is not in this course." : "This set could not be read." };
  }
  const finished =
    source.kind === "set" && loaded.run === null
      ? await api<CourseDetail>(`/api/courses/${courseId}`).then(
          (course) => practiceSetIsFinished(course, loaded.id),
          () => false,
        )
      : false;
  return { session: beginSession(loaded, source.kind, finished) };
}
