<?php
declare(strict_types=1);

/*
 * router.php  -  helper for PHP's built-in development server.
 *
 *     php -S localhost:8000 -t public router.php
 *
 * The built-in server normally maps URLs straight to files. When you give it a router
 * script, EVERY request runs through this file first, and we decide what happens:
 *   - /api/...     -> the PHP front controller
 *   - .html pages  -> sent by us, so we can attach security headers
 *   - everything else that exists under /public (css, js, images, .php) -> `return false`
 *     which means "server, please handle this the normal way"
 *   - anything else -> 404
 *
 * On a real web server (Apache/Nginx) their own configuration does this job instead.
 */

require_once __DIR__ . '/src/bootstrap.php';

use Mwaki\Auth;
use Mwaki\Http;

$public = realpath(__DIR__ . '/public');
$path   = Http::path();

if (str_contains($path, "\0")) {              // a NUL byte in a path is always an attack
    http_response_code(400);
    exit('Bad request');
}

function signed_in_user(): ?array
{
    try {
        Auth::start();
        return Auth::user();
    } catch (\Throwable $e) {
        error_log('[mwaki] sign-in check failed: ' . $e->getMessage());
        return null;
    }
}

function is_signed_in(): bool
{
    return signed_in_user() !== null;
}

function needs_login(string $path): bool
{
    return (bool) config('app.require_login')
        && str_ends_with(strtolower($path), '.html')
        && !in_array($path, (array) config('app.public_pages'), true);
}

if ($path === '/') {
    if (!config('app.require_login')) {
        header('Location: /home.html', true, 302);
        exit;
    }
    $user = signed_in_user();
    if ($user === null) {
        header('Location: /login.html', true, 302);
        exit;
    }
    $role = $user['role'] ?? '';
    if ($role === 'admin' || $role === 'staff') {
        $target = '/admin.html';
    } elseif ($role === 'student') {
        $target = '/student-portal.html';
    } else {
        $target = '/home.html';
    }
    header('Location: ' . $target, true, 302);
    exit;
}

if (str_starts_with($path, '/api/')) {
    require $public . '/api/index.php';
    return true;
}

if (needs_login($path) && !is_signed_in()) {
    Http::securityHeaders();
    $wanted = ltrim($path, '/');
    $query = preg_match('~^[A-Za-z0-9_\-/]+\.html$~', $wanted) === 1 ? '?next=' . rawurlencode($wanted) : '';
    header('Cache-Control: no-store');
    header('Location: /login.html' . $query, true, 302);
    exit;
}

// A student may open only their own portal and the public pages. Any staff page redirects them.
// (This is a convenience: the API endpoints they would reach also refuse them with 403.)
if (is_signed_in()) {
    $role = ($u = signed_in_user())['role'] ?? '';
    if ($role === 'student' && in_array($path, ['/admin.html', '/details.html', '/e_students/students.html'], true)) {
        header('Location: /student-portal.html', true, 302);
        exit;
    }
}
// SECURITY: path traversal. A URL like /../config/config.php tries to climb out of /public.
// realpath() resolves any "../" parts to the true location on disk, and then we insist the
// result is still INSIDE /public. (We must check this ourselves because we read files below.)
$file = realpath($public . $path);
$isInsidePublic = $file !== false
    && str_starts_with($file, $public . DIRECTORY_SEPARATOR)
    && is_file($file);

if (!$isInsidePublic) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo '404 - Page not found';
    return true;
}

if (strtolower(pathinfo($file, PATHINFO_EXTENSION)) === 'html') {
    Http::securityHeaders();
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    readfile($file);
    return true;
}

return false;   // css, js, images, media, and .php files: let the server do its normal job
