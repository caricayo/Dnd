// D&D AI GM – Frontend
// Set this to your Cloudflare Worker proxy URL at runtime via footer input.
let PROXY_BASE = localStorage.getItem("proxyUrl") || "";
let MODEL = localStorage.getItem("model") || "gpt-4o-mini";
let SYSTEM_PROMPT = localStorage.getItem("systemPrompt") || "You are a cinematic, fair D&D Game Master. It’s a sandbox. Defer to the player’s setup and house rules. Keep turns brisk and descriptive.";

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

// --- Session state & persistence ---
let session = {
  id: crypto.randomUUID(),
  title: "New Campaign",
  system: SYSTEM_PROMPT,
  model: MODEL,
  messages: [
    { role: "system", content: SYSTEM_PROMPT }
  ],
  lastGMUtterance: "",
  createdAt: Date.now(),
  updatedAt: Date.now()
};

function renderSessions() {
  const sessions = getAllSessions();
  els.sessionList.innerHTML = "";
  sessions.sort((a,b)=>b.updatedAt-a.updatedAt).forEach(s => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="title">${escapeHtml(s.title)}</span>
                    <span class="meta">${new Date(s.updatedAt).toLocaleString()}</span>`;
    li.onclick = () => loadSession(s.id);
    els.sessionList.appendChild(li);
  });
}
function getAllSessions() {
  const raw = localStorage.getItem("dndSessions");
  return raw ? JSON.parse(raw) : [];
}
function saveCurrentSession() {
  session.updatedAt = Date.now();
  if (!session.title || session.title === "New Campaign") {
    const firstUser = session.messages.find(m => m.role === "user" && m.content.trim());
    if (firstUser) session.title = firstUser.content.slice(0, 40);
  }
  const all = getAllSessions();
  const idx = all.findIndex(s => s.id === session.id);
  if (idx >= 0) all[idx] = session; else all.push(session);
  localStorage.setItem("dndSessions", JSON.stringify(all));
  renderSessions();
}
function loadSession(id) {
  const all = getAllSessions();
  const found = all.find(s => s.id === id);
  if (!found) return;
  session = found;
  els.messages.innerHTML = "";
  session.messages.forEach(m => appendMessage(m.role, m.content));
  scrollMessagesToEnd();
}

// --- UI init & bindings ---
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

els.send.onclick = sendMessage;
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

els.genImage.onclick = generateImage;

// --- Messaging & streaming ---
async function sendMessage() {
  const text = els.input.value.trim();
  if (!text) return;
  appendMessage("user", text);
  session.messages.push({ role: "user", content: text });
  saveCurrentSession();
  els.input.value = "";

  try {
    const url = `${PROXY_BASE}/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: session.model || MODEL,
        messages: pruneMessages(session.messages),
      })
    });

    if (!res.ok || !res.body) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errTxt || "No response body"}`);
    }

    const reader = res.body.getReader();
    let gmText = "";
    const decoder = new TextDecoder();
    const assistantEl = appendMessage("assistant", "");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      gmText += decoder.decode(value);
      assistantEl.querySelector(".content").textContent = gmText;
    }
    session.messages.push({ role: "assistant", content: gmText });
    session.lastGMUtterance = gmText;
    saveCurrentSession();

  } catch (err) {
    console.error(err);
    appendMessage("assistant", `⚠️ ${err.message}`);
  } finally {
    scrollMessagesToEnd();
  }
}

// --- Helper functions ---
function pruneMessages(msgs, maxTokens = 3500, hardLimit = 24) {
  const out = [];
  let count = 0;
  for (let i = msgs.length-1; i >= 0; i--) {
    const m = msgs[i];
    const approx = Math.ceil((m.content||"").length / 3);
    if (m.role === "system") { out.push(m); continue; }
    if (count + approx > maxTokens || out.length > hardLimit) break;
    out.push(m);
    count += approx;
  }
  const sys = msgs.find(m => m.role === "system");
  const reversed = out.reverse();
  if (!reversed.find(m=>m.role==="system") && sys) reversed.unshift(sys);
  return reversed;
}

async function generateImage() {
  if (!session.lastGMUtterance) {
    alert("No GM narration yet. Send a message first.");
    return;
  }
  const prompt = `D&D scene: ${session.lastGMUtterance}\nStyle: painterly, high detail, cinematic lighting.`;
  try {
    const url = `${PROXY_BASE}/image`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        size: els.imageSize.value
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data.");
    els.image.src = `data:image/png;base64,${b64}`;
  } catch (err) {
    console.error(err);
    alert(`Image generation failed: ${err.message}`);
  }
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
  return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

async function checkHealth() {
  if (!PROXY_BASE) {
    els.status.classList.remove("ok","err");
    els.apiText.textContent = "Set proxy URL ↓";
    return;
  }
  try {
    const res = await fetch(`${PROXY_BASE}/health`, { method: "GET", cache: "no-store" });
    if (res.ok) {
      els.status.classList.add("ok"); els.status.classList.remove("err");
      els.apiText.textContent = "Connected";
    } else {
      els.status.classList.add("err"); els.status.classList.remove("ok");
      els.apiText.textContent = "Unavailable";
    }
  } catch {
    els.status.classList.add("err"); els.status.classList.remove("ok");
    els.apiText.textContent = "Offline";
  }
}
checkHealth();
renderSessions();
