<?php
declare(strict_types=1);

/*
 * database/set-password.php  -  recover from a lost password, or create an account, from the command line.
 *
 *   php database/set-password.php admin                 reset admin's password (a random one is printed once)
 *   php database/set-password.php admin admin           same, and make sure the role is "admin"
 *   php database/set-password.php jane staff            creates the account "jane" if it does not exist
 *
 * To choose the password yourself (at least 12 characters):
 *   MWAKI_NEW_PASSWORD='a long password' php database/set-password.php admin
 *
 * WHY A COMMAND-LINE TOOL? If every admin forgets their password there is nobody left to use the Accounts page.
 * Only someone who can run commands on the SERVER (and so could already read the database file) can use this,
 * which is the right level of trust for a recovery path. It also unlocks the account if it was throttled.
 */

if (PHP_SAPI !== 'cli') {          // never runnable from a web browser
    http_response_code(404);
    exit;
}

require_once dirname(__DIR__) . '/src/bootstrap.php';

use Mwaki\Database;

function fail(string $message): never
{
    fwrite(STDERR, "Error: $message\n");
    exit(1);
}

$username = $argv[1] ?? '';
$role     = $argv[2] ?? null;
if ($username === '' || in_array($username, ['-h', '--help'], true)) {
    fwrite(STDERR, "Usage: php database/set-password.php USERNAME [admin|staff]\n");
    exit(1);
}
if (preg_match('/^[A-Za-z0-9._-]{3,50}$/', $username) !== 1) {
    fail('A username has 3-50 characters: letters, digits, dot, dash or underscore.');
}
if ($role !== null && !in_array($role, ['admin', 'staff'], true)) {
    fail('The role must be "admin" or "staff".');
}
if (Database::scalar("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'") === null) {
    fail('The database has no tables yet. Run "php database/seed.php" first.');
}

$given = getenv('MWAKI_NEW_PASSWORD') ?: null;
if ($given !== null && strlen($given) < 12) {
    fail('The password must be at least 12 characters.');
}
if ($given !== null && strcasecmp($given, $username) === 0) {
    fail('The password must not be the same as the username.');
}
$password = $given ?? rtrim(strtr(base64_encode(random_bytes(12)), '+/', '-_'), '=');
$hash = password_hash($password, PASSWORD_DEFAULT);

$existing = Database::one('SELECT id, role FROM users WHERE username = ?', [$username]);
if ($existing === null) {
    if ($role === null) {
        fail("There is no account \"$username\". To create it, add a role: php database/set-password.php $username staff");
    }
    Database::execute('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [$username, $hash, $role]);
    echo "Created $role account \"$username\".\n";
} else {
    Database::execute('UPDATE users SET password_hash = ?, role = COALESCE(?, role) WHERE id = ?', [$hash, $role, $existing['id']]);
    echo "Password reset for \"$username\" (role: " . ($role ?? $existing['role']) . ").\n";
}

// Clear any lock-out left by earlier failed attempts (sign-in and password-change buckets).
Database::execute('DELETE FROM login_attempts WHERE username IN (?, ?)', [strtolower($username), 'pw:' . strtolower($username)]);

echo $given !== null ? "Password: (the one you supplied)\n" : "Password: $password   <- copy it now, it is not stored anywhere\n";
