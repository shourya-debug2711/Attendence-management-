
const $ = id => document.getElementById(id);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

let noticeTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function notify(message, error = false) {
  const box = $("notice");
  box.textContent = message;
  box.className = error ? "notice error" : "notice";
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => box.hidden = true, 3500);
}

function showPage(page) {
  document.querySelectorAll(".page").forEach(section => {
    section.hidden = section.id !== page;
  });

  document.querySelectorAll(".nav-link").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  const titles = {
    dashboard: "Dashboard Overview",
    students: "Student Directory",
    attendance: "Daily Attendance",
    reports: "Attendance Reports"
  };

  $("page-title").textContent = titles[page];
  $("crumb").textContent = titles[page];

  if (page === "dashboard") loadDashboard();
  if (page === "students") loadStudents();
  if (page === "attendance") loadAttendance();
  if (page === "reports") loadReportStudents();
}

function toggleForm(force) {
  const form = $("student-form");
  form.hidden = force === undefined ? !form.hidden : !force;
  if (!form.hidden) form.elements.name.focus();
}

async function loadDashboard() {
  try {
    const [stats, students] = await Promise.all([
      api(`/api/dashboard?date=${today()}`),
      api("/api/students")
    ]);

    $("totalStudents").textContent = stats.totalStudents;
    $("presentCount").textContent = stats.present;
    $("absentCount").textContent = stats.absent;
    $("attendanceRate").textContent = stats.percentage + "%";
    $("donut-rate").textContent = stats.percentage + "%";

    $("legend-present").textContent = stats.present;
    $("legend-absent").textContent = stats.absent;
    $("legend-late").textContent = stats.late;
    $("legend-unmarked").textContent =
      Math.max(0, stats.totalStudents - stats.marked);

    const presentAngle = stats.totalStudents
      ? (stats.present / stats.totalStudents) * 360 : 0;
    const lateAngle = stats.totalStudents
      ? (stats.late / stats.totalStudents) * 360 : 0;
    const absentAngle = stats.totalStudents
      ? (stats.absent / stats.totalStudents) * 360 : 0;

    $("donut").style.background =
      `conic-gradient(var(--green) 0deg ${presentAngle}deg,
      var(--blue) ${presentAngle}deg ${presentAngle + lateAngle}deg,
      var(--red) ${presentAngle + lateAngle}deg
      ${presentAngle + lateAngle + absentAngle}deg,
      #edf0f7 ${presentAngle + lateAngle + absentAngle}deg 360deg)`;

    $("recent-students").innerHTML = students.slice(0, 5).map(s => `
      <tr>
        <td>${studentCell(s.name)}</td>
        <td>${esc(s.roll_no)}</td>
        <td>${esc(s.course)}</td>
        <td>${esc(s.semester)}</td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="empty-state">No students registered yet.</td></tr>`;
  } catch (error) {
    notify(error.message, true);
  }
}

function studentCell(name) {
  const initials = String(name || "?").trim().split(/\s+/)
    .slice(0, 2).map(n => n[0] || "").join("").toUpperCase();

  return `<div class="student-cell">
    <span class="student-avatar">${esc(initials)}</span>
    <span>${esc(name)}</span>
  </div>`;
}

async function loadStudents() {
  try {
    const search = $("student-search").value.trim();
    const students = await api(
      `/api/students?search=${encodeURIComponent(search)}`
    );

    $("student-count").textContent =
      `${students.length} student${students.length === 1 ? "" : "s"}`;

    $("students-body").innerHTML = students.map(s => `
      <tr>
        <td>${studentCell(s.name)}</td>
        <td>${esc(s.roll_no)}</td>
        <td>${esc(s.course)}</td>
        <td>${esc(s.semester)}</td>
        <td>${esc(s.email || "—")}</td>
        <td><button class="delete-button"
          onclick="deleteStudent(${Number(s.id)})">Delete</button></td>
      </tr>
    `).join("") || `<tr><td colspan="6" class="empty-state">No students found.</td></tr>`;
  } catch (error) {
    notify(error.message, true);
  }
}

$("student-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    const result = await api("/api/students", {
      method: "POST",
      body: JSON.stringify(data)
    });

    form.reset();
    toggleForm(false);
    notify(result.message);
    await loadStudents();
    await loadDashboard();
  } catch (error) {
    notify(error.message, true);
  }
});

async function deleteStudent(id) {
  if (!confirm("Delete this student and all their attendance records?")) return;

  try {
    const result = await api(`/api/students/${id}`, {
      method: "DELETE"
    });
    notify(result.message);
    await loadStudents();
    await loadDashboard();
  } catch (error) {
    notify(error.message, true);
  }
}

$("student-search").addEventListener("input", loadStudents);

async function loadAttendance() {
  const date = $("attendance-date").value || today();
  $("attendance-date").value = date;

  try {
    const rows = await api(`/api/attendance?date=${encodeURIComponent(date)}`);

    const marked = rows.filter(s => s.status).length;
    $("marked-count").textContent = `${marked} / ${rows.length} marked`;

    $("attendance-body").innerHTML = rows.map(s => `
      <tr>
        <td>${studentCell(s.name)}</td>
        <td>${esc(s.roll_no)}</td>
        <td>${esc(s.course)}</td>
        <td>
          <select class="status-select"
            aria-label="Attendance for ${esc(s.name)}"
            data-student="${Number(s.id)}"
            onchange="saveAttendance(this)">
            <option value="" ${!s.status ? "selected" : ""}>Not marked</option>
            <option value="Present" ${s.status === "Present" ? "selected" : ""}>Present</option>
            <option value="Absent" ${s.status === "Absent" ? "selected" : ""}>Absent</option>
            <option value="Late" ${s.status === "Late" ? "selected" : ""}>Late</option>
          </select>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="empty-state">Add students before marking attendance.</td></tr>`;
  } catch (error) {
    notify(error.message, true);
  }
}

async function saveAttendance(select) {
  const status = select.value;
  if (!status) {
    notify("Choose Present, Absent, or Late.", true);
    return;
  }

  select.disabled = true;

  try {
    const result = await api("/api/attendance", {
      method: "POST",
      body: JSON.stringify({
        student_id: Number(select.dataset.student),
        date: $("attendance-date").value,
        status
      })
    });

    notify(result.message);
    await loadAttendance();
    await loadDashboard();
  } catch (error) {
    notify(error.message, true);
    select.disabled = false;
  }
}

$("attendance-date").addEventListener("change", loadAttendance);

async function loadReportStudents() {
  try {
    const students = await api("/api/students");
    const select = $("report-student");
    const previous = select.value;

    select.innerHTML = `<option value="">Choose a student</option>` +
      students.map(s => `
        <option value="${Number(s.id)}">${esc(s.roll_no)} — ${esc(s.name)}</option>
      `).join("");

    if (students.some(s => String(s.id) === previous)) {
      select.value = previous;
    }
  } catch (error) {
    notify(error.message, true);
  }
}

async function loadReport() {
  const id = $("report-student").value;
  const output = $("report-result");

  if (!id) {
    output.innerHTML = `<div class="empty-state">Select a student to view their report.</div>`;
    return;
  }

  try {
    const report = await api(`/api/reports/${encodeURIComponent(id)}`);

    output.innerHTML = `
      <div class="report-cards">
        <div class="report-metric"><small>Total Marked Days</small><b>${report.total}</b></div>
        <div class="report-metric"><small>Present / Late Days</small><b>${report.present}</b></div>
        <div class="report-metric"><small>Attendance Percentage</small><b>${report.percentage}%</b></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>DATE</th><th>STATUS</th></tr></thead>
          <tbody>
            ${report.records.map(r => `
              <tr><td>${esc(r.attendance_date)}</td><td>${esc(r.status)}</td></tr>
            `).join("") ||
            `<tr><td colspan="2" class="empty-state">No attendance records yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="save-bar"><span>Present percentage includes Late days.</span>
        <button class="primary" onclick="window.print()">Print Report</button>
      </div>
    `;
  } catch (error) {
    notify(error.message, true);
  }
}

$("today-label").textContent = new Date().toLocaleDateString("en-IN", {
  day: "numeric", month: "short", year: "numeric"
});
$("attendance-date").value = today();

loadDashboard();
