# Bounded drawing-reader reasoning

The live private foundation-count test on the actual permit drawing completed 13 of 32 scoped regions, but also hit empty provider output and repeated request timeouts. Checkpoints were preserved and no count was accepted. This is a reliability failure, not a complete quantity pass.

Gemini 3 readers now explicitly request `reasoning_effort: low` through the installed OpenAI-compatible SDK's supported `openaiCompatible.reasoningEffort` option. The existing Lovable gateway, model, JSON mode, 8,000-token output limit, 35-second step deadline, no-retry policy, coordinate schema, raster verification and estimator acceptance remain in place. Other configured reader families receive no new reasoning parameter. New proposal evidence records the reader effort alongside its model, allowing mixed historical reads to be distinguished.

Google documents this model-family control at https://ai.google.dev/gemini-api/docs/openai#thinking. This setting is an attempt to reduce per-tile latency, not proof that thinking caused every failure or that lower effort preserves all drawing accuracy. Live verification must check both completion and visible geometry against the source. A unit test proves what the SDK puts on the wire; it cannot prove that the gateway or model honors it.

Verification before release: 2,358 application tests across 223 files; 17/17 locked behaviors; changed-file ESLint. The provider interception checks the actual serialized request for Gemini and an alternative configured reader, with no automatic retry or fallback guess on malformed/empty output. Build result is recorded in the PR. Live results follow publication.

No migration, auth, Hub, email, access, connector, original-drawing or production-quantity changes. QA reads are confined to the existing owner-only QA job. CCW-003's restored 43-line takeoff remains unmeasured and must not be advertised as a completed takeoff.
