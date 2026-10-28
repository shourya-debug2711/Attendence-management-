
const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = mysql.createPool({
  host: "localhost",
  user: "attendance_user",
  password: process.env.DB_PASSWORD || "Attendance@123",
  database: "attendance_db",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ connected: true });
  } catch (error) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

// Dashboard statistics
app.get("/api/dashboard", async (req, res) => {
  try {
    const [[{ totalStudents }]] = await pool.query(
      "SELECT COUNT(*) AS totalStudents FROM students"
    );

    const date = req.query.date ||
      new Date().toISOString().slice(0, 10);

    const [stats] = await pool.query(
      `SELECT
        COUNT(*) AS marked,
        COALESCE(SUM(status = 'Present'), 0) AS present,
        COALESCE(SUM(status = 'Absent'), 0) AS absent,
        COALESCE(SUM(status = 'Late'), 0) AS late
       FROM attendance WHERE attendance_date = ?`,
      [date]
    );

    const s = stats[0];
    const percentage = s.marked
      ? Math.round((Number(s.present) + Number(s.late)) /
          totalStudents * 10000) / 100
      : 0;

    res.json({
      totalStudents,
      marked: Number(s.marked),
      present: Number(s.present),
      absent: Number(s.absent),
      late: Number(s.late),
      percentage: totalStudents ? percentage : 0,
      date
    });
  } catch (error) {
    res.status(500).json({ error: "Could not load dashboard" });
  }
});

// List and search students
app.get("/api/students", async (req, res) => {
  try {
    const search = `%${req.query.search || ""}%`;
    const [rows] = await pool.query(
      `SELECT * FROM students
       WHERE name LIKE ? OR roll_no LIKE ? OR course LIKE ?
       ORDER BY id DESC`,
      [search, search, search]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Could not load students" });
  }
});

// Add a student
app.post("/api/students", async (req, res) => {
  const { roll_no, name, course, semester, email } = req.body;

  if (![roll_no, name, course, semester].every(
    v => typeof v === "string" && v.trim()
  )) {
    return res.status(400).json({
      error: "Roll number, name, course and semester are required"
    });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO students
       (roll_no, name, course, semester, email)
       VALUES (?, ?, ?, ?, ?)`,
      [
        roll_no.trim(), name.trim(), course.trim(),
        semester.trim(), email?.trim() || null
      ]
    );

    res.status(201).json({
      message: "Student added successfully",
      id: result.insertId
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "This roll number already exists"
      });
    }
    res.status(500).json({ error: "Could not add student" });
  }
});

// Delete a student and their attendance records
app.delete("/api/students/:id", async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM students WHERE id = ?",
      [req.params.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json({ message: "Student deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Could not delete student" });
  }
});

// Get attendance for a selected date
app.get("/api/attendance", async (req, res) => {
  const date = req.query.date ||
    new Date().toISOString().slice(0, 10);

  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.roll_no, s.name, s.course,
              a.status, a.attendance_date
       FROM students s
       LEFT JOIN attendance a
         ON a.student_id = s.id AND a.attendance_date = ?
       ORDER BY s.roll_no`,
      [date]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Could not load attendance" });
  }
});

// Mark or update attendance
app.post("/api/attendance", async (req, res) => {
  const { student_id, date, status } = req.body;
  const validStatuses = ["Present", "Absent", "Late"];

  if (!Number.isInteger(Number(student_id)) ||
      !date || !validStatuses.includes(status)) {
    return res.status(400).json({
      error: "Valid student, date and status are required"
    });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO attendance (student_id, attendance_date, status)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [Number(student_id), date, status]
    );

    res.json({ message: "Attendance saved successfully" });
  } catch (error) {
    res.status(500).json({ error: "Could not save attendance" });
  }
});

// Attendance history for a student
app.get("/api/reports/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT attendance_date, status
       FROM attendance
       WHERE student_id = ?
       ORDER BY attendance_date DESC`,
      [req.params.id]
    );

    const present = rows.filter(r =>
      r.status === "Present" || r.status === "Late"
    ).length;

    res.json({
      records: rows,
      total: rows.length,
      present,
      absent: rows.filter(r => r.status === "Absent").length,
      late: rows.filter(r => r.status === "Late").length,
      percentage: rows.length
        ? Math.round(present / rows.length * 10000) / 100
        : 0
    });
  } catch (error) {
    res.status(500).json({ error: "Could not load report" });
  }
});

app.listen(PORT, () => {
  console.log(`Attendance system running at http://localhost:${PORT}`);
});
