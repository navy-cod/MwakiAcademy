<?php
declare(strict_types=1);

namespace Mwaki;

/**
 * Small helpers for talking HTTP: reading the request, writing the response.
 * All methods are `static`, which means you call them without creating an object:
 *     Http::json(200, ['ok' => true]);
 */
final class Http
{
    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    /** The URL path without the query string, e.g. "/api/programs". */
    public static function path(): string
    {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        return rawurldecode(is_string($path) ? $path : '/');
    }

    public static function clientIp(): string
    {
        // We use REMOTE_ADDR only. Headers such as X-Forwarded-For are written by the
        // CLIENT, so an attacker can fake them and dodge our login throttle.
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }

    /**
     * Send a JSON response and END the request.
     * The return type `never` tells PHP (and the reader) that this function never
     * returns, because it calls exit().
     */
    public static function json(int $status, mixed $data = null): never
    {
        http_response_code($status);
        if ($status !== 204 && $data !== null) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        exit;
    }

    /** Send an error response in the standard shape: {message, code, errors}. */
    public static function error(int $status, string $message, array $errors = [], string $code = ''): never
    {
        self::json($status, [
            'message' => $message,
            'code'    => $code,
            'errors'  => (object) $errors,   // (object) makes an empty list encode as {} not []
        ]);
    }

    /**
     * Read the request body as JSON.
     *
     * SECURITY: nothing in the body can be trusted. We check the content type, cap the
     * size, and make sure the result is a JSON *object* before anyone uses it.
     *
     * @return array<string,mixed>
     */
    public static function readJson(): array
    {
        $type = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
        if (!str_starts_with($type, 'application/json')) {
            throw new HttpException(415, 'Please send the data as JSON.');
        }

        $max = (int) config('request.max_body_bytes');
        // Read one byte more than allowed, so we can tell "exactly at the limit" from "over".
        $raw = (string) file_get_contents('php://input', false, null, 0, $max + 1);
        if (strlen($raw) > $max) {
            throw new HttpException(413, 'That request is too large.');
        }
        if (trim($raw) === '') {
            return [];
        }

        try {
            $data = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);   // depth limit 16
        } catch (\JsonException) {
            throw new HttpException(400, 'The request body is not valid JSON.');
        }
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            throw new HttpException(400, 'Expected a JSON object such as {"name": "value"}.');
        }
        return $data;
    }

    /**
     * Headers that ask the browser to be stricter. Each one closes a specific hole:
     *  - nosniff            stops the browser guessing a file's type (a trick used to run uploads as scripts)
     *  - Referrer-Policy    limits how much of our URLs leak to other sites
     *  - frame-ancestors    forbids other sites from embedding ours in an <iframe> (clickjacking)
     *  - Content-Security-Policy (CSP)   a whitelist of where scripts, styles, images may come from.
     *    Even if an attacker injected <script src="evil.js">, the browser would refuse to load it.
     *
     * $strictCsp = false is a TEMPORARY exception for the old student page, whose
     * code still uses inline onclick="..." handlers. Phase 3 rewrites it and removes this.
     */
    public static function securityHeaders(bool $strictCsp = true): void
    {
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        header('X-Frame-Options: DENY');
        header('Permissions-Policy: camera=(), microphone=(), geolocation=()');

        $csp = [
            "default-src 'self'",
            "script-src 'self' https://cdnjs.cloudflare.com" . ($strictCsp ? '' : " 'unsafe-inline'"),
            // 'unsafe-inline' for styles because the original pages use style="..." attributes.
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
            "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
            "img-src 'self' data: https:",        // https only: student photo URLs must be https
            "media-src 'self'",
            "connect-src 'self'",                 // fetch() may only talk to our own server
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ];
        header('Content-Security-Policy: ' . implode('; ', $csp));
    }

    /** The single place where every uncaught exception becomes a response. */
    public static function handleException(\Throwable $e): void
    {
        $status  = 500;
        $message = 'Something went wrong on our side. Please try again.';
        $errors  = [];
        $code    = '';

        if ($e instanceof HttpException) {
            // An error we raised on purpose: safe to tell the user exactly what it says.
            $status  = $e->getStatus();
            $message = $e->getMessage();
            $errors  = $e->getErrors();
            $code    = $e->getErrorCode();
        } else {
            // An unexpected bug. Log the details for the developer; tell the user nothing
            // specific (SECURITY: error text can leak table names, file paths, ...).
            error_log(sprintf('[mwaki] %s: %s in %s:%d', get_class($e), $e->getMessage(), $e->getFile(), $e->getLine()));
        }

        if (PHP_SAPI === 'cli') {                       // e.g. running database/seed.php
            fwrite(STDERR, "Error: {$e->getMessage()}\n");
            exit(1);
        }
        if (headers_sent()) {
            exit(1);
        }

        if (str_starts_with(self::path(), '/api/')) {
            $body = ['message' => $message, 'code' => $code, 'errors' => (object) $errors];
            if (config('app.debug') && !($e instanceof HttpException)) {
                $body['debug'] = [get_class($e), $e->getMessage(), basename($e->getFile()) . ':' . $e->getLine()];
            }
            self::json($status, $body);
        }

        http_response_code($status);
        header('Content-Type: text/plain; charset=utf-8');
        echo $message;
        exit;
    }
}
