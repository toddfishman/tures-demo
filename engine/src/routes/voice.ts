import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { log } from "../logger.ts";

// POST /voice/transcribe — proxy a short audio clip to Deepgram and return the transcript. The
// browser records with MediaRecorder and posts the raw audio bytes; we never store the audio.
// Gated by DEEPGRAM_API_KEY.
export async function voiceRoutes(app: FastifyInstance) {
  // Accept binary audio bodies without trying to JSON-parse them.
  app.addContentTypeParser(
    ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "application/octet-stream"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  app.post("/voice/transcribe", async (req, reply) => {
    if (!config.deepgramKey) return reply.status(501).send({ error: "voice_not_configured" });
    const audio = req.body as Buffer;
    if (!audio || !(audio instanceof Buffer) || audio.length === 0) {
      return reply.status(400).send({ error: "no_audio" });
    }
    try {
      const res = await fetch("https://api.deepgram.com/v1/listen?smart_format=true&model=nova-2&punctuate=true", {
        method: "POST",
        headers: {
          Authorization: `Token ${config.deepgramKey}`,
          "Content-Type": (req.headers["content-type"] as string) || "audio/webm",
        },
        body: audio,
      });
      if (!res.ok) {
        log.error("deepgram error", { status: res.status });
        return reply.status(502).send({ error: "transcription_failed" });
      }
      const json: any = await res.json();
      const transcript = json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
      return { transcript };
    } catch (e) {
      log.error("voice transcribe failed", { err: String(e) });
      return reply.status(502).send({ error: "transcription_failed" });
    }
  });

  // POST /voice/speak {text} — Deepgram Aura TTS → mp3 audio of Tures' voice. Gated by the key.
  app.post("/voice/speak", async (req, reply) => {
    if (!config.deepgramKey) return reply.status(501).send({ error: "voice_not_configured" });
    const text = (((req.body as any) || {}).text || "").toString().trim().slice(0, 1800);
    if (!text) return reply.status(400).send({ error: "no_text" });
    try {
      const res = await fetch("https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mp3", {
        method: "POST",
        headers: { Authorization: `Token ${config.deepgramKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        log.error("aura tts error", { status: res.status });
        return reply.status(502).send({ error: "tts_failed" });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      reply.header("Content-Type", "audio/mpeg");
      reply.header("Cache-Control", "no-store");
      return reply.send(buf);
    } catch (e) {
      log.error("voice speak failed", { err: String(e) });
      return reply.status(502).send({ error: "tts_failed" });
    }
  });
}
