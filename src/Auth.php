<?php
declare(strict_types=1);

namespace Mwaki;

/**
 * Sessions, sign-in, sign-out, role checks and CSRF protection.
 *
 * CONCEPT: HTTP is "stateless": each request arrives with no memory of the previous one.
 * A SESSION adds memory. On the first visit PHP creates a random session id, stores data
 * for it on the server (here: which user is signed in), and sends the id to the browser
 * in a COOKIE. The browser returns that cookie with every later request, so the server
 * can look the data up again. The password is only ever sent once, at sign-in.
 */
final class Auth
{
    /**
     * A valid bcrypt hash of a password nobody knows. When someone tries a username that
     * does not exist we still verify against this, so a miss takes about as long as a hit.
     * Otherwise an attacker could measure response times to discover which usernames exist.
     */
    private const DUMMY_HASH = '$2y$10$CWy8VOzmd1SOFZcAcl.y2e2zMn1vtRUWvz0tsRpTfz95TskrVohXq';

    private static ?array $user = null;
    private static bool $userLoaded = false;

    /** Start (or resume) the session with safe cookie settings. Call once per API request. */
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        // Accept only session ids that WE created (blocks "session fixation" attacks, where
        // an attacker plants a known id in the victim's browser), and only from cookies
        // (never from the URL, where ids leak into logs and shared links).
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');

        session_name((string) config('session.name'));
        session_set_cookie_params([
            'lifetime' => 0,                          // forget the cookie when the browser closes
            'path'     => '/',
            'secure'   => self::isHttps(),            // only send over HTTPS when we are on HTTPS
            'httponly' => true,                       // JavaScript cannot read it, so XSS cannot steal it
            'samesite' => 'Lax',                      // not sent on cross-site POSTs (first line of CSRF defence)
        ]);
        session_start();

        // Sign out people who have been idle too long.
        $now = time();
        $idleLimit = (int) config('session.idle_timeout');
        if (isset($_SESSION['last_seen']) && ($now - (int) $_SESSION['last_seen']) > $idleLimit) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
        $_SESSION['last_seen'] = $now;

        // Every session gets a CSRF token (explained in verifyCsrf below).
        $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    }

    private static function isHttps(): bool
    {
        return !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    }

    // ------------------------------------------------------------------ who is signed in?

    /** The signed-in user row, or null. Looked up fresh each request so role changes apply at once. */
    public static function user(): ?array
    {
        if (self::$userLoaded) {
            return self::$user;
        }
        self::$userLoaded = true;

        $id = $_SESSION['user_id'] ?? null;
        if ($id !== null) {
            self::$user = Database::one(
                'SELECT id, username, role, student_id, created_at FROM users WHERE id = ?',
                [$id]
            );
            if (self::$user === null) {
                unset($_SESSION['user_id']);          // the account was deleted after sign-in
            }
        }
        return self::$user;
    }

    /** The fields that are safe to send to the browser (never the password hash!). */
    public static function publicUser(?array $row): ?array
    {
        if ($row === null) {
            return null;
        }
        return [
            'id'        => (int) $row['id'],
            'username'  => $row['username'],
            'role'      => $row['role'],
            'studentId' => ($row['student_id'] ?? null) === null ? null : (int) $row['student_id'],
            // SQLite stores UTC as "2026-11-02 10:30:00"; convert to ISO 8601 for JavaScript.
            'createdAt' => str_replace(' ', 'T', (string) $row['created_at']) . 'Z',
        ];
    }

    /**
     * Guard for protected endpoints. Call at the top of a controller method:
     *     $user = Auth::requireUser('admin', 'staff');
     * With no roles listed, any signed-in user passes.
     *
     * CONCEPT: 401 vs 403.
     *   401 Unauthorized = "I don't know who you are" (not signed in)  -> the page sends you to sign in
     *   403 Forbidden    = "I know who you are, and the answer is no"  -> wrong role
     * SECURITY: this check MUST happen on the server. Hiding a button in JavaScript only
     * hides it; it does not stop anyone from calling the URL directly.
     */
    public static function requireUser(string ...$roles): array
    {
        $user = self::user();
        if ($user === null) {
            throw new HttpException(401, 'Please sign in to continue.', [], 'unauthenticated');
        }
        if ($roles !== [] && !in_array($user['role'], $roles, true)) {
            throw new HttpException(403, 'You do not have permission to do that.', [], 'forbidden');
        }
        return $user;
    }

    // ------------------------------------------------------------------ sign in / out

    /**
     * Check credentials and, if correct, sign the user in.
     * @return array the public user
     */
    public static function attempt(string $username, string $password): array
    {
        $ip  = Http::clientIp();
        $key = strtolower($username);

        self::assertNotThrottled($key, $ip);

        $user = Database::one('SELECT id, username, role, password_hash, created_at FROM users WHERE username = ?', [$username]);

        // CONCEPT: hashing. We never store passwords, only a one-way "hash". password_verify()
        // re-hashes what was typed and compares. Even we cannot recover the original password.
        $passwordOk = password_verify($password, $user['password_hash'] ?? self::DUMMY_HASH);

        if ($user === null || !$passwordOk) {
            self::recordFailure($key, $ip);
            // SECURITY: the SAME message whether the username or the password was wrong,
            // so the response never reveals which usernames exist.
            throw new HttpException(401, 'Invalid username or password.', [], 'bad_credentials');
        }

        self::clearFailures($key, $ip);

        // If PHP's recommended hashing strength has increased since this hash was made, upgrade it.
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            Database::execute('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }

        // SECURITY: issue a NEW session id at the moment of sign-in. An id that existed before
        // sign-in might have been planted by an attacker (session fixation); the new one cannot have been.
        session_regenerate_id(true);
        $_SESSION['user_id']   = (int) $user['id'];
        $_SESSION['csrf']      = bin2hex(random_bytes(32));
        $_SESSION['last_seen'] = time();
        self::$userLoaded = false;

        return self::publicUser($user);
    }

    /**
     * Change the password of the user who is signed in.
     *
     * Why ask for the CURRENT password when they are already signed in? A session can be left open on a
     * shared computer or stolen. Without this check, whoever holds the session could lock the real owner out.
     * Wrong guesses are throttled like sign-in guesses (in their own bucket, so guessing here cannot lock
     * the owner out of signing in).
     */
    public static function changePassword(array $user, string $current, string $new): void
    {
        $ip  = Http::clientIp();
        $key = 'pw:' . strtolower($user['username']);
        self::assertNotThrottled($key, $ip);

        $row = Database::one('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
        if ($row === null || !password_verify($current, $row['password_hash'])) {
            self::recordFailure($key, $ip);
            // 422, not 401: a 401 would make the pages think the session ended and send you to the login page.
            throw new HttpException(422, 'Please correct the highlighted fields.', ['currentPassword' => 'That is not your current password.'], 'bad_password');
        }
        self::clearFailures($key, $ip);

        Database::execute('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $user['id']]);

        // A security-sensitive change: start a fresh session id and CSRF token, as at sign-in.
        session_regenerate_id(true);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }

    // ------------------------------------------------------------------ throttling (shared by sign-in and password change)

    /**
     * CONCEPT: throttling. Without a limit, a script could try millions of passwords.
     * We count FAILED attempts for this key + IP in the last 15 minutes and refuse once there are too many.
     */
    private static function assertNotThrottled(string $key, string $ip): void
    {
        $window = (int) config('auth.window_seconds');
        $max    = (int) config('auth.max_attempts');
        $since  = time() - $window;

        $failures = (int) Database::scalar(
            'SELECT COUNT(*) FROM login_attempts WHERE username = ? AND ip = ? AND attempted_at > ?',
            [$key, $ip, $since]
        );
        if ($failures < $max) {
            return;
        }
        $oldest = (int) Database::scalar(
            'SELECT MIN(attempted_at) FROM login_attempts WHERE username = ? AND ip = ? AND attempted_at > ?',
            [$key, $ip, $since]
        );
        $seconds = max(1, $oldest + $window - time());
        header('Retry-After: ' . $seconds);
        $minutes = (int) ceil($seconds / 60);
        throw new HttpException(
            429,
            "Too many failed sign-in attempts. Please wait $minutes minute" . ($minutes === 1 ? '' : 's') . ' and try again.',
            [],
            'throttled'
        );
    }

    private static function recordFailure(string $key, string $ip): void
    {
        Database::execute('INSERT INTO login_attempts (username, ip, attempted_at) VALUES (?, ?, ?)', [$key, $ip, time()]);
        Database::execute('DELETE FROM login_attempts WHERE attempted_at <= ?', [time() - (int) config('auth.window_seconds')]);   // tidy old rows
    }

    private static function clearFailures(string $key, string $ip): void
    {
        Database::execute('DELETE FROM login_attempts WHERE username = ? AND ip = ?', [$key, $ip]);
    }

    public static function logout(): void
    {
        $_SESSION = [];
        $p = session_get_cookie_params();
        // Tell the browser to delete the cookie (a cookie with a date in the past expires at once).
        setcookie(session_name(), '', [
            'expires'  => time() - 3600,
            'path'     => $p['path'],
            'domain'   => $p['domain'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'] ?: 'Lax',
        ]);
        session_destroy();
        self::$user = null;
        self::$userLoaded = false;
    }

    // ------------------------------------------------------------------ CSRF

    public static function csrfToken(): string
    {
        return (string) ($_SESSION['csrf'] ?? '');
    }

    /**
     * CONCEPT: CSRF (cross-site request forgery). Browsers attach your cookies to requests
     * automatically, even ones triggered by a DIFFERENT website. Imagine you are signed in
     * to the university site and open an evil page containing a hidden form that POSTs to
     * "delete student 5". Your browser would obediently include your session cookie.
     *
     * Defence: a secret token that only OUR pages know. The server puts it in the session;
     * our JavaScript fetches it and sends it back in a header (X-CSRF-Token) on every
     * state-changing request. The evil page cannot read it (browsers forbid cross-site
     * reads) so its forged request has no valid token and is refused.
     */
    public static function verifyCsrf(): void
    {
        $expected = $_SESSION['csrf'] ?? '';
        $sent     = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        // hash_equals compares in constant time, so response timing cannot leak the token.
        if ($expected === '' || !is_string($sent) || !hash_equals($expected, $sent)) {
            throw new HttpException(403, 'Your session has expired. Please try again.', [], 'csrf');
        }
    }
}
