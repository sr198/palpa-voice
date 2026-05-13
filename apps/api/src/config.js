export const config = {
  apiPort: Number(process.env.PORT || 3001),
  apiHost: process.env.HOST || '127.0.0.1',
  webOrigin: process.env.WEB_ORIGIN || 'http://127.0.0.1:3000',
  voiceWsUrl: process.env.VOICE_ASR_WS_URL || 'ws://127.0.0.1:8000/asr',
  voiceTtsUrl: process.env.VOICE_TTS_URL || 'http://127.0.0.1:8000/tts/synthesize',
  voiceTtsStreamUrl: process.env.VOICE_TTS_STREAM_URL || 'http://127.0.0.1:8000/tts/stream',
  voiceHealthUrl: process.env.VOICE_HEALTH_URL || 'http://127.0.0.1:8000/health',
  maxTurnBytes: Number(process.env.MAX_TURN_BYTES || 1024 * 1024 * 8),
  codexBinary: process.env.CODEX_BINARY || 'codex',
  codexCwd: process.env.CODEX_CWD || process.cwd(),
  codexModel: process.env.CODEX_MODEL || '',
  codexApprovalPolicy: process.env.CODEX_APPROVAL_POLICY || 'never',
  codexSandboxMode: process.env.CODEX_SANDBOX_MODE || 'workspace-write',
  codexNetworkAccess: process.env.CODEX_NETWORK_ACCESS !== 'false',
  codexTurnTimeoutMs: Number(process.env.CODEX_TURN_TIMEOUT_MS || 30000)
};
