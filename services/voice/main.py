from __future__ import annotations

import io
import json
import math
import os
import struct
import wave
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

try:
    from aiohttp import web
except ModuleNotFoundError:  # pragma: no cover - dependency optional during syntax-only verification
    web = None


SUPPORTED_VOICES = {"af_bella", "af_heart", "af_nova"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def pcm16_to_wav_bytes(pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)
    return buffer.getvalue()


def synthesize_tone(text: str, duration_ms: int = 850, sample_rate: int = 24000) -> bytes:
    amplitude = 0.22
    frequency = 440 if len(text) % 2 == 0 else 554
    frames = int(sample_rate * (duration_ms / 1000))
    payload = bytearray()

    for frame in range(frames):
        value = int(amplitude * 32767 * math.sin((2 * math.pi * frequency * frame) / sample_rate))
        payload.extend(struct.pack("<h", value))

    return pcm16_to_wav_bytes(bytes(payload), sample_rate=sample_rate)


class WhisperAdapter:
    def __init__(self) -> None:
        self.provider = "mock-whisper"
        self.model_name = os.getenv("WHISPER_MODEL", "tiny.en")
        self.loaded = False
        self.error: Optional[str] = None
        self.model = None

        try:
            from faster_whisper import WhisperModel  # type: ignore

            self.model = WhisperModel(self.model_name, device="cpu", compute_type="int8")
            self.provider = "faster-whisper"
            self.loaded = True
        except Exception as exc:  # pragma: no cover - environment dependent
            self.error = str(exc)

    def transcribe(self, pcm_bytes: bytes) -> Dict[str, object]:
        if not pcm_bytes:
            return {"text": "", "provider": self.provider, "provider_metadata": {"model": self.model_name}}

        if not self.loaded or self.model is None:
            seconds = len(pcm_bytes) / 32000
            text = f"Mock transcript from {seconds:.1f}s of audio".strip()
            return {
                "text": text,
                "provider": self.provider,
                "provider_metadata": {"model": self.model_name, "loaded": False, "error": self.error},
            }

        wav_bytes = pcm16_to_wav_bytes(pcm_bytes)
        segments, info = self.model.transcribe(io.BytesIO(wav_bytes), language="en", vad_filter=True)
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return {
            "text": text,
            "provider": self.provider,
            "provider_metadata": {"model": self.model_name, "language": info.language, "duration": info.duration},
        }


class KokoroAdapter:
    def __init__(self) -> None:
        self.provider = "mock-kokoro"
        self.loaded = False
        self.error: Optional[str] = None
        self.pipeline = None

        try:
            from kokoro import KPipeline  # type: ignore

            self.pipeline = KPipeline(lang_code="a")
            self.provider = "kokoro"
            self.loaded = True
        except Exception as exc:  # pragma: no cover - environment dependent
            self.error = str(exc)

    def synthesize(self, text: str, voice_id: str) -> Dict[str, object]:
        print("Trying to synthesize with voice_id:", voice_id)
        if voice_id not in SUPPORTED_VOICES:
            raise ValueError("unsupported voice id")

        if not text:
            raise ValueError("text is required")

        if not self.loaded or self.pipeline is None:
            audio = synthesize_tone(text)
            return {"audio": audio, "provider": self.provider, "duration_ms": 850}

        generator = self.pipeline(text, voice=voice_id)
        audio_chunks = []
        sample_rate = 24000

        for _, _, audio in generator:
            audio_chunks.extend(audio)

        pcm = bytearray()
        for sample in audio_chunks:
            value = max(-1.0, min(1.0, sample))
            pcm.extend(struct.pack("<h", int(value * 32767)))

        audio = pcm16_to_wav_bytes(bytes(pcm), sample_rate=sample_rate)
        duration_ms = int((len(pcm) / 2 / sample_rate) * 1000)
        return {"audio": audio, "provider": self.provider, "duration_ms": duration_ms}


@dataclass
class TurnBuffer:
    session_id: str
    turn_id: str
    audio_chunks: list[bytes] = field(default_factory=list)
    partial_count: int = 0

    @property
    def pcm_bytes(self) -> bytes:
        return b"".join(self.audio_chunks)


class VoiceService:
    def __init__(self) -> None:
        self.whisper = WhisperAdapter()
        self.kokoro = KokoroAdapter()
        self.turns: Dict[str, TurnBuffer] = {}

    async def health(self, request: web.Request) -> web.Response:
        return web.json_response(
            {
                "ok": True,
                "service": "palpa-voice",
                "asr": {
                    "provider": self.whisper.provider,
                    "model": self.whisper.model_name,
                    "loaded": self.whisper.loaded,
                    "error": self.whisper.error,
                },
                "tts": {
                    "provider": self.kokoro.provider,
                    "loaded": self.kokoro.loaded,
                    "error": self.kokoro.error,
                    "voices": sorted(SUPPORTED_VOICES),
                },
            }
        )

    async def synthesize(self, request: web.Request) -> web.Response:
        print("Received TTS request")
        payload = await request.json()
        voice_id = payload.get("voice_id", "")
        output_format = payload.get("output_format", "wav")

        if output_format != "wav":
            return web.json_response({"error": "only wav output is supported"}, status=400)

        try:
            result = self.kokoro.synthesize(str(payload.get("text", "")).strip(), voice_id)
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

        response = web.Response(body=result["audio"], content_type="audio/wav")
        response.headers["x-voice-id"] = voice_id
        response.headers["x-provider"] = str(result["provider"])
        response.headers["x-duration-ms"] = str(result["duration_ms"])
        return response

    async def asr_ws(self, request: web.Request) -> web.WebSocketResponse:
        print("ASR WebSocket connection established")
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        async for message in ws:
            if message.type != web.WSMsgType.TEXT:
                continue

            payload = json.loads(message.data)
            message_type = payload.get("type")

            if message_type == "start_turn":
                key = payload["turn_id"]
                self.turns[key] = TurnBuffer(session_id=payload["session_id"], turn_id=payload["turn_id"])
                continue

            if message_type == "append_audio_chunk":
                turn = self.turns.get(payload["turn_id"])
                if turn is None:
                    await ws.send_json({"type": "turn_error", "turn_id": payload["turn_id"], "error": "unknown turn"})
                    continue

                audio = payload.get("audio", "")
                turn.audio_chunks.append(io.BytesIO(base64_decode(audio)).getvalue())
                turn.partial_count += 1

                if turn.partial_count % 2 == 0 and turn.pcm_bytes:
                    partial = self.whisper.transcribe(turn.pcm_bytes[: min(len(turn.pcm_bytes), 32000 * 3)])
                    await ws.send_json(
                        {
                            "type": "partial_transcript",
                            "session_id": turn.session_id,
                            "turn_id": turn.turn_id,
                            "text": partial["text"],
                            "timestamp": now_iso(),
                            "provider": partial["provider"],
                        }
                    )
                continue

            if message_type == "end_turn":
                turn = self.turns.pop(payload["turn_id"], None)
                if turn is None:
                    await ws.send_json({"type": "turn_error", "turn_id": payload["turn_id"], "error": "unknown turn"})
                    continue

                result = self.whisper.transcribe(turn.pcm_bytes)
                await ws.send_json(
                    {
                        "type": "final_transcript",
                        "session_id": turn.session_id,
                        "turn_id": turn.turn_id,
                        "text": result["text"],
                        "timestamp": now_iso(),
                        "provider": result["provider"],
                        "provider_metadata": result["provider_metadata"],
                    }
                )
                continue

            if message_type == "cancel_turn":
                self.turns.pop(payload["turn_id"], None)

        return ws


def base64_decode(payload: str) -> bytes:
    import base64

    return base64.b64decode(payload.encode("utf-8"))


def build_app() -> web.Application:
    if web is None:
        raise RuntimeError("aiohttp is required to run the voice service")

    service = VoiceService()
    app = web.Application()
    app.router.add_get("/health", service.health)
    app.router.add_post("/tts/synthesize", service.synthesize)
    app.router.add_get("/asr", service.asr_ws)
    return app


if __name__ == "__main__":
    if web is None:
        raise RuntimeError("aiohttp is required to run the voice service")

    web.run_app(build_app(), host="127.0.0.1", port=8000)
