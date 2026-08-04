export type DuplicateCandidateLike = {
  id: string;
  title: string;
  entityHint?: string | null;
  deadline?: string | Date | null;
  submittedTo?: string | null;
  status: string;
};

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deadlineKey(d: string | Date | null | undefined): string {
  if (!d) return "";
  const iso = typeof d === "string" ? d : d.toISOString();
  return iso.slice(0, 10);
}

export function isCandidateDuplicate(
  a: Omit<DuplicateCandidateLike, "id" | "status">,
  b: DuplicateCandidateLike,
): boolean {
  return (
    norm(a.title) === norm(b.title) &&
    norm(a.entityHint) === norm(b.entityHint) &&
    deadlineKey(a.deadline) === deadlineKey(b.deadline) &&
    norm(a.submittedTo) === norm(b.submittedTo)
  );
}

export function findCandidateDuplicates(
  candidate: Omit<DuplicateCandidateLike, "id" | "status">,
  existing: DuplicateCandidateLike[],
): DuplicateCandidateLike[] {
  return existing.filter(
    (e) =>
      e.status !== "ignored" &&
      isCandidateDuplicate(candidate, e),
  );
}
