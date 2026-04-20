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
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (res.status === 401) { logout(); return null; }
  if (res.headers.get("Content-Type")?.includes("text/csv")) return res;
  return res.json();
}

// ---------------------------------------------------------------------------
// Login page — with username conflict check & email privacy
// ---------------------------------------------------------------------------
let _pendingLogin = null;

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const email = document.getElementById("email").value.trim();
  const emailPrivate = document.getElementById("email-private")?.checked || false;
  if (!username) return;

  const alertEl = document.getElementById("login-alert");
  alertEl.style.display = "none";

  // Step 1: check if username exists
  const check = await api("/api/check-username", {
    method: "POST",
    body: JSON.stringify({ username }),
  });

  if (check?.exists) {
    // Show confirmation dialog
    _pendingLogin = { username, email, email_private: emailPrivate, force: true };
    document.getElementById("confirm-dialog").style.display = "block";
    document.getElementById("username-hint").textContent =
      `"${username}" has ${check.responses} responses already.`;
    document.getElementById("username-hint").style.color = "var(--accent-amber)";
    return;
  }

  // New user — proceed directly
  await doLogin({ username, email, email_private: emailPrivate, force: false });
}

async function confirmLogin() {
  if (!_pendingLogin) return;
  await doLogin(_pendingLogin);
}

function cancelConfirm() {
  _pendingLogin = null;
  document.getElementById("confirm-dialog").style.display = "none";
  document.getElementById("username").focus();
  document.getElementById("username-hint").textContent = "";
}

async function doLogin(params) {
  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify(params),
  });

  if (data?.error) {
    const alertEl = document.getElementById("login-alert");
    alertEl.textContent = data.error;
    alertEl.style.display = "block";
    return;
  }

  if (data?.token) {
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
  document.getElementById("task-image").src = "images/" + data.image.filename;
  document.getElementById("task-image").dataset.imageId = data.image.id;
  turingStart = Date.now();
}

async function submitTuring(answer) {
  const imageId = parseInt(document.getElementById("task-image").dataset.imageId);
  const ms = Date.now() - turingStart;
  await api("/api/task/turing", {
    method: "POST",
    body: JSON.stringify({ image_id: imageId, answer, response_ms: ms }),
  });
  loadTuring();
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
  document.getElementById("task-image").src = "images/" + data.image.filename;
  document.getElementById("task-image").dataset.imageId = data.image.id;
  realismStart = Date.now();

  document.querySelectorAll('input[name="score"]').forEach(r => r.checked = false);
  document.getElementById("submit-realism").disabled = true;
}

function selectScore() {
  document.getElementById("submit-realism").disabled = false;
}

async function submitRealism() {
  const score = parseInt(document.querySelector('input[name="score"]:checked').value);
  const imageId = parseInt(document.getElementById("task-image").dataset.imageId);
  const ms = Date.now() - realismStart;
  await api("/api/task/realism", {
    method: "POST",
    body: JSON.stringify({ image_id: imageId, score, response_ms: ms }),
  });
  loadRealism();
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
  document.getElementById("task-image").src = "images/" + data.image.filename;
  document.getElementById("task-image").dataset.imageId = data.image.id;
  recognitionStart = Date.now();
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
  const imageId = parseInt(document.getElementById("task-image").dataset.imageId);
  const ms = Date.now() - recognitionStart;
  await api("/api/task/recognition", {
    method: "POST",
    body: JSON.stringify({ image_id: imageId, answer: selectedCondition, response_ms: ms }),
  });
  loadRecognition();
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
      const color = r.condition.includes(r.answer) ? 'var(--accent-cyan)' : 'var(--accent-red)';
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
// Keyboard shortcuts
// ---------------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (document.getElementById("task-image")?.closest("[data-task='turing']")) {
    if (e.key === "r" || e.key === "R") submitTuring("real");
    if (e.key === "s" || e.key === "S") submitTuring("synthetic");
  }
  if (document.getElementById("task-image")?.closest("[data-task='realism']")) {
    const n = parseInt(e.key);
    if (n >= 1 && n <= 5) {
      document.querySelector(`input[name="score"][value="${n}"]`).checked = true;
      selectScore();
    }
    if (e.key === "Enter") {
      const btn = document.getElementById("submit-realism");
      if (!btn.disabled) submitRealism();
    }
  }
});
