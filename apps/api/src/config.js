export const config = {
  apiPort: Number(process.env.PORT || 3001),
  apiHost: process.env.HOST || '127.0.0.1',
  webOrigin: process.env.WEB_ORIGIN || 'http://127.0.0.1:3000',
  voiceWsUrl: process.env.VOICE_ASR_WS_URL || 'ws://127.0.0.1:8000/asr',
  voiceTtsUrl: process.env.VOICE_TTS_URL || 'http://127.0.0.1:8000/tts/synthesize',
  voiceHealthUrl: process.env.VOICE_HEALTH_URL || 'http://127.0.0.1:8000/health',
  maxTurnBytes: Number(process.env.MAX_TURN_BYTES || 1024 * 1024 * 8)
};
