<?php
declare(strict_types=1);

/*
 * public/api/index.php  -  the FRONT CONTROLLER.
 *
 * CONCEPT: front controller pattern. Instead of one PHP file per URL, ALL /api/... requests
 * are sent to this single file. It does the shared work (security headers, session, CSRF
 * check) once, and then asks the Router which controller method should answer.
 * router.php (dev server) does the "send /api/* here" step.
 */

use Mwaki\Auth;
use Mwaki\Controllers\AuthController;
use Mwaki\Controllers\ProgramController;
use Mwaki\Controllers\StatsController;
use Mwaki\Http;
use Mwaki\Router;

// Two levels up from /public/api is the project root, where /src lives. Keeping src/ OUTSIDE
// /public means the web server can never serve our PHP source files by accident.
//
// require_once (not require): under the dev server, router.php has ALREADY loaded the
// bootstrap before handing the request to this file. Loading it twice would redeclare
// config() and crash. require_once means "load this file only if it has not been loaded yet".
require_once dirname(__DIR__, 2) . '/src/bootstrap.php';

Http::securityHeaders();
header('Cache-Control: no-store');      // API answers are personal and change often: never cache them

Auth::start();

// CSRF check for every request that CHANGES something. GET requests only read data, so
// they are exempt (which is also why you must never change data in response to a GET).
$method = Http::method();
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
    Auth::verifyCsrf();
}

// The route table: METHOD + URL pattern -> [controller class, method name].
// Phases 2 and 3 add more lines here.
$router = new Router();
$router->add('GET',  '/api/session',     [AuthController::class,    'session']);
$router->add('POST', '/api/auth/login',  [AuthController::class,    'login']);
$router->add('POST', '/api/auth/logout', [AuthController::class,    'logout']);
$router->add('GET',  '/api/programs',    [ProgramController::class, 'index']);
$router->add('GET',  '/api/stats',       [StatsController::class,   'index']);

$router->dispatch($method, Http::path());
