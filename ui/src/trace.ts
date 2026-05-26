/** Correlation IDs for audit trail (session = demo run, trace = one tool attempt). */
export function newSessionId(): string {
  return `sess_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function newTraceId(): string {
  return `tr_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}
