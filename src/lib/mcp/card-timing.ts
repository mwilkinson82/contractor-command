/** Application-side card timing. Numbers only: no tokens, headers, identifiers or tool data.
 *  These measurements help investigate loading failures; they cannot establish whether a host
 *  received the response or reached its own deadline. Platform startup and network time are excluded. */

// Workers may evaluate module-scope Date.now() as zero before the first I/O.
// Anchor the diagnostic clock to the first observed request instead.
let firstMcpRequestAt: number | undefined;
let mcpRequests = 0;

export type CardTiming = {
  startedAt: number;
  /** Set immediately before invoking the downstream SDK handler. */
  sdkStartedAt?: number;
  /** Set once the SDK (auth, server build, handler) has returned. */
  sdkDoneAt?: number;
  /** 1 for the first MCP request this isolate has seen since it started. */
  requestNo: number;
  /** Milliseconds since the first observed MCP request, not platform startup. */
  isolateAgeMs: number;
};

export function beginCardTiming(now = Date.now()): CardTiming {
  firstMcpRequestAt ??= now;
  mcpRequests += 1;
  return {
    startedAt: now,
    requestNo: mcpRequests,
    isolateAgeMs: Math.max(0, now - firstMcpRequestAt),
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
