<?php
declare(strict_types=1);

namespace Mwaki;

/**
 * CONCEPT: routing. A router answers one question: "for THIS method and THIS path, which
 * PHP function should run?" You register routes like
 *       $router->add('GET', '/api/students/{id}', [StudentController::class, 'show']);
 * and later call dispatch() with the real request.
 *
 * (Note: this class, src/Router.php, handles API URLs. The file router.php at the project
 * root is different: it is only the development server's helper for static files.)
 */
final class Router
{
    /** @var list<array{method:string, regex:string, handler:callable}> */
    private array $routes = [];

    /**
     * {id} in a pattern matches digits only, so /api/students/abc is simply "not found".
     * Patterns are written by us, never by users, so putting them into a regex is safe.
     */
    public function add(string $method, string $pattern, callable $handler): void
    {
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[0-9]+)', $pattern) . '$#';
        $this->routes[] = ['method' => $method, 'regex' => $regex, 'handler' => $handler];
    }

    public function dispatch(string $method, string $path): void
    {
        $path = rtrim($path, '/') ?: '/';     // "/api/programs/" behaves like "/api/programs"
        $pathMatchedMethods = [];

        foreach ($this->routes as $route) {
            if (!preg_match($route['regex'], $path, $matches)) {
                continue;
            }
            if ($route['method'] !== $method) {
                $pathMatchedMethods[] = $route['method'];   // right URL, wrong verb
                continue;
            }
            // $matches also holds numeric keys; keep only the named ones ('id' => '7').
            $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
            ($route['handler'])($params);
            return;
        }

        if ($pathMatchedMethods !== []) {
            // 405 = "that URL exists, but not for this HTTP method". Allow tells the client which do work.
            header('Allow: ' . implode(', ', array_unique($pathMatchedMethods)));
            throw new HttpException(405, 'That action is not allowed on this URL.');
        }
        throw new HttpException(404, 'We could not find what you asked for.');
    }
}
