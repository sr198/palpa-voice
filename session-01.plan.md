# Session 01 Plan

## Objective

Implement the smallest end-to-end voice roundtrip that matches Palpa's long-term architecture:

`human speech -> ASR -> transcript event -> mock role reply -> TTS voice reply`

## Scope

### In scope

- Browser microphone capture
- Server-side ASR call
- Structured transcript event
- Mock role registry with randomized reply voice
- TTS adapter boundary for Kokoro
- Browser playback of synthesized audio
- Health endpoint and provider visibility

### Out of scope

- Realtime streaming ASR
- Actual external agent SDK integration
- Floor policy
- Persistence layer
- Review gates

## Implementation Notes

### ASR path

- Browser records `audio/webm`.
- Server forwards clip to OpenAI transcription API.
- Default model can remain `whisper-1` for Whisper validation.
- If no API key is present, return a mock transcript so the UI can still exercise the rest of the flow.

### Reply path

- Keep reply generation local and deterministic.
- Randomly assign one of a few roles such as `Facilitator`, `Architect`, or `Operator`.
- Each role has a fixed set of candidate voice ids and utterances.

### TTS path

- Server calls a `KOKORO_API_URL` sidecar if configured.
- If no sidecar is configured, use browser speech synthesis as a demo fallback only.
- The browser fallback is not the target architecture. It is only there to keep the loop demoable.

## Success Criteria

1. The browser can capture a spoken turn.
2. A transcript appears in the UI.
3. The UI shows which mock role responded.
4. The reply is played back audibly.
5. Health output reveals which providers are live versus mocked.

## Next Slice After Session 01

1. Replace mock reply logic with a Palpa role contract.
2. Add websocket event streaming for turn state updates.
3. Add turn ids, session ids, and latency spans to every step.
4. Swap clip upload for streaming ASR when latency matters more than implementation simplicity.
5. Introduce a true external-agent adapter for Codex or Claude responses.
