/* Student Scholarship Monitoring and Academic Compliance System
   HTML / CSS / JavaScript + Supabase (PostgreSQL + Auth) + GitHub Pages
   Roles: admin, staff, scholar. Security is enforced by RLS in sql/schema.sql. */

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STATUSES = ["Active","Pending Submission","For Verification","Compliant","With Deficiency","Probationary","For Renewal","Renewed","Disqualified"];
const state = { profile: null, programs: [], scholars: [], grades: [], profiles: [], renewals: [] };
let currentPage = "dashboard";

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
const program = id => state.programs.find(x => x.id === id);
const scholar = id => state.scholars.find(x => x.id === id);
const myScholar = () => state.scholars.find(x => x.user_id === state.profile?.id);
const roleName = () => state.profile.role.charAt(0).toUpperCase() + state.profile.role.slice(1);

function must(res) { if (res.error) throw res.error; return res.data; }

function friendly(e) {
  const m = e?.message || String(e);
  if (e?.code === "23505") return m.includes("student_id") ? "Student ID is already registered." : "Record already exists.";
  if (e?.code === "23514") return "A value is outside the allowed range.";
  if (e?.code === "42501") return "You are not permitted to do that.";
  return m;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3500);
}

async function guard(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (err) { console.error(err); toast(friendly(err), true); }
  finally { if (btn) btn.disabled = false; }
}

/* ---------- data ---------- */
async function loadData() {
  const role = state.profile.role;
  const [programs, scholars, grades] = await Promise.all([
    db.from("scholarship_programs").select("*").order("program_name"),
    db.from("scholars").select("*").order("full_name"),
    db.from("grade_submissions").select("*").order("submitted_at", { ascending: false })
  ]);
  state.programs = must(programs);
  state.scholars = must(scholars);
  state.grades = must(grades);
  state.profiles = role === "admin" ? must(await db.from("profiles").select("*").order("created_at")) : [];
  state.renewals = role !== "scholar" ? must(await db.from("renewal_records").select("*").order("processed_at", { ascending: false })) : [];
}

async function refresh() { await loadData(); renderPage(); }

/* ---------- auth ---------- */
const loginPage = $("loginPage"), registerPage = $("registerPage"), appEl = $("app");

$("showRegister").onclick = async () => {
  loginPage.classList.add("hidden");
  registerPage.classList.remove("hidden");
  await guard(populateRegistrationPrograms);
};
$("backToLogin").onclick = () => { registerPage.classList.add("hidden"); loginPage.classList.remove("hidden"); };

async function populateRegistrationPrograms() {
  const rows = must(await db.from("scholarship_programs").select("id, program_name").eq("active", true).order("program_name"));
  $("regScholarship").innerHTML = '<option value="">Select Scholarship Program</option>' +
    rows.map(p => `<option value="${p.id}">${esc(p.program_name)}</option>`).join("");
}

async function startSession(user) {
  const { data, error } = await db.from("profiles").select("*").eq("id", user.id).single();
  if (error || !data) {
    await db.auth.signOut();
    throw new Error("No profile found for this account. Make sure sql/schema.sql was run.");
  }
  state.profile = data;
  await openApp();
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("loginError").textContent = "";
  $("loginNotice").classList.add("hidden");
  await guard(async () => {
    const { data, error } = await db.auth.signInWithPassword({
      email: $("loginEmail").value.trim().toLowerCase(),
      password: $("loginPassword").value
    });
    if (error) { $("loginError").textContent = error.message === "Invalid login credentials" ? "Invalid email or password." : error.message; return; }
    await startSession(data.user);
  }, e.submitter);
});

$("registerForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("registerError").textContent = "";
  await guard(async () => {
    const studentId = $("regStudentId").value.trim();
    if (!studentId) { $("registerError").textContent = "Student ID cannot be blank."; return; }
    if (!$("regScholarship").value) { $("registerError").textContent = "Please select a scholarship program."; return; }

    const ok = must(await db.rpc("student_id_available", { p_student_id: studentId }));
    if (!ok) { $("registerError").textContent = "Student ID is already registered."; return; }

    const { data, error } = await db.auth.signUp({
      email: $("regEmail").value.trim().toLowerCase(),
      password: $("regPassword").value,
      options: { data: {
        full_name: $("regFullName").value.trim(),
        student_id: studentId,
        degree_program: $("regDegree").value.trim(),
        year_level: $("regYear").value.trim(),
        scholarship_id: $("regScholarship").value
      } }
    });
    if (error) { $("registerError").textContent = error.message; return; }

    e.target.reset();
    if (!data.session) {
      registerPage.classList.add("hidden");
      loginPage.classList.remove("hidden");
      const n = $("loginNotice");
      n.textContent = "Account created. Confirm your email address, then log in.";
      n.className = "notice ok";
      return;
    }
    await startSession(data.user);
  }, e.submitter);
});

$("logoutBtn").onclick = async () => {
  await db.auth.signOut();
  state.profile = null;
  appEl.classList.add("hidden");
  loginPage.classList.remove("hidden");
  $("loginForm").reset();
};

async function openApp() {
  loginPage.classList.add("hidden");
  registerPage.classList.add("hidden");
  appEl.classList.remove("hidden");
  currentPage = "dashboard";
  await loadData();
  renderPage();
}

/* ---------- navigation ---------- */
function buildNavigation() {
  const role = state.profile.role;
  const menus = {
    admin: [["dashboard","Dashboard"],["users","User Accounts"],["scholars","Scholars"],["programs","Scholarship Programs"],["grades","Grade Submissions"],["compliance","Compliance"],["reports","Reports"]],
    staff: [["dashboard","Dashboard"],["scholars","Scholar Management"],["programs","Scholarship Programs"],["grades","Grade Verification"],["compliance","Compliance"],["renewal","Renewal Monitoring"],["reports","Reports"]],
    scholar: [["dashboard","My Dashboard"],["submit","Submit Grades"],["requirements","My Requirements"],["status","My Status"],["history","Submission History"]]
  };
  const nav = $("sidebar");
  nav.innerHTML = `<h3>${roleName()} Menu</h3>` +
    menus[role].map(([id, label]) => `<button class="nav-btn ${id === currentPage ? "active" : ""}" data-page="${id}">${label}</button>`).join("");
  nav.querySelectorAll(".nav-btn").forEach(btn => {
    btn.onclick = () => guard(async () => { currentPage = btn.dataset.page; await refresh(); });
  });
}

const PAGES = {
  admin: { dashboard: () => dashboardPage("Administrator Dashboard", adminInfo()), users: usersPage, scholars: () => scholarsPage(false), programs: () => programsPage(true), grades: () => gradesPage(false), compliance: compliancePage, reports: reportsPage },
  staff: { dashboard: () => dashboardPage("Scholarship Staff Dashboard", staffInfo()), scholars: () => scholarsPage(true), programs: () => programsPage(false), grades: () => gradesPage(true), compliance: compliancePage, renewal: renewalPage, reports: reportsPage },
  scholar: { dashboard: scholarDashboard, submit: scholarSubmit, requirements: scholarRequirements, status: scholarStatus, history: scholarHistory }
};

function renderPage() {
  buildNavigation();
  $("userWelcome").textContent = `${state.profile.full_name} • ${roleName()}`;
  const pages = PAGES[state.profile.role];
  $("mainContent").innerHTML = (pages[currentPage] || pages.dashboard)();
  bindActions();
}

/* ---------- shared UI ---------- */
const badge = s => `<span class="badge">${esc(s)}</span>`;
const stat = (title, value) => `<div class="stat"><strong>${value}</strong><span>${title}</span></div>`;

function table(headers, rows) {
  if (!rows.length) return `<div class="panel">No records found.</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div>`;
}

function dashboardCards() {
  const g = state.grades, s = state.scholars;
  return `<div class="cards">
    ${stat("Total Scholars", s.length)}
    ${stat("Pending Submissions", g.filter(x => x.submission_status === "Pending").length)}
    ${stat("Verified Submissions", g.filter(x => x.submission_status === "Verified").length)}
    ${stat("Compliant Scholars", s.filter(x => x.status === "Compliant").length)}
    ${stat("With Deficiency", s.filter(x => x.status === "With Deficiency").length)}
    ${stat("Scholarship Programs", state.programs.filter(p => p.active).length)}
  </div>`;
}

const adminInfo = () => `<div class="panel"><h3>Administrator Responsibilities</h3>
  <ul><li>Manage users and access roles.</li><li>Manage scholarship programs and requirements.</li>
  <li>Monitor overall scholarship records and reports.</li><li>Review system data and activity.</li></ul></div>`;
const staffInfo = () => `<div class="panel"><h3>Staff Workflow</h3>
  <p>Register/select scholar → verify grade submission → evaluate compliance → record deficiency/status → monitor renewal.</p></div>`;

function dashboardPage(title, extra) {
  return `<div class="page"><h2>${title}</h2>${dashboardCards()}${extra}</div>`;
}

/* ---------- admin: users ---------- */
function usersPage() {
  const rows = state.profiles.map(u => [
    esc(u.full_name), esc(u.email || "-"), esc(u.student_id || "-"),
    u.id === state.profile.id ? badge(u.role) :
      `<select data-role-for="${u.id}">${["admin","staff","scholar"].map(r => `<option ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}</select>`
  ]);
  return `<div class="page"><h2>User Accounts</h2>
    <div class="panel"><h3>Create Staff / Admin Account</h3>
      <form id="staffAccountForm" class="form-grid">
        <input id="saName" placeholder="Full Name" required>
        <input id="saEmail" type="email" placeholder="Email" required>
        <input id="saPassword" type="password" minlength="6" placeholder="Password (minimum 6 characters)" required>
        <select id="saRole"><option value="staff">Staff</option><option value="admin">Admin</option></select>
        <button class="primary full" type="submit">Create Account</button>
      </form>
    </div>
    ${table(["Name", "Email", "Student ID", "Role"], rows)}
  </div>`;
}

/* ---------- scholars ---------- */
function scholarsPage(isStaff) {
  const activePrograms = state.programs.filter(p => p.active);
  return `<div class="page"><h2>${isStaff ? "Scholar Management" : "All Scholars"}</h2>
    ${isStaff ? `<div class="panel"><form id="scholarForm" class="form-grid">
      <input id="stStudentId" placeholder="Student ID" required>
      <input id="stFullName" placeholder="Full Name" required>
      <input id="stDegree" placeholder="Degree Program" required>
      <input id="stYear" placeholder="Year Level" required>
      <select id="stScholarship" required><option value="">Scholarship Program</option>${activePrograms.map(p => `<option value="${p.id}">${esc(p.program_name)}</option>`).join("")}</select>
      <select id="stStatus"><option>Active</option><option>Pending Submission</option></select>
      <button class="primary full" type="submit">Register / Add Scholar</button>
    </form></div>` : ""}
    <div class="toolbar">
      <input id="scholarSearch" placeholder="Search Student ID or Name">
      <select id="scholarStatusFilter"><option value="">All Statuses</option>${STATUSES.map(x => `<option>${x}</option>`).join("")}</select>
      <select id="scholarProgramFilter"><option value="">All Scholarships</option>${state.programs.map(p => `<option value="${p.id}">${esc(p.program_name)}</option>`).join("")}</select>
    </div>
    <div id="scholarTable"></div>
  </div>`;
}

function renderScholarTable() {
  const isStaff = state.profile.role === "staff";
  const q = ($("scholarSearch").value || "").trim().toLowerCase();
  const f = $("scholarStatusFilter").value, pf = $("scholarProgramFilter").value;
  const list = state.scholars.filter(s =>
    (!q || s.student_id.toLowerCase().includes(q) || s.full_name.toLowerCase().includes(q)) &&
    (!f || s.status === f) && (!pf || s.scholarship_id === pf));
  const headers = ["Student ID", "Name", "Program", "Year", "Scholarship", "Status"];
  if (isStaff) headers.push("Update Status");
  $("scholarTable").innerHTML = table(headers, list.map(s => {
    const row = [esc(s.student_id), esc(s.full_name), esc(s.degree_program), esc(s.year_level),
      esc(program(s.scholarship_id)?.program_name || "-"), badge(s.status)];
    if (isStaff) row.push(`<select data-status-for="${s.id}">${STATUSES.map(x => `<option ${x === s.status ? "selected" : ""}>${x}</option>`).join("")}</select>`);
    return row;
  }));
}

/* ---------- programs ---------- */
function programsPage(isAdmin) {
  const rows = state.programs.map(p => {
    const row = [esc(p.program_name), p.required_gwa, p.min_units, p.allow_failing_grade ? "Allowed" : "Not Allowed", p.active ? "Active" : "Inactive"];
    if (isAdmin) row.push(`<div class="actions"><button data-edit-program="${p.id}">Edit</button><button data-toggle-program="${p.id}">${p.active ? "Deactivate" : "Activate"}</button></div>`);
    return row;
  });
  const headers = ["Program", "Required GWA", "Minimum Units", "Failing Grades", "Status"];
  if (isAdmin) headers.push("Actions");
  return `<div class="page"><h2>Scholarship Program and Requirement Management</h2>
    ${isAdmin ? `<div class="panel"><form id="programForm" class="form-grid">
      <input id="programId" type="hidden">
      <input id="programName" placeholder="Program Name" required>
      <input id="programGwa" type="number" step="0.01" min="0" max="5" placeholder="Required GWA (maximum acceptable)" required>
      <input id="programUnits" type="number" min="0" placeholder="Minimum Units" required>
      <label><input id="programFail" type="checkbox"> Allow failing grade</label>
      <label><input id="programActive" type="checkbox" checked> Active</label>
      <button class="primary full" type="submit">Save Scholarship Program</button>
    </form></div>` : ""}
    ${table(headers, rows)}
  </div>`;
}

/* ---------- grades ---------- */
function gradesPage(isStaff) {
  const rows = state.grades.map(g => {
    const s = scholar(g.scholar_id);
    return [esc(s?.student_id || "-"), esc(s?.full_name || "-"), esc(g.academic_year), esc(g.semester),
      g.gwa, g.units_enrolled, `${g.failed_subjects}/${g.incomplete_subjects}`, badge(g.submission_status),
      isStaff && g.submission_status === "Pending" ? `<button data-verify="${g.id}">Verify</button>` : esc(g.evaluation || "-")];
  });
  return `<div class="page"><h2>${isStaff ? "Grade Submission Verification" : "Grade Submissions"}</h2>
    ${isStaff ? `<div class="notice">Only verified submissions are used for final compliance evaluation.</div><br>` : ""}
    ${table(["Student ID", "Scholar", "Academic Year", "Semester", "GWA", "Units", "Failed/Incomplete", "Submission", isStaff ? "Action" : "Evaluation"], rows)}
  </div>`;
}

/* ---------- compliance / reports / renewal ---------- */
function compliancePage() {
  const rows = state.scholars.map(s => [
    esc(s.student_id), esc(s.full_name), esc(program(s.scholarship_id)?.program_name || "-"), badge(s.status),
    state.grades.filter(g => g.scholar_id === s.id && g.submission_status === "Verified").length,
    esc(state.grades.find(g => g.scholar_id === s.id && g.submission_status === "Verified")?.evaluation || "-")
  ]);
  return `<div class="page"><h2>Compliance Monitoring</h2>
    <p>Compliance is based on the assigned scholarship requirements and verified academic information.</p>
    ${table(["Student ID", "Scholar", "Scholarship", "Current Status", "Verified Submissions", "Latest Evaluation"], rows)}
  </div>`;
}

function reportsPage() {
  const count = st => state.scholars.filter(s => s.status === st).length;
  const perProgram = state.programs.map(p => {
    const list = state.scholars.filter(s => s.scholarship_id === p.id);
    const c = st => list.filter(s => s.status === st).length;
    return [esc(p.program_name), list.length, c("Compliant"), c("With Deficiency"), c("For Renewal"), c("Renewed")];
  });
  return `<div class="page"><h2>Compliance Reports</h2>
    <div class="cards">${stat("Active", count("Active"))}${stat("Compliant", count("Compliant"))}${stat("Deficiency", count("With Deficiency"))}${stat("For Renewal", count("For Renewal"))}</div>
    <div class="panel"><p>This report summarizes current scholar statuses for management monitoring.</p>
      <div class="toolbar"><button id="exportCsv" class="primary">Export Compliance Report (CSV)</button><button id="printReport">Print</button></div></div>
    ${table(["Scholarship", "Scholars", "Compliant", "With Deficiency", "For Renewal", "Renewed"], perProgram)}
  </div>`;
}

function exportCsv() {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Student ID", "Name", "Degree Program", "Year Level", "Scholarship", "Status", "Verified Submissions"]];
  state.scholars.forEach(s => lines.push([s.student_id, s.full_name, s.degree_program, s.year_level,
    program(s.scholarship_id)?.program_name || "", s.status,
    state.grades.filter(g => g.scholar_id === s.id && g.submission_status === "Verified").length]));
  const blob = new Blob([lines.map(r => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renewalPage() {
  const list = state.scholars.filter(s => ["Compliant", "For Renewal", "Renewed"].includes(s.status));
  const rows = list.map(s => [
    esc(s.student_id), esc(s.full_name), esc(program(s.scholarship_id)?.program_name || "-"), badge(s.status),
    s.status === "Compliant" ? `<button data-renew="${s.id}" data-to="For Renewal">Flag for Renewal</button>` :
    s.status === "For Renewal" ? `<button data-renew="${s.id}" data-to="Renewed">Mark Renewed</button>` : "-"
  ]);
  return `<div class="page"><h2>Scholarship Renewal Monitoring</h2>
    ${table(["Student ID", "Scholar", "Scholarship", "Status", "Action"], rows)}
  </div>`;
}

/* ---------- scholar pages ---------- */
function scholarDashboard() {
  const s = myScholar();
  if (!s) return `<div class="page"><h2>Scholar Dashboard</h2><div class="notice">No scholar record is linked to your account yet. Please contact the scholarship office.</div></div>`;
  const gs = state.grades.filter(g => g.scholar_id === s.id);
  return `<div class="page"><h2>Scholar Dashboard</h2>
    <div class="panel"><h3>Welcome, ${esc(state.profile.full_name)}</h3>
      <p><strong>Student ID:</strong> ${esc(s.student_id)}</p>
      <p><strong>Program:</strong> ${esc(s.degree_program)} | <strong>Year:</strong> ${esc(s.year_level)}</p>
      <p><strong>Scholarship:</strong> ${esc(program(s.scholarship_id)?.program_name || "")}</p>
      <p><strong>Status:</strong> ${badge(s.status)}</p>
    </div>
    <div class="cards">
      ${stat("My Submissions", gs.length)}
      ${stat("Pending", gs.filter(g => g.submission_status === "Pending").length)}
      ${stat("Verified", gs.filter(g => g.submission_status === "Verified").length)}
      ${stat("Current Status", esc(s.status))}
    </div></div>`;
}

function scholarSubmit() {
  if (!myScholar()) return `<div class="page"><h2>Submit Semester Grades</h2><div class="notice">No scholar record is linked to your account.</div></div>`;
  return `<div class="page"><h2>Submit Semester Grades</h2>
    <div class="notice">Your submission will initially be marked Pending/For Verification. Staff must verify it before final compliance evaluation.</div><br>
    <form id="scholarGradeForm" class="form-grid">
      <input id="sgAcademicYear" placeholder="Academic Year (e.g. 2026-2027)" required>
      <select id="sgSemester" required><option value="">Semester</option><option>1st Semester</option><option>2nd Semester</option><option>Summer</option></select>
      <input id="sgGwa" type="number" step="0.01" min="0" max="5" placeholder="GWA" required>
      <input id="sgUnits" type="number" min="0" placeholder="Units Enrolled" required>
      <input id="sgFailed" type="number" min="0" value="0" placeholder="Failed Subjects" required>
      <input id="sgIncomplete" type="number" min="0" value="0" placeholder="Incomplete Subjects" required>
      <button class="primary full" type="submit">Submit Grades</button>
    </form></div>`;
}

function scholarRequirements() {
  const p = program(myScholar()?.scholarship_id);
  return `<div class="page"><h2>My Scholarship Requirements</h2>
    <div class="panel"><h3>${esc(p?.program_name || "")}</h3>
      <p>Required GWA (maximum): <strong>${p?.required_gwa ?? "-"}</strong></p>
      <p>Minimum Units: <strong>${p?.min_units ?? "-"}</strong></p>
      <p>Failing Grade Policy: <strong>${p ? (p.allow_failing_grade ? "Allowed" : "Not Allowed") : "-"}</strong></p>
    </div></div>`;
}

function scholarStatus() {
  const s = myScholar();
  return `<div class="page"><h2>My Scholarship Status</h2>
    <div class="panel"><p><strong>Status:</strong> ${badge(s?.status || "Active")}</p>
    <p>Your status is determined from verified academic information and the requirements of your assigned scholarship program.</p></div></div>`;
}

function scholarHistory() {
  const s = myScholar();
  return `<div class="page"><h2>My Submission History</h2>
    ${table(["Academic Year", "Semester", "GWA", "Units", "Failed", "Incomplete", "Submission", "Evaluation"],
      state.grades.filter(g => g.scholar_id === s?.id).map(g => [esc(g.academic_year), esc(g.semester), g.gwa, g.units_enrolled,
        g.failed_subjects, g.incomplete_subjects, badge(g.submission_status), esc(g.evaluation || "-")]))}
  </div>`;
}

/* ---------- actions ---------- */
function bindActions() {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

  /* scholars */
  if ($("scholarTable")) {
    renderScholarTable();
    ["scholarSearch", "scholarStatusFilter", "scholarProgramFilter"].forEach(id => on(id, id === "scholarSearch" ? "input" : "change", renderScholarTable));
    $("scholarTable").addEventListener("change", e => {
      const id = e.target.dataset.statusFor;
      if (!id) return;
      guard(async () => {
        must(await db.from("scholars").update({ status: e.target.value }).eq("id", id));
        toast("Scholar status updated.");
        await refresh();
      });
    });
  }

  on("scholarForm", "submit", async e => {
    e.preventDefault();
    await guard(async () => {
      const sid = $("stStudentId").value.trim();
      if (!sid) throw new Error("Student ID cannot be blank.");
      if (state.scholars.some(s => s.student_id.toLowerCase() === sid.toLowerCase())) throw new Error("Student ID must be unique.");
      if (!$("stScholarship").value) throw new Error("Please select a scholarship program.");
      must(await db.from("scholars").insert({
        student_id: sid, full_name: $("stFullName").value.trim(), degree_program: $("stDegree").value.trim(),
        year_level: $("stYear").value.trim(), scholarship_id: $("stScholarship").value, status: $("stStatus").value
      }));
      toast("Scholar registered.");
      await refresh();
    }, e.submitter);
  });

  /* programs */
  on("programForm", "submit", async e => {
    e.preventDefault();
    await guard(async () => {
      const row = {
        program_name: $("programName").value.trim(), required_gwa: Number($("programGwa").value),
        min_units: Number($("programUnits").value), allow_failing_grade: $("programFail").checked, active: $("programActive").checked
      };
      if (!row.program_name) throw new Error("Program name is required.");
      if (row.required_gwa < 0 || row.required_gwa > 5) throw new Error("Required GWA must be between 0 and 5.");
      if (row.min_units < 0) throw new Error("Minimum units cannot be negative.");
      const id = $("programId").value;
      must(id ? await db.from("scholarship_programs").update(row).eq("id", id)
              : await db.from("scholarship_programs").insert(row));
      toast("Scholarship program saved.");
      await refresh();
    }, e.submitter);
  });

  document.querySelectorAll("[data-edit-program]").forEach(btn => btn.onclick = () => {
    const p = program(btn.dataset.editProgram);
    if (!p) return;
    $("programId").value = p.id; $("programName").value = p.program_name; $("programGwa").value = p.required_gwa;
    $("programUnits").value = p.min_units; $("programFail").checked = p.allow_failing_grade; $("programActive").checked = p.active;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.querySelectorAll("[data-toggle-program]").forEach(btn => btn.onclick = () => guard(async () => {
    const p = program(btn.dataset.toggleProgram);
    must(await db.from("scholarship_programs").update({ active: !p.active }).eq("id", p.id));
    await refresh();
  }, btn));

  /* users */
  on("staffAccountForm", "submit", async e => {
    e.preventDefault();
    await guard(async () => {
      // temporary client so the admin's own session is not replaced
      const tmp = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "tmp-signup" } });
      const { data, error } = await tmp.auth.signUp({
        email: $("saEmail").value.trim().toLowerCase(), password: $("saPassword").value,
        options: { data: { full_name: $("saName").value.trim() } }
      });
      if (error) throw error;
      const updated = must(await db.from("profiles").update({ role: $("saRole").value }).eq("id", data.user.id).select());
      if (!updated.length) throw new Error("Account could not be created. The email may already be registered.");
      toast("Account created.");
      await refresh();
    }, e.submitter);
  });

  document.querySelectorAll("[data-role-for]").forEach(sel => sel.onchange = () => guard(async () => {
    must(await db.from("profiles").update({ role: sel.value }).eq("id", sel.dataset.roleFor));
    toast("Role updated.");
    await refresh();
  }));

  /* grade verification */
  document.querySelectorAll("[data-verify]").forEach(btn => btn.onclick = () => guard(async () => {
    const result = must(await db.rpc("verify_submission", { p_id: btn.dataset.verify }));
    toast(`Submission verified: ${result}.`);
    await refresh();
  }, btn));

  /* renewal */
  document.querySelectorAll("[data-renew]").forEach(btn => btn.onclick = () => guard(async () => {
    must(await db.rpc("process_renewal", { p_scholar_id: btn.dataset.renew, p_status: btn.dataset.to }));
    toast(`Status changed to ${btn.dataset.to}.`);
    await refresh();
  }, btn));

  /* reports */
  on("exportCsv", "click", exportCsv);
  on("printReport", "click", () => window.print());

  /* scholar grade submission */
  on("scholarGradeForm", "submit", async e => {
    e.preventDefault();
    await guard(async () => {
      const s = myScholar();
      if (!s) throw new Error("No scholar record is linked to your account.");
      const g = {
        scholar_id: s.id, academic_year: $("sgAcademicYear").value.trim(), semester: $("sgSemester").value,
        gwa: Number($("sgGwa").value), units_enrolled: Number($("sgUnits").value),
        failed_subjects: Number($("sgFailed").value), incomplete_subjects: Number($("sgIncomplete").value)
      };
      if (g.gwa < 0 || g.gwa > 5) throw new Error("GWA must be within the valid range (0 - 5).");
      if (g.units_enrolled < 0 || g.failed_subjects < 0 || g.incomplete_subjects < 0) throw new Error("Values cannot be negative.");
      must(await db.from("grade_submissions").insert(g));
      toast("Grade submission saved as Pending.");
      currentPage = "history";
      await refresh();
    }, e.submitter);
  });
}

/* ---------- restore session on page load ---------- */
(async () => {
  await guard(async () => {
    const { data: { session } } = await db.auth.getSession();
    if (session) await startSession(session.user);
  });
})();
