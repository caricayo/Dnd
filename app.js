// D&D AI GM – Frontend (beautified UI + STT + autospeak + lightbox + mobile polish)

// ----- Defaults (editable in sidebar; persisted to localStorage) -----
let PROXY_BASE =
  localStorage.getItem("proxyUrl") ||
  "https://dnd-openai-proxy.christestdnd.workers.dev";
let MODEL = localStorage.getItem("model") || "gpt-4o-mini";
let SYSTEM_PROMPT =
  localStorage.getItem("systemPrompt") ||
  "You are a cinematic, fair D&D Game Master. It’s a sandbox. Defer to the player’s setup and house rules. Keep turns brisk and descriptive.";
const AUTO_SPEAK = true; // speak AI replies automatically (set false to disable)

// ----- DOM refs -----
const els = {
  // header/status
  apiDot: document.getElementById("api-dot"),
  apiText: document.getElementById("api-text"),
  status: document.getElementById("api-status"),

  // sidebar + controls
  sidebarToggle: document.getElementById("sidebar-toggle"),
  sidebar: document.getElementById("sidebar"),
  newSession: document.getElementById("new-session"),
  saveSession: document.getElementById("save-session"),
  sessionList: document.getElementById("session-list"),

  // chat
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),

  // image
  genImage: document.getElementById("gen-image"),
  image: document.getElementById("scene-image"),
  imageSize: document.getElementById("image-size"),
  clearImage: document.getElementById("clear-image"),

  // voice
  muteMic: document.getElementById("mute-mic"),
  ttsToggle: document.getElementById("tts-toggle"),
  ttsStop: document.getElementById("tts-stop"),
  ttsProvider: document.getElementById("tts-provider"),
  ttsUrl: document.getElementById("tts-url"),

  // footer settings
  proxyUrl: document.getElementById("proxy-url"),
  model: document.getElementById("model"),
  systemPrompt: document.getElementById("system-prompt"),

  // lightbox
  lightbox: document.getElementById("image-lightbox"),
  lightboxImg: document.getElementById("lightbox-img"),
};

55  async function speakViaProvider(text) {
56    try {
57      if (!text) { return; }
58
59      if (els.ttsProvider && els.ttsProvider.value === "webspeech") {
60        if (!("speechSynthesis" in window)) {
61          console.warn("Web Speech API not supported.");
62        } else {
63          try {
64            window.speechSynthesis.cancel();
65            const u = new SpeechSynthesisUtterance(text);
66            u.rate = 1;
67            u.pitch = 1;
68            u.volume = 1;
69            window.speechSynthesis.speak(u);
70          } catch (e) {
71            console.error("Web Speech failed:", e);
72          }
73        }
74      } else if (els.ttsProvider && els.ttsProvider.value === "worker") {
75        if (typeof customHttpSpeak === "function") {
76          await customHttpSpeak(
77            text,
78            (typeof PROXY_BASE !== "undefined" ? PROXY_BASE : "") + "/tts"
79          );
80        }
81      } else {
82        if (typeof customHttpSpeak === "function") {
83          const url = (els.ttsUrl && els.ttsUrl.value) ? els.ttsUrl.value.trim() : "";
84          await customHttpSpeak(text, url || undefined);
85        }
86      }
87    } catch (e) {
88      console.error("speakViaProvider failed:", e);
89    }
90  }


// ----- Image Lightbox (open/close) -----
function openLightbox(src) {
  if (!src || !els.lightbox || !els.lightboxImg) return;
  els.lightboxImg.src = src;
  els.lightbox.classList.remove("hidden");
  els.lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}
function closeLightbox() {
  if (!els.lightbox) return;
  els.lightbox.classList.add("hidden");
  els.lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
  if (els.lightboxImg) els.lightboxImg.removeAttribute("src");
}
if (els.image) {
  els.image.style.cursor = "zoom-in";
  els.image.addEventListener("click", () => {
    const src = els.image.getAttribute("src");
    if (src) openLightbox(src);
  });
}
if (els.lightbox) els.lightbox.addEventListener("click", closeLightbox);
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

// ----- Move the Scene Art panel into the sidebar on mobile -----
(function relocateSceneArt() {
  const scenePanel = document.querySelector(".image-panel");
  const panels = document.querySelector(".panels");
  const mobileSlot = document.getElementById("mobile-scene-slot");
  if (!scenePanel || !panels || !mobileSlot) return;

  const mq = window.matchMedia("(max-width: 900px)");
  function apply() {
    if (mq.matches) {
      if (!mobileSlot.contains(scenePanel)) mobileSlot.appendChild(scenePanel);
    } else {
      if (!panels.contains(scenePanel)) panels.insertBefore(scenePanel, panels.firstChild);
    }
  }
  mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply);
  apply();
})();

// ---- Mobile audio unlock (required for iOS/Android autoplay policies) ----
let AUDIO_UNLOCKED = false;
function unlockAudioOnce() {
  if (AUDIO_UNLOCKED) return;
  try {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0; window.speechSynthesis.speak(u);
    }
  } catch {}
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(0);
      if (ctx.state === "suspended") ctx.resume();
    }
  } catch {}
  try {
    const a = new Audio("data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA");
    a.muted = true; const p = a.play(); if (p && p.catch) p.catch(() => {});
  } catch {}
  AUDIO_UNLOCKED = true;
  document.removeEventListener("touchstart", unlockAudioOnce);
  document.removeEventListener("click", unlockAudioOnce);
}
document.addEventListener("touchstart", unlockAudioOnce, { once: true, passive: true });
document.addEventListener("click", unlockAudioOnce, { once: true });

// ----- Session state -----
let session = {
  id: crypto.randomUUID(),
  title: "New Campaign",
  system: SYSTEM_PROMPT,
  model: MODEL,
  messages: [{ role: "system", content: SYSTEM_PROMPT }],
  lastGMUtterance: "",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ===== TTS (define BEFORE any usage) =====
let currentAudio = null;    // active <audio> element (Custom TTS)
let currentAudioUrl = null; // blob URL to revoke

function stopSpeaking() {
  if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch {} }
  try {
    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  } catch {}
  currentAudio = null; currentAudioUrl = null;
}
const TTS = {
  speak(text) {
    unlockAudioOnce();
    stopSpeaking();
    return speakViaProvider(text);
  },
};

async function customHttpSpeak(text, urlOverride) {
   try {
    const url = (urlOverride && urlOverride.trim) ? urlOverride.trim() : ((els.ttsUrl?.value || "").trim());
     if (!url) return;
     const res = await fetch(url, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ text })
    });
     if (!res.ok) {
       console.error("TTS HTTP", res.status, await res.text());
       return;
     }
     const blob = await res.blob();
    currentAudioUrl = URL.createObjectURL(blob);
     currentAudio = new Audio(currentAudioUrl);
    currentAudio.onended = () => {
       try { if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl); } catch {}
       currentAudio = null; currentAudioUrl = null;
     };
     await currentAudio.play();
   } catch (err) {
     console.error("Custom TTS failed:", err);
   }
 }

// ----- Sessions: save/load/list -----
function getAllSessions() {
  const raw = localStorage.getItem("dndSessions");
  return raw ? JSON.parse(raw) : [];
}
function renderSessions() {
  const sessions = getAllSessions();
  els.sessionList.innerHTML = "";
  sessions.sort((a,b)=>b.updatedAt-a.updatedAt).forEach((s) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="title">${escapeHtml(s.title || "Untitled")}</span>
                    <span class="meta">${new Date(s.updatedAt).toLocaleString()}</span>`;
    li.onclick = () => loadSession(s.id);
    els.sessionList.appendChild(li);
  });
}
function saveCurrentSession() {
  session.updatedAt = Date.now();
  if (!session.title || session.title === "New Campaign") {
    const firstUser = session.messages.find((m)=>m.role==="user" && (m.content||"").trim());
    if (firstUser) session.title = firstUser.content.slice(0,40);
  }
  const all = getAllSessions();
  const idx = all.findIndex((s)=>s.id===session.id);
  if (idx>=0) all[idx]=session; else all.push(session);
  localStorage.setItem("dndSessions", JSON.stringify(all));
  renderSessions();
}
function loadSession(id) {
  const all = getAllSessions();
  const found = all.find((s)=>s.id===id);
  if (!found) return;
  session = found;
  els.messages.innerHTML = "";
  session.messages.forEach((m)=>appendMessage(m.role, m.content));
  scrollMessagesToEnd();
}

// ----- Init sidebar fields -----
if (els.proxyUrl) els.proxyUrl.value = PROXY_BASE;
if (els.model) els.model.value = MODEL;
if (els.systemPrompt) els.systemPrompt.value = SYSTEM_PROMPT;

// Force TTS to Custom + your URL every load (and remember it)
if (els.ttsProvider) els.ttsProvider.value = "custom";
if (els.ttsUrl) els.ttsUrl.value = "https://dnd-openai-proxy.christestdnd.workers.dev/tts";
localStorage.setItem("ttsProvider", "custom");
localStorage.setItem("ttsUrl", "https://dnd-openai-proxy.christestdnd.workers.dev/tts");

els.proxyUrl?.addEventListener("change", () => {
  PROXY_BASE = els.proxyUrl.value.trim();
  localStorage.setItem("proxyUrl", PROXY_BASE);
  checkHealth();
});
els.model?.addEventListener("change", () => {
  MODEL = els.model.value.trim();
  session.model = MODEL;
  localStorage.setItem("model", MODEL);
});
els.systemPrompt?.addEventListener("change", () => {
  SYSTEM_PROMPT = els.systemPrompt.value;
  session.system = SYSTEM_PROMPT;
  session.messages[0] = { role: "system", content: SYSTEM_PROMPT };
  localStorage.setItem("systemPrompt", SYSTEM_PROMPT);
  saveCurrentSession();
});
els.ttsProvider?.addEventListener("change", () => {
  localStorage.setItem("ttsProvider", els.ttsProvider.value);
});
els.ttsUrl?.addEventListener("change", () => {
  localStorage.setItem("ttsUrl", els.ttsUrl.value.trim());
});

// ----- Sidebar toggle -----
if (els.sidebarToggle && els.sidebar) {
  const startCollapsed = window.matchMedia("(max-width: 900px)").matches;
  if (startCollapsed) els.sidebar.classList.add("collapsed");
  els.sidebarToggle.addEventListener("click", () => els.sidebar.classList.toggle("collapsed"));
}

// ----- Header buttons -----
els.newSession && (els.newSession.onclick = () => {
  session = {
    id: crypto.randomUUID(),
    title: "New Campaign",
    system: SYSTEM_PROMPT,
    model: MODEL,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    lastGMUtterance: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  els.messages.innerHTML = "";
  renderSessions();
  saveCurrentSession();
});
els.saveSession && (els.saveSession.onclick = () => saveCurrentSession());

// ----- Composer (click + Enter) -----
els.send && (els.send.onclick = sendMessage);
els.input?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ----- Image buttons -----
els.genImage && (els.genImage.onclick = generateImage);
els.clearImage && (els.clearImage.onclick = () => {
  if (els.image) { els.image.removeAttribute("src"); els.image.alt = "Generated scene will appear here"; }
});

// ----- Mic: record → /stt → insert text -----
let rec = null, micChunks = [], isRecording = false;
if (els.muteMic) {
  els.muteMic.textContent = "🎤 On";
  els.muteMic.setAttribute("aria-pressed","true");
  els.muteMic.onclick = async () => {
    try { if (!isRecording) await startRecording(); else await stopRecordingAndTranscribe(); }
    catch(e){ console.error(e); alert("Microphone error. Check permissions."); }
  };
}
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickSupportedMime();
  micChunks = [];
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e)=>{ if (e.data && e.data.size>0) micChunks.push(e.data); };
  rec.start(100);
  isRecording = true;
  if (els.muteMic) { els.muteMic.textContent = "⏹️ Stop"; els.muteMic.setAttribute("aria-pressed","false"); }
  pulseStatus(true);
}
async function stopRecordingAndTranscribe() {
  if (!rec) return;
  const stopped = new Promise(res => (rec.onstop = res));
  rec.stop(); await stopped;
  rec.stream.getTracks().forEach(t=>t.stop());
  isRecording = false;
  if (els.muteMic) { els.muteMic.textContent = "🎤 On"; els.muteMic.setAttribute("aria-pressed","true"); }
  pulseStatus(false);
  const blob = new Blob(micChunks, { type: rec.mimeType || "audio/webm" });
  await transcribeBlob(blob);
}
function pickSupportedMime() {
  const prefs = ["audio/webm;codecs=opus","audio/webm","audio/mp4;codecs=mp4a.40.2","audio/mp4","audio/mpeg"];
  for (const m of prefs) { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; }
  return "";
}
async function transcribeBlob(blob) {
  if (!PROXY_BASE) { alert("Set a Proxy URL first."); return; }
  try {
    const form = new FormData();
    const fileName = blob.type.includes("mp4") ? "speech.mp4" : blob.type.includes("mpeg") ? "speech.mp3" : "speech.webm";
    form.append("file", blob, fileName);
    const res = await fetch(`${PROXY_BASE}/stt`, { method:"POST", body: form });
    const raw = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw || "STT error"}`);
    const data = JSON.parse(raw);
    const text = data?.text?.trim();
    if (text) { els.input.value = (els.input.value ? (els.input.value + " ") : "") + text; scrollMessagesToEnd(); }
    else { alert("No transcription text returned."); }
  } catch(err){ console.error(err); alert(`Transcription failed: ${err.message}`); }
}
function pulseStatus(on) {
  const dot = els.apiDot; if (!dot) return;
  dot.style.boxShadow = on ? "0 0 12px var(--success)" : "";
}

// ----- TTS buttons -----
els.ttsToggle && (els.ttsToggle.onclick = () => {
  const last = [...session.messages].reverse().find((m)=>m.role==="assistant");
  if (last && last.content) TTS.speak(last.content);
});
els.ttsStop && (els.ttsStop.onclick = stopSpeaking);

// ----- Chat send & stream (SSE parsed) -----
async function sendMessage() {
  const text = (els.input?.value || "").trim();
  if (!text) return;
  if (!PROXY_BASE) { appendMessage("assistant","⚠️ Set a Proxy URL in the sidebar first."); return; }

  appendMessage("user", text);
  session.messages.push({ role: "user", content: text });
  saveCurrentSession();
  if (els.input) els.input.value = "";

  try {
    const res = await fetch(`${PROXY_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: session.model || MODEL, messages: pruneMessages(session.messages) }),
    });
    if (!res.ok || !res.body) {
      const errTxt = await res.text().catch(()=> "");
      throw new Error(`HTTP ${res.status}: ${errTxt || "No response body"}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const assistantEl = appendMessage("assistant", "");
    let buffer = "", gmText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep last partial line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          session.messages.push({ role: "assistant", content: gmText });
          session.lastGMUtterance = gmText;
          saveCurrentSession();
          if (AUTO_SPEAK && gmText) TTS.speak(gmText);
          return;
        }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            gmText += delta;
            assistantEl.querySelector(".content").textContent = gmText;
          }
        } catch (err) { console.error("JSON parse error", err); }
      }
    }
  } catch (err) {
    console.error(err);
    appendMessage("assistant", `⚠️ ${err.message}`);
  } finally {
    scrollMessagesToEnd();
  }
}

// ----- Image generation (spinner + prompt cap ≤ 1000 + safe size mapping) -----
async function generateImage() {
  if (!session.lastGMUtterance) { alert("No GM narration yet. Send a message first."); return; }
  if (!PROXY_BASE) { alert("Set a Proxy URL in the sidebar first."); return; }

  els.genImage.textContent = "🔄 Generating...";
  els.genImage.disabled = true;

  // Upstream supports ONLY: 256x256, 512x512, 1024x1024. Map others to 1024x1024.
  const chosen = (els.imageSize?.value || "1024x1024").toLowerCase();
  const upstreamAllowed = new Set(["256x256", "512x512", "1024x1024"]);
  const safeSize = upstreamAllowed.has(chosen) ? chosen : "1024x1024";

  // Build prompt with ≤ 1000 chars
  const STYLE = "Style: painterly, high detail, cinematic lighting.";
  const PREFIX = "D&D scene: "; const SEP = "\n";
  let scene = (session.lastGMUtterance || "").trim();
  let available = 1000 - (PREFIX.length + SEP.length + STYLE.length);
  if (available < 0) available = 0;
  if (scene.length > available) scene = scene.slice(0, available);
  const prompt = `${PREFIX}${scene}${SEP}${STYLE}`;

  try {
    const res = await fetch(`${PROXY_BASE}/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, size: safeSize }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw || "Image error"}`);
    const data = JSON.parse(raw);
    const item = data?.data?.[0];
    if (item?.b64_json) {
      els.image.src = `data:image/png;base64,${item.b64_json}`;
      // openLightbox(els.image.src); // uncomment if you want auto-open
    } else if (item?.url) {
      els.image.src = item.url;
      // openLightbox(els.image.src);
    } else {
      throw new Error("No image data returned (expected b64_json or url).");
    }
  } catch (err) {
    console.error(err);
    alert(`Image generation failed: ${err.message}`);
  } finally {
    els.genImage.textContent = "🎨 Generate Scene";
    els.genImage.disabled = false;
  }
}

// ----- Helpers -----
function pruneMessages(msgs, maxTokens = 3500, hardLimit = 24) {
  const out = []; let count = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const approx = Math.ceil(((m.content || "").length) / 3);
    if (m.role === "system") { out.push(m); continue; }
    if (count + approx > maxTokens || out.length > hardLimit) break;
    out.push(m); count += approx;
  }
  const sys = msgs.find((m)=>m.role==="system");
  const reversed = out.reverse();
  if (!reversed.find((m)=>m.role==="system") && sys) reversed.unshift(sys);
  return reversed;
}

function appendMessage(role, content) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role}`;

  // grouping: if previous message has same role, mark this one as continued
  const last = els.messages.lastElementChild;
  if (last && last.classList.contains(role)) wrapper.classList.add("continued");

  wrapper.innerHTML = `
    <div class="role">${role.toUpperCase()}</div>
    <div class="content"></div>
  `;
  wrapper.querySelector(".content").textContent = content || "";
  els.messages.appendChild(wrapper);
  scrollMessagesToEnd();
  return wrapper;
}

function scrollMessagesToEnd() {
  if (!els.messages) return;
  els.messages.scrollTo({ top: els.messages.scrollHeight, behavior: "smooth" });
}

// Simple HTML escaping to prevent injection in session names, messages, etc.
function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ----- Health indicator -----
async function checkHealth() {
  if (!PROXY_BASE) {
    els.status?.classList.remove("ok", "err");
    if (els.apiText) els.apiText.textContent = "Set proxy URL →";
    return;
  }
  try {
    const res = await fetch(`${PROXY_BASE}/health`, { method: "GET", cache: "no-store" });
    if (res.ok) {
      els.status?.classList.add("ok"); els.status?.classList.remove("err");
      if (els.apiText) els.apiText.textContent = "Connected";
      if (els.apiDot) els.apiDot.style.background = "var(--success)";
    } else {
      els.status?.classList.add("err"); els.status?.classList.remove("ok");
      if (els.apiText) els.apiText.textContent = "Unavailable";
      if (els.apiDot) els.apiDot.style.background = "var(--danger)";
    }
  } catch {
    els.status?.classList.add("err"); els.status?.classList.remove("ok");
    if (els.apiText) els.apiText.textContent = "Offline";
    if (els.apiDot) els.apiDot.style.background = "var(--danger)";
  }
}

checkHealth();
renderSessions();

// Keep composer visible above the mobile keyboard (iOS/Android)
(function keyboardSafeArea() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const kb = Math.max(0, window.innerHeight - vv.height);
    document.documentElement.style.setProperty('--kb', kb + 'px');
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
})();

// --- Added: simple recording status ---
function setRecordingUI(isRec) {
  const btn = document.getElementById("mic");
  if (!btn) return;
  btn.setAttribute("aria-pressed", isRec ? "true" : "false");
  btn.title = isRec ? "Listening…" : "Start voice input";
}
