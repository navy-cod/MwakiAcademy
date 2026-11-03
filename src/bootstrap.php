<?php
declare(strict_types=1);

/*
 * src/bootstrap.php
 *
 * "Bootstrapping" = the setup that must happen before any real work. Both router.php
 * (the dev-server entry) and public/api/index.php (the API entry) load this file first,
 * so the setup is written once.
 *
 * `declare(strict_types=1)` at the top of every PHP file makes PHP refuse to silently
 * convert types (for example, passing the string "5" where an int is required). Catching
 * those mistakes early is why we use it.
 */

// ---------------------------------------------------------------- 1. Autoloading
// CONCEPT: autoloading. Instead of writing `require 'src/Http.php';` at the top of every
// file, we tell PHP: "when code mentions a class you don't know yet, call this function
// and I will load the file for you." The rule we use: the class Mwaki\Controllers\X lives
// in src/Controllers/X.php. (Frameworks do the same thing through Composer.)
spl_autoload_register(static function (string $class): void {
    $prefix = 'Mwaki\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;                                   // not one of our classes
    }
    $relative = substr($class, strlen($prefix));  // e.g. "Controllers\AuthController"
    $file = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

// ---------------------------------------------------------------- 2. config() helper
/**
 * Read a setting using dot notation:  config('auth.max_attempts')  or  config('app.debug').
 * The `static` variable keeps the loaded array between calls, so the file is read once.
 */
function config(string $key, mixed $default = null): mixed
{
    static $config = null;
    $config ??= require dirname(__DIR__) . '/config/config.php';

    $value = $config;
    foreach (explode('.', $key) as $part) {
        if (!is_array($value) || !array_key_exists($part, $value)) {
            return $default;
        }
        $value = $value[$part];
    }
    return $value;
}

// ---------------------------------------------------------------- 3. Environment
date_default_timezone_set((string) config('app.timezone'));

// SECURITY: never print PHP errors into a web response. They can reveal file paths and
// code. Instead we LOG them (to the terminal running `php -S`) and show users a generic
// message.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

// PHP's old-style warnings ("Undefined array key ...") are easy to miss. Converting them
// into exceptions makes every problem follow ONE path: the exception handler below.
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;                             // this error type is switched off
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// Any exception nobody catches ends up here, so users never see a raw PHP crash.
set_exception_handler(static function (Throwable $e): void {
    Mwaki\Http::handleException($e);
});
