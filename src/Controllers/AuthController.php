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

    /** POST /api/auth/password  body: {"currentPassword": "...", "newPassword": "..."}  (any signed-in user) */
    public static function password(array $params): void
    {
        $user = Auth::requireUser();
        [$clean, $errors] = Validator::check(Http::readJson(), [
            // 'raw' = never trim: a password with a trailing space is a different password.
            'currentPassword' => ['required', 'string', 'raw', 'maxlen:200'],
            'newPassword'     => ['required', 'string', 'raw', 'minlen:12', 'maxlen:200'],
        ], ['currentPassword' => 'Your current password', 'newPassword' => 'The new password']);

        if (!isset($errors['newPassword'])) {
            if ($clean['newPassword'] === $clean['currentPassword']) {
                $errors['newPassword'] = 'The new password must be different from the current one.';
            } elseif (strcasecmp($clean['newPassword'], $user['username']) === 0) {
                $errors['newPassword'] = 'The password must not be your username.';
            }
        }
        if ($errors !== []) {
            throw new HttpException(422, 'Please correct the highlighted fields.', $errors);
        }

        Auth::changePassword($user, $clean['currentPassword'], $clean['newPassword']);

        // The session was regenerated, so the browser needs the NEW CSRF token.
        Http::json(200, ['ok' => true, 'csrfToken' => Auth::csrfToken()]);
    }

    /** POST /api/auth/logout */
    public static function logout(array $params): void
    {
        Auth::logout();
        Http::json(200, ['ok' => true]);
    }
}
