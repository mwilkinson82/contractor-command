/** Application-side card timing. Numbers only: no tokens, headers, identifiers or tool data.
 *  These measurements help investigate loading failures; they cannot establish whether a host
 *  received the response or reached its own deadline. Platform startup and network time are excluded. */

const ISOLATE_STARTED_AT = Date.now();
let mcpRequests = 0;

export type CardTiming = {
  startedAt: number;
  /** Set immediately before invoking the downstream SDK handler. */
  sdkStartedAt?: number;
  /** Set once the SDK (auth, server build, handler) has returned. */
  sdkDoneAt?: number;
  /** 1 for the first MCP request this isolate has seen since it started. */
  requestNo: number;
  /** Milliseconds since this module loaded, not a platform startup measurement. */
  isolateAgeMs: number;
};

export function beginCardTiming(now = Date.now()): CardTiming {
  mcpRequests += 1;
  return {
    startedAt: now,
    requestNo: mcpRequests,
    isolateAgeMs: Math.max(0, now - ISOLATE_STARTED_AT),
  };
}

export function markSdkDone(timing: CardTiming, now = Date.now()): CardTiming {
  timing.sdkDoneAt = now;
  return timing;
}

export function markSdkStarted(timing: CardTiming, now = Date.now()): CardTiming {
  timing.sdkStartedAt = now;
  return timing;
}

/** Fields appended to every card log line. */
export function timingFields(timing: CardTiming | undefined, now = Date.now()) {
  if (!timing) return {};
  return {
    sdkMs:
      timing.sdkDoneAt == null
        ? null
        : timing.sdkDoneAt - (timing.sdkStartedAt ?? timing.startedAt),
    totalMs: now - timing.startedAt,
    requestNo: timing.requestNo,
    isolateAgeMs: timing.isolateAgeMs,
    // First MCP request observed by this module; not proof of a platform cold start.
    cold: timing.requestNo === 1,
  };
}
