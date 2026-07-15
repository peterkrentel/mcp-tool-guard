import express from "express";
import { createClient } from "redis";

const app = express();
app.use(express.json({ limit: "2mb" }));

const port = Number(process.env.PORT || 8080);
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const token = process.env.KV_REST_API_TOKEN || "";

const redis = createClient({ url: redisUrl });
redis.on("error", (err) => {
  console.error("redis error", err);
});

let redisReady = false;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectRedisWithRetry() {
  for (;;) {
    try {
      if (!redis.isOpen) {
        await redis.connect();
      }
      await redis.ping();
      redisReady = true;
      console.log("redis connected");
      return;
    } catch (err) {
      redisReady = false;
      const message = err instanceof Error ? err.message : String(err);
      console.error("redis connect failed, retrying in 2s", message);
      await sleep(2000);
    }
  }
}

await connectRedisWithRetry();

function unauthorized(res) {
  return res.status(401).json({ error: "unauthorized" });
}

function requireAuth(req, res, next) {
  if (!token) return next();
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return unauthorized(res);
  const provided = auth.slice("Bearer ".length).trim();
  if (provided !== token) return unauthorized(res);
  return next();
}

app.use(requireAuth);

app.get("/health", (_req, res) => {
  if (!redisReady) {
    return res.status(503).json({ ok: false, redisReady: false });
  }
  return res.json({ ok: true, redisReady: true });
});

app.get("/get/:key", async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const value = await redis.get(key);
  res.json({ result: value ?? null });
});

app.post("/set/:key", express.text({ type: "*/*" }), async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const exRaw = req.query.EX;
  const value = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  if (exRaw != null) {
    const ttl = Number(exRaw);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return res.status(400).json({ error: "invalid EX" });
    }
    await redis.set(key, value, { EX: Math.floor(ttl) });
  } else {
    await redis.set(key, value);
  }
  return res.json({ result: "OK" });
});

app.post("/del/:key", async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const deleted = await redis.del(key);
  res.json({ result: deleted });
});

app.get("/scan/:cursor/match/:pattern/count/:count", async (req, res) => {
  const cursor = Number.parseInt(req.params.cursor, 10) || 0;
  const pattern = decodeURIComponent(req.params.pattern);
  const count = Number.parseInt(req.params.count, 10) || 100;

  const out = await redis.scan(cursor, {
    MATCH: pattern,
    COUNT: count,
  });

  res.json({ result: [String(out.cursor), out.keys] });
});

app.listen(port, () => {
  console.log(`kv-rest-adapter listening on :${port}`);
});
