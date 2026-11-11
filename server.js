import express from "express";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs/promises";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = path.join(__dirname, "generated");
await fs.mkdir(OUTPUT_DIR, { recursive: true });

app.use(express.json({ limit: "1mb" }));
const videoLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "এই ডিভাইস/নেটওয়ার্ক থেকে আপাতত ৩টি ভিডিও অনুরোধ করা হয়েছে। এক ঘণ্টা পরে আবার চেষ্টা করুন।" } });
app.use("/generated", express.static(OUTPUT_DIR, { maxAge: "1h" }));
app.use(express.static(path.join(__dirname, "public")));

const jobs = new Map();
const allowedDurations = new Set([5, 8, 10, 15]);
const allowedRatios = new Set(["9:16", "16:9"]);
const allowedResolutions = new Set(["720p", "1080p"]);

app.get("/health", (_req, res) => {
  res.json({
    name: "Gemini Video Studio",
    status: "online",
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: "gemini-omni-1.2-flash"
  });
});

app.post("/api/videos", videoLimiter, async (req, res) => {
  const { prompt, style = "Cinematic realistic", duration = 8,
    aspectRatio = "9:16", resolution = "720p", language = "বাংলা" } = req.body || {};

  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "ভিডিওর জন্য আগে একটি স্ক্রিপ্ট লিখুন।" });
  }
  if (prompt.length > 5000) return res.status(400).json({ error: "স্ক্রিপ্ট ৫০০০ অক্ষরের মধ্যে রাখুন।" });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "সার্ভারে GEMINI_API_KEY সেট করা নেই। Render → Environment-এ নতুন API key যোগ করুন।" });
  }
  const seconds = Number(duration);
  if (!allowedDurations.has(seconds)) return res.status(400).json({ error: "সমর্থিত দৈর্ঘ্য: 5, 8, 10 অথবা 15 সেকেন্ড।" });
  if (!allowedRatios.has(aspectRatio)) return res.status(400).json({ error: "ভিডিও সাইজ 9:16 অথবা 16:9 হতে হবে।" });
  if (!allowedResolutions.has(resolution)) return res.status(400).json({ error: "রেজোলিউশন 720p অথবা 1080p হতে হবে।" });

  const id = crypto.randomUUID();
  jobs.set(id, { status: "processing", createdAt: Date.now() });
  res.status(202).json({ jobId: id, status: "processing", message: "ভিডিও তৈরির কাজ শুরু হয়েছে।" });

  // Run after the response is sent so the browser does not time out during generation.
  generateVideo(id, {
    prompt: prompt.trim(), style: String(style).slice(0, 80),
    duration: seconds, aspectRatio, resolution, language: String(language).slice(0, 40)
  }).catch(err => {
    console.error("Video job failed:", err);
    jobs.set(id, { status: "failed", error: friendlyError(err), updatedAt: Date.now() });
  });
});

app.get("/api/videos/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "এই ভিডিও কাজটি পাওয়া যায়নি। আবার চেষ্টা করুন।" });
  return res.json(job);
});

async function generateVideo(id, options) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const fullPrompt = [
    options.prompt,
    `Visual style: ${options.style}.`,
    `Narration/voice direction: ${options.language}.`,
    "Create one coherent cinematic video. Follow the described scene, natural motion, lighting and camera direction."
  ].join("\n");

  const interaction = await ai.interactions.create({
    model: "gemini-omni-1.2-flash",
    input: fullPrompt,
    response_format: {
      type: "video",
      aspect_ratio: options.aspectRatio,
      duration: `${options.duration}s`,
      resolution: options.resolution
    }
  });

  const video = interaction?.output_video;
  if (!video) {
    const detail = interaction?.output_text || "Gemini API ভিডিও আউটপুট ফেরত দেয়নি।";
    throw new Error(detail);
  }

  let bytes;
  if (video.data) {
    bytes = Buffer.from(video.data, "base64");
  } else if (video.uri) {
    // The API can return a managed file URI for video output. Download via the SDK.
    const downloaded = await ai.files.download({ file: video });
    bytes = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);
  } else {
    throw new Error("Gemini ভিডিওর ডাউনলোডযোগ্য ডেটা ফেরত দেয়নি।");
  }

  if (!bytes || bytes.length < 1000) throw new Error("ভিডিও ফাইলটি অসম্পূর্ণ এসেছে। আবার চেষ্টা করুন।");
  const filename = `${id}.mp4`;
  await fs.writeFile(path.join(OUTPUT_DIR, filename), bytes);
  jobs.set(id, {
    status: "completed",
    videoUrl: `/generated/${filename}`,
    updatedAt: Date.now()
  });
}

function friendlyError(err) {
  const message = String(err?.message || err || "Unknown error");
  if (/API_KEY_INVALID|invalid api key|API key not valid/i.test(message))
    return "Gemini API Key সঠিক নয়। Google AI Studio থেকে নতুন key তৈরি করে Render Environment-এ GEMINI_API_KEY হিসেবে দিন।";
  if (/quota|rate.?limit|RESOURCE_EXHAUSTED|429/i.test(message))
    return "Gemini API quota বা rate limit শেষ হয়েছে। Google AI Studio/Google Cloud-এ quota ও billing পরীক্ষা করুন।";
  if (/not found|404|model/i.test(message))
    return "Gemini ভিডিও মডেল আপনার API project-এ উপলভ্য নয়। AI Studio-তে Gemini Omni 1.2 Flash access পরীক্ষা করুন।";
  return message.slice(0, 700);
}

// Remove in-memory job records after 2 hours; keep generated videos for serving.
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) if ((job.updatedAt || job.createdAt || 0) < cutoff) jobs.delete(id);
}, 15 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`Gemini Video Studio listening on ${PORT}`));
