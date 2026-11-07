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
use Mwaki\Controllers\AdminController;
use Mwaki\Controllers\ApplicationController;
use Mwaki\Controllers\AuthController;
use Mwaki\Controllers\InquiryController;
use Mwaki\Controllers\ProgramController;
use Mwaki\Controllers\StudentController;
use Mwaki\Controllers\UserController;
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
$router = new Router();
$router->add('GET',  '/api/session',     [AuthController::class,    'session']);
$router->add('POST', '/api/auth/login',  [AuthController::class,    'login']);
$router->add('POST', '/api/auth/logout', [AuthController::class,    'logout']);
$router->add('GET',  '/api/programs',    [ProgramController::class, 'index']);
$router->add('POST', '/api/auth/password', [AuthController::class,    'password']);
$router->add('GET',  '/api/stats',       [StatsController::class,   'index']);

// Public forms (no sign-in needed) ...
$router->add('POST', '/api/applications',        [ApplicationController::class, 'create']);
$router->add('GET',  '/api/applications/status', [ApplicationController::class, 'status']);
$router->add('POST', '/api/inquiries',           [InquiryController::class,     'create']);

// Phase 3: staff-only routes. Each controller method starts with Auth::requireUser(...), so a
// missing sign-in is 401 and a wrong role is 403, whatever the browser does or does not show.
$router->add('GET',    '/api/students',          [StudentController::class, 'index']);
$router->add('POST',   '/api/students',          [StudentController::class, 'create']);
$router->add('GET',    '/api/students/{id}',     [StudentController::class, 'show']);
$router->add('PUT',    '/api/students/{id}',     [StudentController::class, 'update']);
$router->add('DELETE', '/api/students/{id}',     [StudentController::class, 'destroy']);

$router->add('GET',    '/api/applications',      [AdminController::class, 'applications']);
$router->add('PATCH',  '/api/applications/{id}', [AdminController::class, 'updateApplication']);
$router->add('GET',    '/api/inquiries',         [AdminController::class, 'inquiries']);
$router->add('PATCH',  '/api/inquiries/{id}',    [AdminController::class, 'updateInquiry']);

// Admin-only management. Each method starts with Auth::requireUser('admin'): staff get 403.
$router->add('POST',   '/api/programs',          [ProgramController::class, 'create']);
$router->add('PUT',    '/api/programs/{id}',     [ProgramController::class, 'update']);
$router->add('DELETE', '/api/programs/{id}',     [ProgramController::class, 'destroy']);
$router->add('GET',    '/api/users',             [UserController::class,    'index']);
$router->add('POST',   '/api/users',             [UserController::class,    'create']);
$router->add('PATCH',  '/api/users/{id}',        [UserController::class,    'update']);
$router->add('DELETE', '/api/users/{id}',        [UserController::class,    'destroy']);

$router->dispatch($method, Http::path());
