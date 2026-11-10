
PRAGMA foreign_keys = ON;

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

-- Staff AND student sign-in accounts. Passwords are stored ONLY as hashes.
-- role 'admin' / 'staff': staff accounts (student_id IS NULL)
-- role 'student':          a student who can sign in (student_id points at a students row).
--                          Deleting the student cascades to this row (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,   -- NOCASE: "Admin" and "admin" are the same
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'staff', 'student')),
    student_id    INTEGER REFERENCES students(id) ON DELETE CASCADE,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    -- The database itself enforces "student accounts belong to a student, and only they do":
    CHECK ((role = 'student' AND student_id IS NOT NULL) OR (role <> 'student' AND student_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_users_student ON users(student_id);

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