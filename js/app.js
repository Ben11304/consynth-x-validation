// ---------------------------------------------------------------------------
// UI helpers — toasts & modal (replace native alert/confirm)
// ---------------------------------------------------------------------------
function _toastRoot() {
  let r = document.getElementById("toast-root");
  if (!r) {
    r = document.createElement("div");
    r.id = "toast-root";
    document.body.appendChild(r);
  }
  return r;
}

const TOAST_ICON = { success: "\u2713", error: "!", warn: "!", info: "i" };
const TOAST_TITLE = { success: "Success", error: "Error", warn: "Warning", info: "Info" };

function toast(message, opts = {}) {
  const type = opts.type || "info";
  const title = opts.title || TOAST_TITLE[type];
  const duration = opts.duration ?? (type === "error" ? 6000 : 3500);

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${TOAST_ICON[type] || "i"}</span>
    <div class="toast-body">
      <div class="toast-title"></div>
      <div class="toast-msg"></div>
    </div>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;
  el.querySelector(".toast-title").textContent = title;
  el.querySelector(".toast-msg").textContent = message;
  el.querySelector(".toast-close").onclick = () => dismiss();

  _toastRoot().appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }
  if (duration > 0) setTimeout(dismiss, duration);
  return dismiss;
}

function modalConfirm({ title = "Confirm", body = "", confirmText = "OK", cancelText = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true">
        <div class="modal-title"></div>
        <div class="modal-body"></div>
        <div class="modal-actions">
          <button class="btn btn-outline" data-act="cancel"></button>
          <button class="btn ${danger ? 'btn-primary' : 'btn-primary'}" data-act="confirm" ${danger ? 'style="background:var(--accent-red);border-color:var(--accent-red)"' : ''}></button>
        </div>
      </div>
    `;
    backdrop.querySelector(".modal-title").textContent = title;
    backdrop.querySelector(".modal-body").textContent = body;
    backdrop.querySelector('[data-act="cancel"]').textContent = cancelText;
    backdrop.querySelector('[data-act="confirm"]').textContent = confirmText;

    function close(result) {
      backdrop.classList.remove("show");
      setTimeout(() => backdrop.remove(), 200);
      resolve(result);
    }
    backdrop.querySelector('[data-act="cancel"]').onclick = () => close(false);
    backdrop.querySelector('[data-act="confirm"]').onclick = () => close(true);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(false); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(false); document.removeEventListener("keydown", esc); }
      if (e.key === "Enter")  { close(true);  document.removeEventListener("keydown", esc); }
    });

    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("show"));
  });
}

// ---------------------------------------------------------------------------
// Recognition ground-truth mapping (condition → accepted answer labels)
// ---------------------------------------------------------------------------
const RECOGNITION_TRUTH = {
  "original":                ["clear"],
  "fog_heavy":               ["fog", "fog_heavy"],
  "fog_medium":              ["fog", "fog_medium"],
  "night":                   ["night"],
  "small":                   ["small"],
  "weather_diff_rain":       ["rain"],
  "weather_diff_rain_heavy": ["rain", "rain_heavy"],
  "weather_diff_snow_heavy": ["snow", "snow_heavy"],
  "weather_diff_snow_light": ["snow", "snow_light"],
};

function isRecognitionCorrect(condition, answer) {
  const accepted = RECOGNITION_TRUTH[condition];
  if (!accepted) return false;
  return accepted.includes(answer);
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function getToken() { return localStorage.getItem("token"); }
function getUser()  { const u = localStorage.getItem("user"); return u ? JSON.parse(u) : null; }
function logout()   { localStorage.clear(); location.href = "login.html"; }

function requireAuth() {
  if (!getToken()) { location.href = "login.html"; return false; }
  return true;
}

async function api(path, opts = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = "Bearer " + token;
  try {
    const res = await fetch(API_BASE + path, { ...opts, headers });
    if (res.status === 401) { logout(); return null; }
    if (res.headers.get("Content-Type")?.includes("text/csv")) return res;
    const body = await res.json().catch(() => ({ error: "invalid_response" }));
    if (!res.ok) body._httpError = res.status;
    return body;
  } catch (e) {
    return { error: "network_error", message: String(e?.message || e) };
  }
}

// Retry POST with exponential backoff — prevents silent data loss on
// transient network failures during task submission.
async function apiPostRetry(path, body, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const r = await api(path, { method: "POST", body: JSON.stringify(body) });
    if (r && r.status === "ok") return r;
    lastErr = r;
    if (r?._httpError === 400) return r; // don't retry validation errors
    await new Promise(res => setTimeout(res, 500 * Math.pow(2, i)));
  }
  return lastErr;
}

// ---------------------------------------------------------------------------
// Login page — strict unique usernames; admin requires password
// ---------------------------------------------------------------------------
function isAdminUsername(s) {
  return (s || "").trim().toLowerCase() === "admin";
}

function onUsernameChange() {
  const uname = document.getElementById("username").value;
  const pwGroup = document.getElementById("password-group");
  const emailGroup = document.getElementById("email-group");
  const emailPrivGroup = document.getElementById("email-private-group");
  const admin = isAdminUsername(uname);
  if (pwGroup) pwGroup.style.display = admin ? "" : "none";
  if (emailGroup) emailGroup.style.display = admin ? "none" : "";
  if (emailPrivGroup) emailPrivGroup.style.display = admin ? "none" : "flex";
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password")?.value || "";
  const emailPrivate = document.getElementById("email-private")?.checked || false;
  if (!username) return;

  const alertEl = document.getElementById("login-alert");
  alertEl.style.display = "none";

  const payload = isAdminUsername(username)
    ? { username, password }
    : { username, email, email_private: emailPrivate };

  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!data || data.error) {
    alertEl.textContent = data?.message || data?.error || "Login failed.";
    alertEl.style.display = "block";
    const hint = document.getElementById("username-hint");
    if (data?.error === "username_taken" && hint) {
      hint.textContent = "Pick a fresh username — this one is taken and cannot be reused.";
      hint.style.color = "var(--accent-red)";
    }
    return;
  }

  if (data.token) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    location.href = "index.html";
  }
}

// ---------------------------------------------------------------------------
// Index page
// ---------------------------------------------------------------------------
async function loadIndex() {
  if (!requireAuth()) return;
  const user = getUser();
  document.getElementById("welcome-user").textContent = user.username;

  const nav = document.getElementById("nav-admin");
  if (user.is_admin && nav) nav.style.display = "inline";

  const data = await api("/api/stats");
  if (!data) return;

  const realismEl = document.getElementById("realism-progress");
  if (realismEl) realismEl.textContent = `${data.realism_done} / ${data.realism_total}`;
}

// ---------------------------------------------------------------------------
// Submission guard — prevents double-submit from rapid clicks / key presses
// ---------------------------------------------------------------------------
let _submitting = false;
function beginSubmit() { if (_submitting) return false; _submitting = true; return true; }
function endSubmit()   { _submitting = false; }

function showSubmitError(msg) {
  toast(`${msg}. Your last answer was NOT saved. Please retry.`,
        { type: "error", title: "Submission failed", duration: 8000 });
}

function wireTaskImage(img, onReady) {
  img.onload = () => { onReady(); };
  img.onerror = () => {
    toast("Image failed to load. Skipping to next.", { type: "warn" });
    onReady(true /* skipNoAnswer */);
  };
}

// ---------------------------------------------------------------------------
// Turing Test
// ---------------------------------------------------------------------------
let turingStart;

async function loadTuring() {
  if (!requireAuth()) return;
  const data = await api("/api/task/turing");
  if (!data || data.done === true || !data.image) {
    document.getElementById("task-area").innerHTML =
      '<div class="complete-container"><div class="complete-icon">&#10003;</div><h2>Turing Test Complete!</h2><p>You have rated all images.</p><a href="index.html" class="btn btn-primary">Back to Home</a></div>';
    return;
  }

  const pct = data.total > 0 ? (data.done / data.total * 100) : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-text").textContent = `${data.done} / ${data.total}`;
  const img = document.getElementById("task-image");
  img.dataset.imageId = data.image.id;
  turingStart = null; // start timer only after img actually renders
  img.onload = () => { turingStart = Date.now(); };
  img.onerror = () => {
    toast("Image failed to load. Loading next.", { type: "warn" });
    loadTuring();
  };
  img.src = "images/" + data.image.filename;
}

async function submitTuring(answer) {
  if (!beginSubmit()) return;
  const img = document.getElementById("task-image");
  try {
    if (!turingStart) return; // image not ready yet
    const imageId = parseInt(img.dataset.imageId);
    const ms = Date.now() - turingStart;
    const r = await apiPostRetry("/api/task/turing", { image_id: imageId, answer, response_ms: ms });
    if (!r || r.status !== "ok") {
      showSubmitError(r?.message || r?.error || "unknown");
      return;
    }
    await loadTuring();
  } finally {
    endSubmit();
  }
}

// ---------------------------------------------------------------------------
// Realism Rating
// ---------------------------------------------------------------------------
let realismStart;

async function loadRealism() {
  if (!requireAuth()) return;
  const data = await api("/api/task/realism");
  if (!data || data.done === true || !data.image) {
    document.getElementById("task-area").innerHTML =
      '<div class="complete-container"><div class="complete-icon">&#10003;</div><h2>Realism Rating Complete!</h2><p>You have rated all images.</p><a href="index.html" class="btn btn-primary">Back to Home</a></div>';
    return;
  }

  const pct = data.total > 0 ? (data.done / data.total * 100) : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-text").textContent = `${data.done} / ${data.total}`;
  const img = document.getElementById("task-image");
  img.dataset.imageId = data.image.id;
  realismStart = null;
  img.onload = () => { realismStart = Date.now(); };
  img.onerror = () => {
    toast("Image failed to load. Loading next.", { type: "warn" });
    loadRealism();
  };
  img.src = "images/" + data.image.filename;

  document.querySelectorAll('input[name="score"]').forEach(r => r.checked = false);
  document.getElementById("submit-realism").disabled = true;
}

function selectScore() {
  document.getElementById("submit-realism").disabled = false;
}

async function submitRealism() {
  if (!beginSubmit()) return;
  try {
    if (!realismStart) return;
    const sel = document.querySelector('input[name="score"]:checked');
    if (!sel) return;
    const score = parseInt(sel.value);
    const imageId = parseInt(document.getElementById("task-image").dataset.imageId);
    const ms = Date.now() - realismStart;
    const r = await apiPostRetry("/api/task/realism", { image_id: imageId, score, response_ms: ms });
    if (!r || r.status !== "ok") {
      showSubmitError(r?.message || r?.error || "unknown");
      return;
    }
    await loadRealism();
  } finally {
    endSubmit();
  }
}

// ---------------------------------------------------------------------------
// Condition Recognition
// ---------------------------------------------------------------------------
let recognitionStart, selectedCondition = null;

async function loadRecognition() {
  if (!requireAuth()) return;
  const data = await api("/api/task/recognition");
  if (!data || data.done === true || !data.image) {
    document.getElementById("task-area").innerHTML =
      '<div class="complete-container"><div class="complete-icon">&#10003;</div><h2>Condition Recognition Complete!</h2><p>You have rated all images.</p><a href="index.html" class="btn btn-primary">Back to Home</a></div>';
    return;
  }

  const pct = data.total > 0 ? (data.done / data.total * 100) : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-text").textContent = `${data.done} / ${data.total}`;
  const img = document.getElementById("task-image");
  img.dataset.imageId = data.image.id;
  recognitionStart = null;
  img.onload = () => { recognitionStart = Date.now(); };
  img.onerror = () => {
    toast("Image failed to load. Loading next.", { type: "warn" });
    loadRecognition();
  };
  img.src = "images/" + data.image.filename;
  selectedCondition = null;

  document.querySelectorAll(".condition-option").forEach(el => el.classList.remove("selected"));
  document.getElementById("submit-recognition").disabled = true;
}

function selectCondition(el, value) {
  selectedCondition = value;
  document.querySelectorAll(".condition-option").forEach(e => e.classList.remove("selected"));
  el.classList.add("selected");
  document.getElementById("submit-recognition").disabled = false;
}

async function submitRecognition() {
  if (!beginSubmit()) return;
  try {
    if (!recognitionStart || !selectedCondition) return;
    const imageId = parseInt(document.getElementById("task-image").dataset.imageId);
    const ms = Date.now() - recognitionStart;
    const r = await apiPostRetry("/api/task/recognition", { image_id: imageId, answer: selectedCondition, response_ms: ms });
    if (!r || r.status !== "ok") {
      showSubmitError(r?.message || r?.error || "unknown");
      return;
    }
    await loadRecognition();
  } finally {
    endSubmit();
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
async function loadDashboard() {
  if (!requireAuth()) return;
  const user = getUser();
  if (!user.is_admin) { location.href = "index.html"; return; }

  const data = await api("/api/dashboard");
  if (!data) return;

  // Stats
  document.getElementById("stat-images").textContent = data.stats.total_images;
  document.getElementById("stat-users").textContent = data.stats.total_users;
  document.getElementById("stat-turing").textContent = data.stats.turing_responses;
  document.getElementById("stat-realism").textContent = data.stats.realism_responses;
  document.getElementById("stat-recognition").textContent = data.stats.recognition_responses;

  // Avg response time
  if (data.stats.avg_response_ms != null) {
    const el = document.getElementById("stat-avg-ms");
    if (el) el.textContent = Math.round(data.stats.avg_response_ms);
  }

  // Users table with actions
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = data.users.map(u => `
    <tr>
      <td><strong style="color:var(--text-primary)">${u.username}</strong></td>
      <td>${u.email_private ? '<span style="color:var(--text-muted)">[private]</span>' : (u.email || '-')}</td>
      <td>${u.turing}</td>
      <td>${u.realism}</td>
      <td>${u.recognition}</td>
      <td>${u.created_at ? u.created_at.slice(0, 10) : '-'}</td>
      <td>
        <button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.7rem" onclick="viewUserDetail(${u.id}, '${u.username}')">Detail</button>
        <button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.7rem;border-color:var(--accent-amber);color:var(--accent-amber)" onclick="resetUser(${u.id}, '${u.username}')">Reset</button>
        <button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.7rem;border-color:var(--accent-red);color:var(--accent-red)" onclick="deleteUser(${u.id}, '${u.username}')">Delete</button>
      </td>
    </tr>
  `).join("");

  // MOS table
  const mosTbody = document.getElementById("mos-tbody");
  mosTbody.innerHTML = data.mos.map(m =>
    `<tr><td>${m.condition}</td><td style="color:var(--accent-amber);font-weight:600">${m.mean_score}</td><td>${m.n}</td></tr>`
  ).join("");

  // Fooling rate table
  const foolTbody = document.getElementById("fooling-tbody");
  if (foolTbody && data.fooling) {
    foolTbody.innerHTML = data.fooling.map(f => {
      const rate = f.total > 0 ? ((f.fooled / f.total) * 100).toFixed(1) : '0.0';
      return `<tr><td>${f.condition}</td><td>${f.source}</td><td style="color:var(--accent-orange);font-weight:600">${rate}%</td><td>${f.fooled}/${f.total}</td></tr>`;
    }).join("");
  }

  // Per-image stats
  if (data.image_stats) {
    const imgTbody = document.getElementById("image-stats-tbody");
    if (imgTbody) {
      imgTbody.innerHTML = data.image_stats.map(s =>
        `<tr><td style="font-size:0.8rem">${s.filename}</td><td>${s.condition}</td><td>${s.turing_n}</td><td style="color:var(--accent-orange)">${s.fooling_rate != null ? s.fooling_rate + '%' : '-'}</td><td style="color:var(--accent-amber)">${s.avg_mos ?? '-'}</td></tr>`
      ).join("");
    }
  }

  // Sampling config section
  await loadSamplingConfig();
}

// Admin: user detail
async function viewUserDetail(userId, username) {
  const data = await api(`/api/admin/user/${userId}/responses`);
  if (!data) return;

  let html = `<h3 style="margin-bottom:1rem">Responses by ${username}</h3>`;

  if (data.turing.length) {
    html += `<h4 style="color:var(--accent-orange);margin:1rem 0 0.5rem">Turing (${data.turing.length})</h4>
    <table><thead><tr><th>Image</th><th>Condition</th><th>Truth</th><th>Answer</th><th>Time</th></tr></thead><tbody>`;
    data.turing.forEach(r => {
      const correct = (r.source === r.answer) || (r.source === 'real' && r.answer === 'real');
      const color = (r.source === 'synthetic' && r.answer === 'real') ? 'var(--accent-red)' : 'var(--accent-cyan)';
      html += `<tr><td style="font-size:0.8rem">${r.filename}</td><td>${r.condition}</td><td>${r.source}</td><td style="color:${color}">${r.answer}</td><td>${r.response_ms}ms</td></tr>`;
    });
    html += '</tbody></table>';
  }

  if (data.realism.length) {
    html += `<h4 style="color:var(--accent-amber);margin:1rem 0 0.5rem">Realism (${data.realism.length})</h4>
    <table><thead><tr><th>Image</th><th>Condition</th><th>Score</th><th>Time</th></tr></thead><tbody>`;
    data.realism.forEach(r => {
      html += `<tr><td style="font-size:0.8rem">${r.filename}</td><td>${r.condition}</td><td style="color:var(--accent-amber);font-weight:600">${r.score}</td><td>${r.response_ms}ms</td></tr>`;
    });
    html += '</tbody></table>';
  }

  if (data.recognition.length) {
    html += `<h4 style="color:var(--accent-blue);margin:1rem 0 0.5rem">Recognition (${data.recognition.length})</h4>
    <table><thead><tr><th>Image</th><th>Truth</th><th>Answer</th><th>Time</th></tr></thead><tbody>`;
    data.recognition.forEach(r => {
      const color = isRecognitionCorrect(r.condition, r.answer) ? 'var(--accent-cyan)' : 'var(--accent-red)';
      html += `<tr><td style="font-size:0.8rem">${r.filename}</td><td>${r.condition}</td><td style="color:${color}">${r.answer}</td><td>${r.response_ms}ms</td></tr>`;
    });
    html += '</tbody></table>';
  }

  document.getElementById("user-detail-panel").innerHTML = html;
  document.getElementById("user-detail-panel").style.display = "block";
  document.getElementById("user-detail-panel").scrollIntoView({ behavior: "smooth" });
}

// Admin: reset user
async function resetUser(userId, username) {
  const ok = await modalConfirm({
    title: "Reset evaluator?",
    body: `Delete all responses and assignments for "${username}". This cannot be undone.`,
    confirmText: "Reset",
    cancelText: "Cancel",
    danger: true,
  });
  if (!ok) return;
  const data = await api(`/api/admin/user/${userId}/reset`, { method: "POST" });
  if (data?.status === "ok") {
    toast(`${username}: removed ${data.deleted} responses.`, { type: "success", title: "Reset complete" });
    loadDashboard();
  } else {
    toast(data?.message || "Unknown error", { type: "error", title: "Reset failed" });
  }
}

// Admin: delete user
async function deleteUser(userId, username) {
  const ok = await modalConfirm({
    title: "Delete evaluator?",
    body: `Permanently delete "${username}" and ALL their data. This cannot be undone.`,
    confirmText: "Delete",
    cancelText: "Cancel",
    danger: true,
  });
  if (!ok) return;
  const data = await api(`/api/admin/user/${userId}`, { method: "DELETE" });
  if (data?.status === "ok") {
    toast(`"${username}" deleted.`, { type: "success", title: "User removed" });
    loadDashboard();
  } else {
    toast(data?.message || "Unknown error", { type: "error", title: "Delete failed" });
  }
}

// ---------------------------------------------------------------------------
// Admin: Sampling configuration (per-condition sample counts)
// ---------------------------------------------------------------------------
let _samplingRows = [];

async function loadSamplingConfig() {
  const data = await api("/api/admin/sampling-config");
  if (!data || !Array.isArray(data.rows)) return;
  _samplingRows = data.rows;
  renderSamplingConfig();
  updateSamplingTotals();
}

function renderSamplingConfig() {
  const tbody = document.getElementById("sampling-cfg-tbody");
  if (!tbody) return;
  tbody.innerHTML = _samplingRows.map((r, i) => `
    <tr>
      <td>${r.condition}</td>
      <td style="color:${r.source === 'real' ? 'var(--accent-cyan)' : 'var(--text-secondary)'}">${r.source}</td>
      <td style="color:var(--text-muted)">${r.available}</td>
      <td>
        <input type="number" min="0" max="${r.available}" value="${r.sample_count}"
               data-idx="${i}" oninput="onSamplingChange(this)"
               style="width:80px;padding:0.3rem 0.5rem;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border);border-radius:4px">
      </td>
    </tr>
  `).join("");
}

function onSamplingChange(input) {
  const idx = parseInt(input.dataset.idx);
  let v = parseInt(input.value);
  if (!Number.isFinite(v) || v < 0) v = 0;
  const max = _samplingRows[idx].available;
  if (v > max) { v = max; input.value = v; }
  _samplingRows[idx].sample_count = v;
  updateSamplingTotals();
}

function updateSamplingTotals() {
  let turing = 0, synth = 0;
  for (const r of _samplingRows) {
    const eff = Math.min(r.sample_count, r.available);
    turing += eff;
    if (r.source === "synthetic") synth += eff;
  }
  document.getElementById("cfg-total-turing").textContent = turing;
  document.getElementById("cfg-total-realism").textContent = synth;
  document.getElementById("cfg-total-recognition").textContent = synth;
}

function setAllSampling(v) {
  for (const r of _samplingRows) r.sample_count = Math.min(v, r.available);
  renderSamplingConfig();
  updateSamplingTotals();
}

async function saveSamplingConfig() {
  const entries = _samplingRows.map(r => ({ condition: r.condition, sample_count: r.sample_count }));
  const data = await api("/api/admin/sampling-config", {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
  if (data?.status === "ok") {
    toast(`Saved ${data.updated} condition${data.updated === 1 ? "" : "s"}. Applies to new evaluators only.`,
          { type: "success", title: "Distribution saved" });
  } else {
    toast(data?.message || data?.error || "Unknown error",
          { type: "error", title: "Save failed" });
  }
}

// Admin: load images
async function loadImages() {
  const replace = await modalConfirm({
    title: "Load images — choose mode",
    body:
      "Replace = WIPE existing images + assignments + all evaluation responses, then reload from manifest. Use this after a dataset update.\n\n" +
      "Append = Only insert new entries; keep existing images, assignments, and responses.",
    confirmText: "Replace (wipe all)",
    cancelText: "Append only",
    danger: true,
  });
  const res = await fetch("images/manifest.json");
  const images = await res.json();
  const data = await api("/api/images/load", {
    method: "POST",
    body: JSON.stringify({ images, replace }),
  });
  if (data?.status === "ok") {
    const msg = replace
      ? `Loaded ${data.loaded} images. Cleared ${data.cleared || 0} old images, wiped ${data.wiped_responses || 0} responses.`
      : `Loaded ${data.loaded} images (append mode).`;
    toast(msg, { type: "success", title: "Manifest synced" });
    loadDashboard();
  } else if (data?.error) {
    toast(data.message || data.error, { type: "error", title: "Load failed", duration: 8000 });
  }
}

// Admin: export CSV
async function exportCSV(task) {
  const res = await api("/api/export/" + task);
  if (!res) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `consynth_x_${task}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts — suppress when typing in an input / during submission
// ---------------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (_submitting) return;
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA") && active.type !== "radio") return;

  if (document.getElementById("task-image")?.closest("[data-task='turing']")) {
    if (e.key === "r" || e.key === "R") submitTuring("real");
    if (e.key === "s" || e.key === "S") submitTuring("synthetic");
  }
  if (document.getElementById("task-image")?.closest("[data-task='realism']")) {
    const n = parseInt(e.key);
    if (n >= 1 && n <= 5) {
      const radio = document.querySelector(`input[name="score"][value="${n}"]`);
      if (radio) { radio.checked = true; selectScore(); }
    }
    if (e.key === "Enter") {
      const btn = document.getElementById("submit-realism");
      if (btn && !btn.disabled) submitRealism();
    }
  }
});
