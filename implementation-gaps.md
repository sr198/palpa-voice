# Implementation Gaps

This file records the concrete gaps, deltas, and follow-up issues discovered during each phase or slice. It is intended to be cumulative.

## Slice 1

### Open gaps

1. VAD integration is not meaningfully implemented.
   The current turn boundary is explicit push-to-talk start/stop, and partial transcripts are triggered by simple chunk-count heuristics. `faster-whisper` is called with `vad_filter=True`, but there is no separate VAD-driven buffering or partial-decode strategy as called for in the Slice 1 plan.

2. TTS streaming is functional but still an interim transport.
   Reply audio is now streamed progressively from the Python voice service through the API to the browser, but the path is NDJSON-wrapped PCM relayed over the session WebSocket. This improves first-audio latency, but it is not yet the final transport shape for a production realtime voice stack.

3. Browser playback is chunk-scheduled rather than interruption-aware.
   The web client schedules streamed PCM chunks with Web Audio and can begin playback before full synthesis completes, but there is no barge-in, cancellation, or playback interruption policy yet.

4. Voice service dependency/runtime validation is still shallow.
   The code supports local fallback behavior and basic service tests, but full runtime validation still depends on local installation and real model execution for `aiohttp`, `faster-whisper`, and Kokoro.

5. Observability is still minimal.
   The Slice 1 plan called for basic timings and status visibility. The UI and API expose status text and turn completion timing, but latency breakdown across ASR, reply generation, TTS start, and first-audio playback is not yet instrumented in a useful way.

### Notes

- This file should be updated after each completed slice or phase.
- Gaps should be specific, implementation-grounded, and framed as deltas against the agreed slice plan.
