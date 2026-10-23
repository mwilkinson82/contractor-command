/** Timing for the native card path. Numbers only: no tokens, headers, identifiers or tool data.
 *  A first-load card failure in a host is a race between the host's fetch deadline and Athena's
 *  reply, so every log carries how long the SDK took, how long the whole request took, and
 *  whether this isolate had just started (a cold Worker is the slowest first reply). */

const ISOLATE_STARTED_AT = Date.now();
let mcpRequests = 0;

export type CardTiming = {
  startedAt: number;
  /** Set once the SDK (auth, server build, handler) has returned. */
  sdkDoneAt?: number;
  /** 1 for the first MCP request this isolate has seen since it started. */
  requestNo: number;
  /** Milliseconds since this isolate loaded the module. Small means cold. */
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

/** Fields appended to every card log line. */
export function timingFields(timing: CardTiming | undefined, now = Date.now()) {
  if (!timing) return {};
  return {
    sdkMs: timing.sdkDoneAt == null ? null : timing.sdkDoneAt - timing.startedAt,
    totalMs: now - timing.startedAt,
    requestNo: timing.requestNo,
    isolateAgeMs: timing.isolateAgeMs,
    cold: timing.requestNo === 1,
  };
}
