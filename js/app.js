// ---------------------------------------------------------------------------
// Recognition ground-truth mapping (condition → accepted answer labels)
// ---------------------------------------------------------------------------
const RECOGNITION_TRUTH = {
  "original":                ["clear"],
  "fog_heavy":               ["fog", "fog_heavy"],
  "fog_medium":              ["fog", "fog_medium"],
  "night":                   ["night"],
  "small":                   ["small"],
  "weather_style_rain_0":    ["rain"],
  "weather_style_rain_1":    ["rain"],
  "weather_style_rain_2":    ["rain"],
  "weather_style_snow_0":    ["snow"],
  "weather_style_snow_1":    ["snow"],
  "weather_style_snow_2":    ["snow"],
  "weather_diff_rain":       ["rain"],
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

  document.getElementById("turing-progress").textContent = `${data.turing_done} / ${data.turing_total}`;
  document.getElementById("realism-progress").textContent = `${data.realism_done} / ${data.realism_total}`;
  document.getElementById("recognition-progress").textContent = `${data.recognition_done} / ${data.recognition_total}`;
}

// ---------------------------------------------------------------------------
// Submission guard — prevents double-submit from rapid clicks / key presses
// ---------------------------------------------------------------------------
let _submitting = false;
function beginSubmit() { if (_submitting) return false; _submitting = true; return true; }
function endSubmit()   { _submitting = false; }

function showSubmitError(msg) {
  alert(`⚠ Submission failed: ${msg}\n\nYour last answer was NOT saved. Please retry.`);
}

function wireTaskImage(img, onReady) {
  img.onload = () => { onReady(); };
  img.onerror = () => {
    alert("⚠ Image failed to load. Skipping to next. If this persists, contact admin.");
    // Force advance — we won't record this response since user can't actually see it
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
    alert("⚠ Image failed to load. Reloading next image.");
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
    alert("⚠ Image failed to load. Reloading next image.");
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
    alert("⚠ Image failed to load. Reloading next image.");
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
  if (!confirm(`Reset all responses & assignments for "${username}"? This cannot be undone.`)) return;
  const data = await api(`/api/admin/user/${userId}/reset`, { method: "POST" });
  if (data?.status === "ok") {
    alert(`Reset ${username}: ${data.deleted} responses removed.`);
    loadDashboard();
  }
}

// Admin: delete user
async function deleteUser(userId, username) {
  if (!confirm(`Permanently delete user "${username}" and ALL their data?`)) return;
  const data = await api(`/api/admin/user/${userId}`, { method: "DELETE" });
  if (data?.status === "ok") {
    alert(`Deleted user "${username}".`);
    loadDashboard();
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
    alert(`Saved ${data.updated} condition configs. Applies to new evaluators only.`);
  } else {
    alert(`Save failed: ${data?.error || "unknown"}`);
  }
}

// Admin: load images
async function loadImages() {
  const replace = confirm(
    "Replace existing image registry?\n\n" +
    "OK  = WIPE all responses + assignments + images, then reload from manifest\n" +
    "       (use after dataset update; destroys prior evaluation data)\n" +
    "Cancel = Append only (INSERT OR IGNORE, keeps responses)"
  );
  const res = await fetch("images/manifest.json");
  const images = await res.json();
  const data = await api("/api/images/load", {
    method: "POST",
    body: JSON.stringify({ images, replace }),
  });
  if (data?.status === "ok") {
    const extra = replace
      ? ` (cleared ${data.cleared || 0} images, wiped ${data.wiped_responses || 0} responses)`
      : "";
    alert(`Loaded ${data.loaded} images${extra}!`);
    loadDashboard();
  } else if (data?.error) {
    alert(`Load failed: ${data.error}\n${data.message || ""}`);
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
