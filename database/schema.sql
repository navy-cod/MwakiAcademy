-- database/schema.sql
--
-- The blueprint of the database. Safe to run repeatedly: every statement says
-- "IF NOT EXISTS", so running it on an existing database changes nothing.
--
-- CONCEPT: a TABLE is like a spreadsheet tab (columns = fields, rows = records).
--   PRIMARY KEY      a unique id for each row
--   NOT NULL         the column must have a value
--   UNIQUE           no two rows may share the value
--   CHECK(...)       the database itself rejects impossible values (a safety net behind our PHP validation)
--   FOREIGN KEY      a column that must point at a real row in another table (no student can
--                    belong to a program that does not exist)
-- Dates are stored as text in ISO format (YYYY-MM-DD) because it sorts correctly as plain text.

PRAGMA foreign_keys = ON;

-- Staff accounts. Passwords are stored ONLY as hashes.
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,   -- NOCASE: "Admin" and "admin" are the same
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'staff')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The degree programs on offer. One row per program.
CREATE TABLE IF NOT EXISTS programs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL UNIQUE,
    faculty             TEXT    NOT NULL,
    annual_tuition_kes  INTEGER CHECK (annual_tuition_kes IS NULL OR annual_tuition_kes >= 0),
    additional_fees_kes INTEGER CHECK (additional_fees_kes IS NULL OR additional_fees_kes >= 0),
    min_kcse            TEXT    NOT NULL,                    -- lowest accepted KCSE mean grade, e.g. 'C+'
    intakes             TEXT    NOT NULL                     -- comma list, e.g. 'September,January'
    -- (A comma list is a deliberate simplification. A fully "normalised" design would use a
    --  separate program_intakes table with one row per program + intake.)
);

-- Enrolled students (the student manager).
CREATE TABLE IF NOT EXISTS students (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_code TEXT    NOT NULL UNIQUE,                    -- e.g. MU-2024-001
    first_name   TEXT    NOT NULL,
    last_name    TEXT    NOT NULL,
    email        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    phone        TEXT    NOT NULL,                           -- stored as +254...
    grade        REAL    NOT NULL CHECK (grade BETWEEN 0 AND 100),
    program_id   INTEGER NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
    address      TEXT    NOT NULL,
    dob          TEXT    NOT NULL,                           -- YYYY-MM-DD. Age is CALCULATED from this, never stored.
    image_url    TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_program ON students(program_id);

-- Online admission applications (Phase 2).
CREATE TABLE IF NOT EXISTS applications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reference     TEXT    NOT NULL UNIQUE,                   -- shown to the applicant, e.g. MU-2026-K7F3QA
    full_name     TEXT    NOT NULL,
    email         TEXT    NOT NULL COLLATE NOCASE,
    phone         TEXT    NOT NULL,
    gender        TEXT    CHECK (gender IS NULL OR gender IN ('Male', 'Female')),
    dob           TEXT    NOT NULL,
    address       TEXT    NOT NULL,
    program_id    INTEGER NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
    kcse_grade    TEXT    NOT NULL,
    intake_year   INTEGER NOT NULL,
    intake_period TEXT    NOT NULL,
    motivation    TEXT    NOT NULL,
    how_heard     TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

-- Messages from the contact form (Phase 2).
CREATE TABLE IF NOT EXISTS inquiries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL COLLATE NOCASE,
    phone      TEXT,
    message    TEXT    NOT NULL,
    handled    INTEGER NOT NULL DEFAULT 0 CHECK (handled IN (0, 1)),   -- 0 = new, 1 = dealt with
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Failed sign-in attempts, used to throttle password guessing.
CREATE TABLE IF NOT EXISTS login_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    NOT NULL,
    ip           TEXT    NOT NULL,
    attempted_at INTEGER NOT NULL                             -- Unix timestamp (seconds)
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(username, ip, attempted_at);
