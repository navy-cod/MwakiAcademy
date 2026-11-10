<?php
declare(strict_types=1);

/*
 * database/migrate.php  -  apply the "student login" schema change to an EXISTING database.
 *
 *     php database/migrate.php
 *
 * Fresh installs do NOT need this: `php database/seed.php` builds the new schema from
 * database/schema.sql. Existing installs run this once to:
 *   - allow role 'student' in the users table
 *   - add users.student_id, linking a student login to a students row
 *
 * IDEMPOTENT: safe to run more than once. If the change is already applied, it does nothing.
 */

if (PHP_SAPI !== 'cli') {          // never runnable from a web browser
    http_response_code(404);
    exit;
}

require_once dirname(__DIR__) . '/src/bootstrap.php';

use Mwaki\Database;

$pdo = Database::pdo();

// If there is no users table at all, this is a fresh database: run seed.php instead.
$hasUsersTable = Database::scalar(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'"
);
if ($hasUsersTable === null) {
    echo "No users table yet. Run 'php database/seed.php' first, then re-run this script.\n";
    exit(0);
}

// Is the migration already applied? (Does users.student_id exist?)
$hasStudentId = false;
foreach (Database::all('PRAGMA table_info(users)') as $column) {
    if ($column['name'] === 'student_id') {
        $hasStudentId = true;
        break;
    }
}
if ($hasStudentId) {
    echo "Migration already applied. Nothing to do.\n";
    exit(0);
}

echo "Rebuilding users table to allow the 'student' role and add student_id...\n";

$pdo->beginTransaction();
try {
    // 1. Move the old table aside.
    $pdo->exec('ALTER TABLE users RENAME TO users_old');

    // 2. Create the new table (matches schema.sql).
    $pdo->exec("CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT    NOT NULL,
        role          TEXT    NOT NULL CHECK (role IN ('admin', 'staff', 'student')),
        student_id    INTEGER REFERENCES students(id) ON DELETE CASCADE,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        CHECK ((role = 'student' AND student_id IS NOT NULL) OR (role <> 'student' AND student_id IS NULL))
    )");

    // 3. Copy every existing user. student_id is NULL for admin/staff (they are not students).
    $pdo->exec(
        'INSERT INTO users (id, username, password_hash, role, student_id, created_at)
         SELECT id, username, password_hash, role, NULL, created_at FROM users_old'
    );

    // 4. Drop the old table.
    $pdo->exec('DROP TABLE users_old');

    // 5. Add the index (matches schema.sql).
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_users_student ON users(student_id)');

    $pdo->commit();
    echo "Done. Existing accounts are unchanged; the new 'student' role is now available.\n";
} catch (\Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'Migration failed: ' . $e->getMessage() . "\n");
    exit(1);
}