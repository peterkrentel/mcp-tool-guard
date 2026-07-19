export type ClientType = "claude-code" | "browser-gui" | "unattributed";

export function classifyClientType(traceId?: string): ClientType {
  if (traceId?.startsWith("cc-")) return "claude-code";
  if (traceId?.startsWith("tr_")) return "browser-gui";
  return "unattributed";
}
