const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 10000);
const VIDEO_API_URL = process.env.VIDEO_API_URL || "";
const VIDEO_API_KEY = process.env.VIDEO_API_KEY || "";
const VIDEO_STATUS_URL = process.env.VIDEO_STATUS_URL || "";
const APP_ORIGIN = process.env.APP_ORIGIN || "*";

const jobs = new Map();
const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, { name: "Gemini Video Studio Backend", status: "online", configured: Boolean(VIDEO_API_URL && VIDEO_API_KEY) });
  }
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, providerConfigured: Boolean(VIDEO_API_URL && VIDEO_API_KEY) });
  }
  if (req.method === "POST" && url.pathname === "/api/videos") {
    try {
      const body = await readJson(req);
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (prompt.length < 12) {
        return send(res, 400, { error: "আপনার স্ক্রিপ্টটি খুব ছোট। দৃশ্য, চরিত্র ও পরিবেশসহ সুন্দরভাবে আবার লিখুন।" });
      }
      if (prompt.length > 5000) return send(res, 400, { error: "স্ক্রিপ্ট ৫০০০ অক্ষরের মধ্যে রাখুন।" });

      if (!VIDEO_API_URL || !VIDEO_API_KEY) {
        return send(res, 503, {
          error: "Backend চালু আছে, কিন্তু ভিডিও AI Provider এখনো সংযুক্ত করা হয়নি। সার্ভারের Environment-এ VIDEO_API_URL ও VIDEO_API_KEY সেট করতে হবে।"
        });
      }

      const providerResponse = await fetch(VIDEO_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${VIDEO_API_KEY}`
        },
        body: JSON.stringify({
          prompt,
          style: safeText(body.style, "Cinematic realistic"),
          duration: safeNumber(body.duration, 8, 3, 15),
          aspectRatio: safeChoice(body.aspectRatio, ["9:16", "16:9", "1:1"], "9:16"),
          resolution: safeChoice(body.resolution, ["720p", "1080p"], "720p"),
          language: safeText(body.language, "বাংলা"),
          cameraMovement: safeText(body.cameraMovement, "Auto"),
          lighting: safeText(body.lighting, "Auto"),
          backgroundMusic: safeText(body.backgroundMusic, "Auto"),
          quality: safeText(body.quality, "Standard"),
          negativePrompt: safeText(body.negativePrompt, "")
        })
      });

      const data = await providerResponse.json().catch(() => ({}));
      if (!providerResponse.ok) {
        return send(res, 502, { error: data.error || data.message || "ভিডিও Provider অনুরোধ গ্রহণ করেনি। Provider সেটিংস পরীক্ষা করুন।" });
      }

      // Provider contract: return { videoUrl } immediately OR { jobId, statusUrl? }.
      if (data.videoUrl && isHttpUrl(data.videoUrl)) return send(res, 200, { videoUrl: data.videoUrl });
      if (data.jobId) {
        const id = crypto.randomUUID();
        jobs.set(id, { providerJobId: String(data.jobId), statusUrl: data.statusUrl || "", createdAt: Date.now() });
        return send(res, 202, { jobId: id, message: "AI ভিডিও প্রসেসিং শুরু হয়েছে।" });
      }
      return send(res, 502, { error: "Provider সঠিক videoUrl বা jobId ফেরত দেয়নি। স্ক্রিপ্টটি যাচাই করে আবার চেষ্টা করুন।" });
    } catch (err) {
      return send(res, 500, { error: err.message || "সার্ভারে সমস্যা হয়েছে।" });
    }
  }

  const match = url.pathname.match(/^\/api\/videos\/([a-f0-9-]+)$/i);
  if (req.method === "GET" && match) {
    const job = jobs.get(match[1]);
    if (!job) return send(res, 404, { error: "এই ভিডিও Job পাওয়া যায়নি।" });
    if (!VIDEO_STATUS_URL) {
      return send(res, 501, { error: "এই Provider-এর job status endpoint এখনো কনফিগার করা হয়নি।" });
    }
    try {
      const statusUrl = job.statusUrl || `${VIDEO_STATUS_URL.replace(/\/$/, "")}/${encodeURIComponent(job.providerJobId)}`;
      const response = await fetch(statusUrl, { headers: { "Authorization": `Bearer ${VIDEO_API_KEY}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return send(res, 502, { error: data.error || "Provider-এর status পাওয়া যায়নি।" });
      if (data.videoUrl && isHttpUrl(data.videoUrl)) {
        jobs.delete(match[1]);
        return send(res, 200, { status: "completed", videoUrl: data.videoUrl });
      }
      if (["failed", "error"].includes(String(data.status).toLowerCase())) {
        jobs.delete(match[1]);
        return send(res, 200, { status: "failed", error: data.error || data.message || "ভিডিও তৈরি ব্যর্থ হয়েছে।" });
      }
      return send(res, 200, { status: data.status || "processing", message: data.message || "ভিডিও তৈরি হচ্ছে..." });
    } catch (err) {
      return send(res, 502, { error: err.message || "Provider status request ব্যর্থ হয়েছে।" });
    }
  }

  return send(res, 404, { error: "Not found" });
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", APP_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(status === 204 ? "" : JSON.stringify(data));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 100000) {
        reject(new Error("Request খুব বড়।"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch { reject(new Error("সঠিক JSON পাঠান।")); }
    });
    req.on("error", reject);
  });
}
function safeText(value, fallback) {
  return typeof value === "string" ? value.slice(0, 1000) : fallback;
}
function safeNumber(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function safeChoice(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gemini Video Studio Backend listening on ${PORT}`);
});
