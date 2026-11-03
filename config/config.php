<?php
declare(strict_types=1);

/*
 * config/config.php
 *
 * Every tunable setting lives in this one file. Why? If a number such as "5 failed
 * logins" were typed into three different files, changing it would mean hunting for all
 * three. One file = one place to look.
 *
 * The file simply RETURNS an array. src/bootstrap.php loads it once, and the rest of the
 * app reads values with config('auth.max_attempts') (dots walk down into nested arrays).
 */

$root = dirname(__DIR__);   // the project folder (one level above /config)

return [
    'app' => [
        'timezone' => 'Africa/Nairobi',
        // Debug mode shows error details in API responses. NEVER enable it on a real
        // server: stack traces tell attackers how your code is built.
        // Turn on for local work with:  MWAKI_DEBUG=1 php -S ...
        'debug' => getenv('MWAKI_DEBUG') === '1',
    ],

    'paths' => [
        'root'    => $root,
        'public'  => $root . '/public',
        'storage' => $root . '/storage',
    ],

    'db' => [
        // getenv() reads an ENVIRONMENT VARIABLE. The test script uses this to point at a
        // throw-away database so tests never touch your real data.
        'path' => getenv('MWAKI_DB_PATH') ?: $root . '/storage/mwaki.sqlite',
    ],

    'session' => [
        'name'         => 'mwaki_session',
        'idle_timeout' => 30 * 60,      // seconds of inactivity before we sign you out
    ],

    'auth' => [
        'max_attempts'   => 5,          // failed sign-ins allowed ...
        'window_seconds' => 15 * 60,    // ... within this many seconds
    ],

    'request' => [
        'max_body_bytes' => 64 * 1024,  // refuse JSON bodies bigger than 64 KB
    ],

    // KCSE mean grades from lowest to highest. Phase 2 compares an applicant's grade with
    // a program's minimum by comparing positions in this list.
    'kcse_order' => ['E', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A'],
];
