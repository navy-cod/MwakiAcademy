<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Auth;
use Mwaki\Database;
use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\Validator;

/**
 * Staff accounts: ADMINS ONLY. (Everyone changes their OWN password through POST /api/auth/password.)
 *
 * Safety rules, because an account tool can lock people out:
 *   - an admin cannot delete, demote or reset the password of THEMSELVES here. Because the person acting is always an
 *     admin, that guarantees at least one admin always remains, so the school can never be locked out of this page.
 *   - passwords are stored only as hashes, and no endpoint ever returns one.
 */
final class UserController
{
    /** GET /api/users */
    public static function index(array $params): void
    {
        $me = Auth::requireUser('admin');
        $rows = Database::all('SELECT id, username, role, created_at FROM users ORDER BY role, username COLLATE NOCASE');
        Http::json(200, ['users' => array_map(static fn(array $r): array => self::present($r, (int) $me['id']), $rows)]);
    }

    /** POST /api/users  body: {"username","role","password"} */
    public static function create(array $params): void
    {
        $me = Auth::requireUser('admin');
        [$clean, $errors] = Validator::check(Http::readJson(), [
            'username' => ['required', 'string', 'minlen:3', 'maxlen:50', 'pattern:^[A-Za-z0-9._-]+$'],
            'role'     => ['required', 'in:admin,staff'],
            'password' => ['required', 'string', 'raw', 'minlen:12', 'maxlen:200'],
        ], ['username' => 'Username']);

        // The generic "not in the expected format" message is unhelpful here, so say what IS allowed.
        if (isset($errors['username']) && str_contains($errors['username'], 'expected format')) {
            $errors['username'] = 'Use letters, digits, dots, dashes and underscores only (no spaces).';
        }
        if (!isset($errors['password']) && !isset($errors['username']) && strcasecmp($clean['password'], $clean['username']) === 0) {
            $errors['password'] = 'The password must not be the same as the username.';
        }
        if ($errors !== []) {
            throw self::invalid($errors);
        }

        try {
            $id = Database::insert('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
                [$clean['username'], password_hash($clean['password'], PASSWORD_DEFAULT), $clean['role']]);
        } catch (\PDOException $e) {
            if (str_contains($e->getMessage(), 'users.username')) {
                throw new HttpException(409, 'That username is already taken.', ['username' => 'That username is already taken.'], 'duplicate');
            }
            throw $e;
        }
        Http::json(201, ['user' => self::present(Database::one('SELECT id, username, role, created_at FROM users WHERE id = ?', [$id]), (int) $me['id'])]);
    }

    /** PATCH /api/users/7  body: {"role": "admin"} and/or {"password": "..."} */
    public static function update(array $params): void
    {
        $me = Auth::requireUser('admin');
        $id = (int) $params['id'];

        [$clean, $errors] = Validator::check(Http::readJson(), [
            'role'     => ['in:admin,staff'],
            'password' => ['string', 'raw', 'minlen:12', 'maxlen:200'],
        ]);
        if ($errors !== []) {
            throw self::invalid($errors);
        }
        $role = $clean['role'] ?? null;
        $password = $clean['password'] ?? null;
        if ($role === null && $password === null) {
            throw new HttpException(422, 'Send a new role, a new password, or both.');
        }

        $target = Database::one('SELECT id, username, role, created_at FROM users WHERE id = ?', [$id]);
        if ($target === null) {
            throw new HttpException(404, 'That account does not exist.', [], 'not_found');
        }

        if ($id === (int) $me['id']) {
            if ($role !== null && $role !== $target['role']) {
                throw new HttpException(409, 'You cannot change your own role.', [], 'self');
            }
            if ($password !== null) {
                throw self::invalid(['password' => 'To change your own password use "Change my password" on your Account page.']);
            }
        }
        if ($password !== null && strcasecmp($password, $target['username']) === 0) {
            throw self::invalid(['password' => 'The password must not be the same as the username.']);
        }

        // COALESCE(?, column) means "use the new value if one was sent, otherwise keep what is there".
        Database::execute(
            'UPDATE users SET role = COALESCE(?, role), password_hash = COALESCE(?, password_hash) WHERE id = ?',
            [$role, $password === null ? null : password_hash($password, PASSWORD_DEFAULT), $id]
        );
        // NOTE: if you reset someone's password, a session they already have open stays valid until it times out.
        Http::json(200, ['user' => self::present(Database::one('SELECT id, username, role, created_at FROM users WHERE id = ?', [$id]), (int) $me['id'])]);
    }

    /** DELETE /api/users/7 */
    public static function destroy(array $params): void
    {
        $me = Auth::requireUser('admin');
        $id = (int) $params['id'];
        if ($id === (int) $me['id']) {
            throw new HttpException(409, 'You cannot delete the account you are signed in with.', [], 'self');
        }
        if (Database::execute('DELETE FROM users WHERE id = ?', [$id]) === 0) {
            throw new HttpException(404, 'That account does not exist.', [], 'not_found');
        }
        Http::json(204);
    }

    private static function invalid(array $errors): HttpException
    {
        return new HttpException(422, 'Please correct the highlighted fields.', $errors);
    }

    private static function present(array $row, int $myId): array
    {
        return [
            'id'        => (int) $row['id'],
            'username'  => $row['username'],
            'role'      => $row['role'],
            'createdAt' => str_replace(' ', 'T', $row['created_at']) . 'Z',
            'isYou'     => (int) $row['id'] === $myId,
        ];
    }
}
