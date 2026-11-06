import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import type { components } from "./api-schema";
import { refreshCatalog } from "./catalog";

export type Student = components["schemas"]["Student"];

/** The student accounts, and the one the admin is looking at. Only the admin reads this. */
export type StudentList = components["schemas"]["StudentList"];

const listeners = new Set<() => void>();
let snapshot: StudentList | null = null;
let loading: Promise<void> | null = null;

function publish(next: StudentList): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshStudents(): Promise<void> {
  publish(await api<StudentList>("/api/admin/students"));
}

/** The admin's student list, loaded once on first use. Null until the server answers. */
export function useStudents(enabled: boolean): StudentList | null {
  const value = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  useEffect(() => {
    if (!enabled || snapshot !== null || loading !== null) return;
    loading = refreshStudents()
      .catch(() => undefined)
      .finally(() => {
        loading = null;
      });
  }, [enabled]);
  return enabled ? value : null;
}

/** Points the admin's frozen view, the temporary password, and Repair at another student. */
export async function pickStudent(studentId: string): Promise<void> {
  publish(await api<StudentList>("/api/admin/students/viewing", { method: "PUT", json: { studentId } }));
  await refreshCatalog();
}

export function viewedStudent(list: StudentList | null): Student | null {
  return list?.students.find((student) => student.id === list.viewingId) ?? null;
}

/** The email of the account on screen, once the list is read. */
export function viewedEmail(): string | null {
  return viewedStudent(snapshot)?.email ?? null;
}

/** Forgets the list on sign-out, so another account never sees it. */
export function forgetStudents(): void {
  snapshot = null;
  for (const listener of listeners) listener();
}
