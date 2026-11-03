<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Auth;
use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\Validator;

/**
 * CONCEPT: a "controller" is the code that handles one kind of request: read the input,
 * validate it, do the work, send a response. Each public method here is the handler for
 * one route registered in public/api/index.php.
 */
final class AuthController
{
    /** GET /api/session - "who am I, and what is my CSRF token?" The page calls this on load. */
    public static function session(array $params): void
    {
        Http::json(200, [
            'user'      => Auth::publicUser(Auth::user()),
            'csrfToken' => Auth::csrfToken(),
        ]);
    }

    /** POST /api/auth/login  body: {"username": "...", "password": "..."} */
    public static function login(array $params): void
    {
        $body = Http::readJson();

        [$clean, $errors] = Validator::check($body, [
            'username' => ['required', 'string', 'maxlen:50'],
            // 'raw' = do not trim. maxlen:200 stops someone sending a 10 MB "password" to
            // waste CPU (PHP's bcrypt only uses the first 72 bytes anyway).
            'password' => ['required', 'string', 'raw', 'maxlen:200'],
        ]);
        if ($errors !== []) {
            throw new HttpException(422, 'Please enter your username and password.', $errors);
        }

        $user = Auth::attempt($clean['username'], $clean['password']);

        // Return the NEW CSRF token: the session was regenerated during sign-in.
        Http::json(200, ['user' => $user, 'csrfToken' => Auth::csrfToken()]);
    }

    /** POST /api/auth/logout */
    public static function logout(array $params): void
    {
        Auth::logout();
        Http::json(200, ['ok' => true]);
    }
}
