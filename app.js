// D&D AI GM – Frontend (full, with size sanitizer + STT)

// ----- Defaults (editable in footer; persisted to localStorage) -----
let PROXY_BASE =
  localStorage.getItem("proxyUrl") ||
  "https://dnd-openai-proxy.christestdnd.workers.dev";
let MODEL = localStorage.getItem("model") || "gpt-4o-mini";
let SYSTEM_PROMPT =
  localStorage.getItem("systemPrompt") ||
  "You are a cinematic, fair D&D Game Master. It’s a sandbox. Defer to the player’s setup and house rules. Keep turns brisk and descriptive.";

const els = {
  apiDot: document.getElementById("api-dot"),
  apiText: document.getElementById("api-text"),
  status: document.getElementById("api-status"),
  newSession: document.getElementById("new-session"),
  saveSession: document.getElementById("save-session"),
  sessionList: document.getElementById("session-list"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  genImage: document.getElementById("gen-image"),
  image: document.getElementById("scene-image"),
  imageSize: document.getElementById("image-size"),
  muteMic: document.getElementById("mute-mic"),
  ttsToggle: document.getElementById("tts-toggle"),
  ttsProvider: document.getElementById("tts-provider"),
  ttsUrl: document.getElementById("tts-url"),
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

// ----- Init footer controls -----
els.proxyUrl.value = PROXY_BASE;
els.model.value = MODEL;
els.systemPrompt.value = SYSTEM_PROMPT;

els.proxyUrl.addEventListener("change", () => {
  PROXY_BASE = els.proxyUrl.value.trim();
  localStorage.setItem("proxyUrl", PROXY_BASE);
  checkHealth();
});
els.model.addEventListener("change", () => {
  MODEL = els.model.value.trim();
  session.model = MODEL;
  localStorage.setItem("model", MODEL);
});
els.systemPrompt.addEventListener("change", () => {
  SYSTEM_PROMPT = els.systemPrompt.value;
  session.system = SYSTEM_PROMPT;
  session.messages[0] = { role: "system", content: SYSTEM_PROMPT };
  localStorage.setItem("systemPrompt", SYSTEM_PROMPT);
  saveCurrentSession();
});

// ----- Header buttons -----
els.newSession.onclick = () => {
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
};
els.saveSession.onclick = () => saveCurrentSession();

// ----- Composer (click + Enter) -----
els.send.onclick = sendMessage;
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ----- Image button -----
els.genImage.onclick = generateImage;

// ----- Mic: record → /stt → insert text -----
let rec = null;
let micChunks = [];
let isRecording = false;

els.muteMic.textContent = "🎤 Talk";
els.muteMic.setAttribute("aria-pressed", "false");

els.muteMic.onclick = async () => {
  try {
    if (!isRecording) await startRecording();
    else await stopRecordingAndTranscribe();
  } catch (e) {
    console.error(e);
    alert("Microphone error. Check permissions.");
  }
};

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickSupportedMime();
  micChunks = [];
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) micChunks.push(e.data); };
  rec.start(100);
  isRecording = true;
  els.muteMic.textContent = "⏹️ Stop";
  els.muteMic.setAttribute("aria-pressed", "true");
  pulseStatus(true);
}
async function stopRecordingAndTranscribe() {
  if (!rec) return;
  const stopped = new Promise(res => (rec.onstop = res));
  rec.stop();
  await stopped;
  rec.stream.getTracks().forEach(t => t.stop());
  isRecording = false;
  els.muteMic.textContent = "🎤 Talk";
  els.muteMic.setAttribute("aria-pressed", "false");
  pulseStatus(false);

  const blob = new Blob(micChunks, { type: rec.mimeType || "audio/webm" });
  await transcribeBlob(blob);
}
function pickSupportedMime() {
  const prefs = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/mpeg'
  ];
  for (const m of prefs) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
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
  dot.style.boxShadow = on ? "0 0 12px var(--success)" : "";
}

// ----- TTS -----
const TTS = {
  speak(text) {
    const mode = els.ttsProvider.value;
    if (mode === "webspeech") return webSpeechSpeak(text);
    if (mode === "custom") return customHttpSpeak(text);
  },
};
function webSpeechSpeak(text) {
  if (!("speechSynthesis" in window)) {
    alert("Web Speech API not supported in this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
  window.speechSynthesis.speak(u);
}
async function customHttpSpeak(text) {
  const url = els.ttsUrl.value.trim();
  if (!url) { alert("Set a Custom TTS endpoint URL first."); return; }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const audio = new Audio(objUrl);
    await audio.play();
  } catch (err) {
    console.error(err);
    alert("Custom TTS failed. Check CORS and endpoint.");
  }
}
els.ttsToggle.onclick = () => {
  const last = [...session.messages].reverse().find((m) => m.role === "assistant");
  if (last) TTS.speak(last.content);
};

// ----- Chat send & stream -----
async function sendMessage() {
  const text = els.input.value.trim();
  if (!text) return;
  if (!PROXY_BASE) {
    appendMessage("assistant", "⚠️ Set a Proxy URL in the footer first.");
    return;
  }

  appendMessage("user", text);
  session.messages.push({ role: "user", content: text });
  saveCurrentSession();
  els.input.value = "";

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

// ----- Image generation (b64_json OR url + size sanitizer) -----
async function generateImage() {
  if (!session.lastGMUtterance) { alert("No GM narration yet. Send a message first."); return; }
  if (!PROXY_BASE) { alert("Set a Proxy URL in the footer first."); return; }

  // Sanitize size (valid: 256x256, 512x512, 1024x1024)
  const chosen = (els.imageSize?.value || "1024x1024").toLowerCase();
  const allowed = new Set(["256x256", "512x512", "1024x1024"]);
  const safeSize = allowed.has(chosen)
    ? chosen
    : (chosen.includes("768") ? "512x512" : "1024x1024");

  const prompt = `D&D scene: ${session.lastGMUtterance}
Style: painterly, high detail, cinematic lighting.`;

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
    els.status.classList.remove("ok", "err");
    els.apiText.textContent = "Set proxy URL ↓";
    return;
  }
  try {
    const res = await fetch(`${PROXY_BASE}/health`, { method: "GET", cache: "no-store" });
    if (res.ok) {
      els.status.classList.add("ok");
      els.status.classList.remove("err");
      els.apiText.textContent = "Connected";
    } else {
      els.status.classList.add("err");
      els.status.classList.remove("ok");
      els.apiText.textContent = "Unavailable";
    }
  } catch {
    els.status.classList.add("err");
    els.status.classList.remove("ok");
    els.apiText.textContent = "Offline";
  }
}

checkHealth();
renderSessions();
