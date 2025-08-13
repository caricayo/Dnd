// D&D AI GM – Frontend (beautified UI support + STT + autospeak + sidebar toggle)

// ----- Defaults (editable in footer; persisted to localStorage) -----
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
  ttsProvider: document.getElementById("tts-provider"),
  ttsUrl: document.getElementById("tts-url"),

  // footer settings
  proxyUrl: document.getElementById("proxy-url"),
  model: document.getElementById("model"),
  systemPrompt: document.getElementById("system-prompt"),
};

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
const TTS = {
  speak(text) {
    const mode = els.ttsProvider?.value || "webspeech";
    if (mode === "custom") {
      const url = (els.ttsUrl?.value || "").trim();
      if (url) return customHttpSpeak(text); // use your Worker /tts
      return webSpeechSpeak(text);           // fallback if URL missing
    }
    return webSpeechSpeak(text);
  },
};

function webSpeechSpeak(text) {
  if (!("speechSynthesis" in window)) {
    console.warn("Web Speech API not supported in this browser.");
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
    window.speechSynthesis.speak(u);
  } catch (e) {
    console.error("Web Speech failed:", e);
  }
}

async function customHttpSpeak(text) {
  const url = (els.ttsUrl?.value || "").trim();
  if (!url) return; // silent no-op if not set
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error("TTS HTTP", res.status, await res.text());
      return;
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const audio = new Audio(objUrl);
    await audio.play();
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
  sessions
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((s) => {
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
    const firstUser = session.messages.find(
      (m) => m.role === "user" && (m.content || "").trim()
    );
    if (firstUser) session.title = firstUser.content.slice(0, 40);
  }
  const all = getAllSessions();
  const idx = all.findIndex((s) => s.id === session.id);
  if (idx >= 0) all[idx] = session;
  else all.push(session);
  localStorage.setItem("dndSessions", JSON.stringify(all));
  renderSessions();
}
function loadSession(id) {
  const all = getAllSessions();
  const found = all.find((s) => s.id === id);
  if (!found) return;
  session = found;
  els.messages.innerHTML = "";
  session.messages.forEach((m) => appendMessage(m.role, m.content));
  scrollMessagesToEnd();
}

// Force TTS to Custom + your URL every load
if (els.ttsProvider) els.ttsProvider.value = "custom";
if (els.ttsUrl) els.ttsUrl.value = "https://dnd-openai-proxy.christestdnd.workers.dev/tts";
localStorage.setItem("ttsProvider", "custom");
localStorage.setItem("ttsUrl", "https://dnd-openai-proxy.christestdnd.workers.dev/tts");


// ----- Sidebar toggle (collapsible settings) -----
if (els.sidebarToggle && els.sidebar) {
  // Start collapsed on small screens
  const startCollapsed = window.matchMedia("(max-width: 900px)").matches;
  if (startCollapsed) els.sidebar.classList.add("collapsed");

  els.sidebarToggle.addEventListener("click", () => {
    els.sidebar.classList.toggle("collapsed");
  });
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
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ----- Image buttons -----
els.genImage && (els.genImage.onclick = generateImage);
els.clearImage && (els.clearImage.onclick = () => {
  if (els.image) {
    els.image.removeAttribute("src");
    els.image.alt = "Generated scene will appear here";
  }
});

// ----- Mic: record → /stt → insert text -----
let rec = null;
let micChunks = [];
let isRecording = false;

if (els.muteMic) {
  els.muteMic.textContent = "🎤 On";
  els.muteMic.setAttribute("aria-pressed", "true");
  els.muteMic.onclick = async () => {
    try {
      if (!isRecording) await startRecording();
      else await stopRecordingAndTranscribe();
    } catch (e) {
      console.error(e);
      alert("Microphone error. Check permissions.");
    }
  };
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickSupportedMime();
  micChunks = [];
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) micChunks.push(e.data); };
  rec.start(100);
  isRecording = true;
  if (els.muteMic) {
    els.muteMic.textContent = "⏹️ Stop";
    els.muteMic.setAttribute("aria-pressed", "false");
  }
  pulseStatus(true);
}
async function stopRecordingAndTranscribe() {
  if (!rec) return;
  const stopped = new Promise(res => (rec.onstop = res));
  rec.stop();
  await stopped;
  rec.stream.getTracks().forEach(t => t.stop());
  isRecording = false;
  if (els.muteMic) {
    els.muteMic.textContent = "🎤 On";
    els.muteMic.setAttribute("aria-pressed", "true");
  }
  pulseStatus(false);

  const blob = new Blob(micChunks, { type: rec.mimeType || "audio/webm" });
  await transcribeBlob(blob);
}
function pickSupportedMime() {
  const prefs = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/mpeg",
  ];
  for (const m of prefs) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
async function transcribeBlob(blob) {
  if (!PROXY_BASE) { alert("Set a Proxy URL first."); return; }
  try {
    const form = new FormData();
    const fileName = blob.type.includes("mp4") ? "speech.mp4"
                    : blob.type.includes("mpeg") ? "speech.mp3"
                    : "speech.webm";
    form.append("file", blob, fileName);

    const res = await fetch(`${PROXY_BASE}/stt`, { method: "POST", body: form });
    const raw = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw || "STT error"}`);
    const data = JSON.parse(raw);
    const text = data?.text?.trim();
    if (text) {
      els.input.value = (els.input.value ? (els.input.value + " ") : "") + text;
      scrollMessagesToEnd();
    } else {
      alert("No transcription text returned.");
    }
  } catch (err) {
    console.error(err);
    alert(`Transcription failed: ${err.message}`);
  }
}
function pulseStatus(on) {
  const dot = els.apiDot;
  if (!dot) return;
  dot.style.boxShadow = on ? "0 0 12px var(--success)" : "";
}

// ----- TTS manual button -----
els.ttsToggle && (els.ttsToggle.onclick = () => {
  const last = [...session.messages].reverse().find((m) => m.role === "assistant");
  if (last && last.content) TTS.speak(last.content);
});

// ----- Chat send & stream (SSE parsed) -----
async function sendMessage() {
  const text = (els.input?.value || "").trim();
  if (!text) return;
  if (!PROXY_BASE) {
    appendMessage("assistant", "⚠️ Set a Proxy URL in the sidebar first.");
    return;
  }

  appendMessage("user", text);
  session.messages.push({ role: "user", content: text });
  saveCurrentSession();
  if (els.input) els.input.value = "";

  try {
    const res = await fetch(`${PROXY_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: session.model || MODEL,
        messages: pruneMessages(session.messages),
      }),
    });

    if (!res.ok || !res.body) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errTxt || "No response body"}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const assistantEl = appendMessage("assistant", "");
    let buffer = "";
    let gmText = "";

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

          // Auto-speak after reply finishes
          if (AUTO_SPEAK && gmText) {
            TTS.speak(gmText);
          }
          return;
        }

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            gmText += delta;
            assistantEl.querySelector(".content").textContent = gmText;
          }
        } catch (err) {
          console.error("JSON parse error", err);
        }
      }
    }
  } catch (err) {
    console.error(err);
    appendMessage("assistant", `⚠️ ${err.message}`);
  } finally {
    scrollMessagesToEnd();
  }
}

// ----- Image generation (spinner + prompt cap ≤ 1000 + size sanitizer) -----
async function generateImage() {
  if (!session.lastGMUtterance) { alert("No GM narration yet. Send a message first."); return; }
  if (!PROXY_BASE) { alert("Set a Proxy URL in the sidebar first."); return; }

  // Show loading state on the button
  els.genImage.textContent = "🔄 Generating...";
  els.genImage.disabled = true;

  // Sanitize size (supports square/portrait/landscape + safe fallback)
  const chosen = (els.imageSize?.value || "1024x1024").toLowerCase();
  const allowed = new Set(["256x256", "512x512", "1024x1024", "1024x1536", "1536x1024"]);
  const safeSize = allowed.has(chosen)
    ? chosen
    : (chosen.includes("768") ? "512x512" : "1024x1024");

  // Build prompt with ≤ 1000 chars (include styling text in calculation)
  const STYLE = "Style: painterly, high detail, cinematic lighting.";
  const PREFIX = "D&D scene: ";
  const SEP = "\n";
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
    } else if (item?.url) {
      els.image.src = item.url;
    } else {
      throw new Error("No image data returned (expected b64_json or url).");
    }
  } catch (err) {
    console.error(err);
    alert(`Image generation failed: ${err.message}`);
  } finally {
    // Reset button state
    els.genImage.textContent = "🎨 Generate Scene";
    els.genImage.disabled = false;
  }
}

// ----- Helpers -----
function pruneMessages(msgs, maxTokens = 3500, hardLimit = 24) {
  const out = [];
  let count = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const approx = Math.ceil(((m.content || "").length) / 3);
    if (m.role === "system") { out.push(m); continue; }
    if (count + approx > maxTokens || out.length > hardLimit) break;
    out.push(m);
    count += approx;
  }
  const sys = msgs.find((m) => m.role === "system");
  const reversed = out.reverse();
  if (!reversed.find((m) => m.role === "system") && sys) reversed.unshift(sys);
  return reversed;
}

function appendMessage(role, content) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role}`;
  wrapper.innerHTML = `<div class="role">${role}</div>
                       <div class="content"></div>`;
  wrapper.querySelector(".content").textContent = content;
  els.messages.appendChild(wrapper);
  scrollMessagesToEnd();
  return wrapper;
}
function scrollMessagesToEnd() {
  els.messages.scrollTop = els.messages.scrollHeight;
}
function escapeHtml(s) {
  return s.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[c]));
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
      els.status?.classList.add("ok");
      els.status?.classList.remove("err");
      if (els.apiText) els.apiText.textContent = "Connected";
      if (els.apiDot) els.apiDot.style.background = "var(--success)";
    } else {
      els.status?.classList.add("err");
      els.status?.classList.remove("ok");
      if (els.apiText) els.apiText.textContent = "Unavailable";
      if (els.apiDot) els.apiDot.style.background = "var(--danger)";
    }
  } catch {
    els.status?.classList.add("err");
    els.status?.classList.remove("ok");
    if (els.apiText) els.apiText.textContent = "Offline";
    if (els.apiDot) els.apiDot.style.background = "var(--danger)";
  }
}

checkHealth();
renderSessions();
