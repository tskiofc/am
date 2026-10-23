const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const url = require("url");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || process.env.OM_PORT) || 3000;
const PUBLIC_DIR = path.resolve(__dirname, "..");
const REMOTE_HOST = "am.zervida.my.id";
const IS_VERCEL = Boolean(process.env.VERCEL) || process.env.VERCEL_ENV || process.cwd() === "/var/task";
const DEFAULT_ROOT = IS_VERCEL ? path.join(os.tmpdir(), "openmotion-storage") : path.join(PUBLIC_DIR, "storage");
const ROOT = process.env.OM_STORAGE || DEFAULT_ROOT;
const PROJECTS_DIR = path.join(ROOT, "projects");
const DAY_MS = 24 * 3600 * 1000;
try { fs.mkdirSync(PROJECTS_DIR, { recursive: true }); } catch (e) { console.error("[storage-init]", e.message); }

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".xml": "application/xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime"
};

try { fs.mkdirSync(PROJECTS_DIR, { recursive: true }); } catch (e) { console.error("[init]", e.message); }
process.on("uncaughtException", e => console.error("[uncaught]", e && e.message));
process.on("unhandledRejection", e => console.error("[unhandled]", e && e.message));

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function sha(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
function randId(len = 22) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
const isValidId = id => /^[A-Za-z0-9_-]{16,64}$/.test(id || "");
const safeName = n => String(n || "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
const projDir = id => path.join(PROJECTS_DIR, id);
const metaPath = id => path.join(projDir(id), "meta.json");
const scenePath = id => path.join(projDir(id), "scene.xml");

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8"));
  } catch (e) {
    return null;
  }
}
function writeMeta(id, meta) {
  ensureDir(projDir(id));
  fs.writeFileSync(metaPath(id), JSON.stringify(meta));
}
function touchMeta(id) {
  const m = readMeta(id);
  if (!m) return;
  m.lastSeen = Date.now();
  writeMeta(id, m);
}
function uidOf(req) {
  const cookies = String(req.headers.cookie || "").split(";").map(s => s.trim());
  for (const c of cookies) {
    if (c.startsWith("om_uid=")) {
      const v = decodeURIComponent(c.slice(7));
      if (/^[A-Za-z0-9_-]{10,64}$/.test(v)) return v;
    }
  }
  return "u" + randId(20);
}
function newUidCookie(uid) {
  return `om_uid=${uid}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
function readBody(req, limit = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", ch => {
      size += ch.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(ch);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body);
  return true;
}
function cleanupExpired() {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(PROJECTS_DIR);
  } catch (e) {
    return removed;
  }
  const now = Date.now();
  for (const id of entries) {
    const m = readMeta(id);
    const last = m && (m.lastSeen || m.createdAt) || 0;
    if (now - last > DAY_MS) {
      try {
        fs.rmSync(projDir(id), { recursive: true, force: true });
        removed++;
      } catch (e) {}
    }
  }
  if (removed) console.log(`[storage] dibersihkan ${removed} proyek lewat 24 jam`);
  return removed;
}
cleanupExpired();
setInterval(cleanupExpired, 60 * 60 * 1000).unref();

let effectIndex = null;
function loadEffectIndex() {
  if (!effectIndex) {
    try {
      effectIndex = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "effect-index.json"), "utf8"));
    } catch (e) {
      effectIndex = {};
    }
  }
  return effectIndex;
}

async function handleApi(req, res, pathname, query) {
  const uid = uidOf(req);
  res.setHeader("Set-Cookie", newUidCookie(uid));
  const parts = pathname.split("/").filter(Boolean); // ["api","project",id,...]

  // /api/projects — daftar proyek & simpan proyek
  if (pathname === "/api/projects") {
    if (req.method === "POST") {
      try {
        const raw = (await readBody(req, 60 * 1024 * 1024)).toString("utf8");
        const body = JSON.parse(raw);
        const id = (body.id && isValidId(body.id)) ? body.id : randId(22);
        const m = readMeta(id) || { createdAt: Date.now(), owner: uid };
        m.name = String(body.name || "Proyek").slice(0, 200);
        m.width = Number(body.width) || 720;
        m.height = Number(body.height) || 1280;
        m.fps = Number(body.fps) || 30;
        if (typeof body.thumb === "string") m.thumb = body.thumb.slice(0, 300000);
        m.lastSeen = Date.now();
        m.updatedAt = Date.now();
        ensureDir(projDir(id));
        if (body.xml) fs.writeFileSync(scenePath(id), String(body.xml));
        writeMeta(id, m);
        return json(res, 200, { ok: true, id, updatedAt: m.updatedAt });
      } catch (e) {
        return json(res, 500, { error: "save_failed", message: e.message });
      }
    }

    const out = [];
    let entries = [];
    try {
      entries = fs.readdirSync(PROJECTS_DIR);
    } catch (e) {}
    for (const id of entries) {
      const m = readMeta(id);
      if (!m) continue;
      if (process.env.OM_MULTIUSER && m.owner && m.owner !== uid) continue;
      let width = m.width;
      let height = m.height;
      let fps = m.fps;
      if (!width || !height) {
        try {
          const xml = fs.readFileSync(scenePath(id), "utf8");
          const mW = xml.match(/width="(\d+)"/);
          const mH = xml.match(/height="(\d+)"/);
          const mF = xml.match(/fps="(\d+)"/);
          if (mW) width = parseInt(mW[1], 10);
          if (mH) height = parseInt(mH[1], 10);
          if (mF) fps = parseInt(mF[1], 10);
        } catch (e) {}
      }
      out.push({
        id,
        name: m.name || "Proyek",
        lastSeen: m.lastSeen || 0,
        updatedAt: m.updatedAt || 0,
        hasPassword: !!m.passwordHash,
        width: width || 720,
        height: height || 1280,
        fps: fps || 30,
        thumb: m.thumb || null
      });
    }
    out.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    json(res, 200, { uid, projects: out });
    return true;
  }

  if (parts[0] === "api" && parts[1] === "project" && isValidId(parts[2])) {
    const id = parts[2];
    const rest = parts.slice(3).join("/");

    // GET /api/project/<id> → meta
    if (req.method === "GET" && rest === "") {
      const m = readMeta(id);
      if (!m) return json(res, 404, { error: "not_found" });
      json(res, 200, { id, name: m.name || "Proyek", hasPassword: !!m.passwordHash, owner: m.owner === uid, updatedAt: m.updatedAt || 0, uploads: m.uploads || [] });
      return true;
    }

    // GET /api/project/<id>/scene → XML (terkunci password kalau diset)
    if (req.method === "GET" && rest === "scene") {
      const m = readMeta(id);
      if (!m) return json(res, 404, { error: "not_found" });
      if (m.passwordHash) {
        const pass = String(req.headers["x-om-pass"] || "");
        if (sha((m.passwordSalt || "") + pass) !== m.passwordHash) {
          return json(res, 401, { error: "need_password" });
        }
      }
      touchMeta(id);
      try {
        const xml = fs.readFileSync(scenePath(id), "utf8");
        res.writeHead(200, { "Content-Type": "application/xml", "Cache-Control": "no-store" });
        res.end(xml);
      } catch (e) {
        json(res, 404, { error: "scene_missing" });
      }
      return true;
    }

    // POST /api/project/<id>/unlock
    if (req.method === "POST" && rest === "unlock") {
      const m = readMeta(id);
      if (!m) return json(res, 404, { error: "not_found" });
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}");
        const ok = sha((m.passwordSalt || "") + String(body.password || "")) === m.passwordHash;
        if (ok) touchMeta(id);
        json(res, ok ? 200 : 403, ok ? { ok: true } : { error: "wrong_password" });
      } catch (e) {
        json(res, 400, { error: "bad_request" });
      }
      return true;
    }

    // POST /api/project/<id> → simpan (nama + xml + opsional password + uploads manifest)
    if (req.method === "POST" && rest === "") {
      try {
        const raw = (await readBody(req, 60 * 1024 * 1024)).toString("utf8");
        let body;
        try {
          body = JSON.parse(raw);
        } catch (e) {
          return json(res, 400, { error: "invalid_json" });
        }
        const m = readMeta(id) || { createdAt: Date.now(), owner: uid };
        if (m.passwordHash && m.owner !== uid) {
          const pass = String(req.headers["x-om-pass"] || body.password || "");
          if (sha((m.passwordSalt || "") + pass) !== m.passwordHash) return json(res, 403, { error: "forbidden" });
        }
        m.name = String(body.name || m.name || "Proyek").slice(0, 200);
        if (body.width) m.width = Number(body.width);
        if (body.height) m.height = Number(body.height);
        if (body.fps) m.fps = Number(body.fps);
        if (typeof body.thumb === "string") m.thumb = body.thumb.slice(0, 300000);
        if (typeof body.password === "string" && body.password.length > 0) {
          m.passwordSalt = m.passwordSalt || randId(12);
          m.passwordHash = sha(m.passwordSalt + body.password);
        }
        if (Array.isArray(body.uploads)) m.uploads = body.uploads.slice(0, 500);
        m.lastSeen = Date.now();
        m.updatedAt = Date.now();
        ensureDir(projDir(id));
        fs.writeFileSync(scenePath(id), String(body.xml || ""));
        writeMeta(id, m);
        json(res, 200, { ok: true, id, updatedAt: m.updatedAt });
      } catch (e) {
        json(res, 500, { error: "save_failed", message: e.message });
      }
      return true;
    }

    // DELETE /api/project/<id>
    if (req.method === "DELETE" && rest === "") {
      try {
        const dir = projDir(id);
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
        json(res, 200, { ok: true, id });
      } catch (e) {
        json(res, 500, { error: "delete_failed", message: e.message });
      }
      return true;
    }

    // POST /api/project/<id>/upload?name=file.png  (raw body = file)
    if (req.method === "POST" && rest === "upload") {
      const m = readMeta(id);
      if (!m) return json(res, 404, { error: "not_found" });
      try {
        const qName = typeof query.get === "function" ? query.get("name") : query.name;
        const name = safeName(qName || "file.bin");
        const buf = await readBody(req, 200 * 1024 * 1024);
        ensureDir(path.join(projDir(id), "uploads"));
        fs.writeFileSync(path.join(projDir(id), "uploads", name), buf);
        m.lastSeen = Date.now();
        writeMeta(id, m);
        json(res, 200, { ok: true, url: `/uploads/${id}/${encodeURIComponent(name)}`, name });
      } catch (e) {
        json(res, 500, { error: "upload_failed", message: e.message });
      }
      return true;
    }
    return false;
  }

  // GET /uploads/<id>/<file>
  if (pathname.startsWith("/uploads/") && req.method === "GET") {
    const id = parts[1];
    const file = parts.slice(2).join("/");
    if (!isValidId(id) || !file) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    const full = path.join(projDir(id), "uploads", path.basename(file));
    if (!full.startsWith(path.join(projDir(id), "uploads")) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
    fs.createReadStream(full).pipe(res);
    return true;
  }
  return false;
}

async function serverHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsedUrl.pathname);
  const query = parsedUrl.query;
  if (pathname === "/") pathname = "/index.html";

  try {
    if (pathname.startsWith("/api/") || pathname.startsWith("/uploads/")) {
      const handled = await handleApi(req, res, pathname, parsedUrl.query);
      if (handled) return;
    }

    // deep-link: /proyek/<id> → app shell; /proyek/... file assets → resolusi dari root
    if (pathname === "/proyek" || pathname.startsWith("/proyek/")) {
      const cleaned = pathname.replace(/^\/proyek(\/[A-Za-z0-9_-]{8,64})?/, "");
      if (/\.[a-z0-9]+$/i.test(cleaned)) {
        pathname = cleaned.startsWith("/") ? cleaned : "/" + cleaned;
      } else {
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        fs.createReadStream(path.join(PUBLIC_DIR, "index.html")).pipe(res);
        return;
      }
    }

    // serve effect XML from local catalog (id -> file in effects/)
    if (pathname === "/api/effect-xml") {
      const effectId = query.id;
      if (effectId) {
        const idx = loadEffectIndex();
        const file = idx[effectId] || (effectId.includes(".") ? idx[effectId.split(".").pop()] : null);
        if (file) {
          const full = path.join(PUBLIC_DIR, "effects", file);
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            res.writeHead(200, {
              "Content-Type": "application/xml",
              "Cache-Control": "no-store",
              "X-Effect-File": file
            });
            fs.createReadStream(full).pipe(res);
            return;
          }
        }
      }
    }

    // effect binary cache lokal
    if (pathname === "/api/effect-bin") {
      const effectId = query.id;
      if (effectId) {
        const cachedBin = path.join(PUBLIC_DIR, "effects", `${effectId}.bin`);
        if (fs.existsSync(cachedBin) && fs.statSync(cachedBin).isFile()) {
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          fs.createReadStream(cachedBin).pipe(res);
          return;
        }
      }
    }

    const localPath = path.join(PUBLIC_DIR, pathname);
    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      const ext = path.extname(localPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const headers = { "Content-Type": contentType };
      if ([".html", ".js", ".json", ".css", ".xml", ""].includes(ext)) headers["Cache-Control"] = "no-store";
      res.writeHead(200, headers);
      fs.createReadStream(localPath).pipe(res);
      return;
    }

    // proxy ke server asset AM
    const remoteOptions = {
      hostname: REMOTE_HOST,
      port: 443,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: REMOTE_HOST,
        referer: `https://${REMOTE_HOST}/runtime/preset.html`
      }
    };
    const proxyReq = https.request(remoteOptions, (proxyRes) => {
      if (res.headersSent || res.writableEnded) {
        proxyRes.resume();
        return;
      }
      if (req.url.match(/\.(html|js|json|css|xml)(\?|$)/)) proxyRes.headers["cache-control"] = "no-store";
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Proxy Error: " + err.message);
    });
    req.pipe(proxyReq);
  } catch (e) {
    try {
      json(res, 500, { error: "server_error", message: e.message });
    } catch (e2) {}
  }
}

module.exports = serverHandler;
module.exports.handler = serverHandler;

if (require.main === module) {
  http.createServer(serverHandler).listen(PORT, () => {
    console.log(`Open Motion server → http://localhost:${PORT}/  (storage: ${ROOT})`);
  });
}
