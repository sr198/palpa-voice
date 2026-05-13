import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import KokoroAdapter, SUPPORTED_VOICES, synthesize_tone


class VoiceServiceTests(unittest.TestCase):
    def test_tone_synthesis_returns_wav_bytes(self):
        audio = synthesize_tone("hello world")
        self.assertTrue(audio.startswith(b"RIFF"))
        self.assertIn(b"WAVE", audio[:16])

    def test_supported_voices_are_exposed(self):
        self.assertEqual(sorted(SUPPORTED_VOICES), ["af_bella", "af_heart", "af_nova"])

    def test_kokoro_adapter_rejects_unknown_voice(self):
        adapter = KokoroAdapter()
        with self.assertRaisesRegex(ValueError, "unsupported voice id"):
            adapter.synthesize("hello", "missing")

    def test_kokoro_adapter_streams_pcm_chunks(self):
        adapter = KokoroAdapter()
        chunks = list(adapter.synthesize_stream("hello", "af_heart"))
        self.assertGreater(len(chunks), 0)
        self.assertTrue(all(isinstance(chunk, bytes) for chunk in chunks))


if __name__ == "__main__":
    unittest.main()
