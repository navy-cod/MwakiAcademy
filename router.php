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

use Mwaki\Http;

$public = realpath(__DIR__ . '/public');
$path   = Http::path();

if (str_contains($path, "\0")) {              // a NUL byte in a path is always an attack
    http_response_code(400);
    exit('Bad request');
}

if ($path === '/') {
    header('Location: /home.html', true, 302);
    exit;
}

if (str_starts_with($path, '/api/')) {
    require $public . '/api/index.php';
    return true;
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
