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
// Login page
// ---------------------------------------------------------------------------
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const email = document.getElementById("email").value.trim();
  if (!username) return;

  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, email }),
  });
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

  // Reset radio buttons
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

  // Users table
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = data.users.map(u =>
    `<tr><td>${u.username}</td><td>${u.email || "-"}</td><td>${u.turing}</td><td>${u.realism}</td><td>${u.recognition}</td></tr>`
  ).join("");

  // MOS table
  const mosTbody = document.getElementById("mos-tbody");
  mosTbody.innerHTML = data.mos.map(m =>
    `<tr><td>${m.condition}</td><td>${m.mean_score}</td><td>${m.n}</td></tr>`
  ).join("");
}

async function loadImages() {
  // Fetch the image manifest and send to API
  const res = await fetch("images/manifest.json");
  const images = await res.json();
  const data = await api("/api/images/load", {
    method: "POST",
    body: JSON.stringify({ images }),
  });
  if (data?.status === "ok") {
    alert(`Loaded ${data.loaded} images!`);
    loadDashboard();
  }
}

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
  // Turing: R = real, S = synthetic
  if (document.getElementById("task-image")?.closest("[data-task='turing']")) {
    if (e.key === "r" || e.key === "R") submitTuring("real");
    if (e.key === "s" || e.key === "S") submitTuring("synthetic");
  }
  // Realism: 1-5
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
