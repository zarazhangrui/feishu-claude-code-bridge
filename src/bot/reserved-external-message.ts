/**
 * Some messages are meant for external group orchestrators rather than this
 * bridge's local coding agent. Reserve those protocol-looking messages so
 * bridge bots can coexist with sidecar tools without launching duplicate runs.
 */
const EXTERNAL_MARKER_RE = /\[(?:study-room|agent-room|orchestrator):[^\]\s]+\]/i;
const STUDY_START_RE = /(?:^|\s)\/study(?:\b|\s|$)/i;
const STUDY_STOP_RE = /(?:^|\s)\/stop\s+study(?:\b|\s|$)/i;

export type ReservedExternalMessageReason =
  | 'external-marker'
  | 'external-study'
  | 'external-stop-study';

export function classifyReservedExternalMessage(
  content: string,
): ReservedExternalMessageReason | undefined {
  const normalized = content.trim();
  if (!normalized) return undefined;
  if (EXTERNAL_MARKER_RE.test(normalized)) return 'external-marker';
  if (STUDY_STOP_RE.test(normalized)) return 'external-stop-study';
  if (STUDY_START_RE.test(normalized)) return 'external-study';
  return undefined;
}

export function isReservedExternalMessage(content: string): boolean {
  return classifyReservedExternalMessage(content) !== undefined;
}
