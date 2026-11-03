<?php
declare(strict_types=1);

namespace Mwaki;

use PDO;
use PDOStatement;

/**
 * One shared database connection plus a few short helpers.
 *
 * CONCEPT: PDO ("PHP Data Objects") is PHP's standard way to talk to a database. The same
 * code works for SQLite, MySQL, PostgreSQL ... only the connection string changes.
 *
 * CONCEPT: prepared statements (the most important security habit in this project).
 * Never build SQL by gluing user input into a string:
 *       "SELECT * FROM users WHERE username = '" . $name . "'"      // DANGEROUS
 * If $name is  x' OR '1'='1  the attacker has rewritten your query (SQL injection).
 * Instead write the query with placeholders and pass the values separately:
 *       Database::one('SELECT * FROM users WHERE username = ?', [$name]);
 * The database receives the SQL text and the values on separate channels, so a value
 * can never be mistaken for SQL code.
 */
final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $path = (string) config('db.path');
            if (!is_dir(dirname($path))) {
                mkdir(dirname($path), 0775, true);
            }

            self::$pdo = new PDO('sqlite:' . $path, null, null, [
                // Throw an exception when SQL fails (instead of failing silently).
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                // Rows come back as ['column' => value], easy to read and to JSON-encode.
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Let the DATABASE prepare statements, not PHP, so the separation
                // described above is real and not simulated.
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);

            // SQLite ignores FOREIGN KEY rules unless you switch them on for each connection.
            self::$pdo->exec('PRAGMA foreign_keys = ON');
            // If another request is writing, wait up to 3 s instead of failing at once.
            self::$pdo->exec('PRAGMA busy_timeout = 3000');
        }
        return self::$pdo;
    }

    /** Prepare + execute a query. The other helpers build on this one. */
    public static function run(string $sql, array $params = []): PDOStatement
    {
        $statement = self::pdo()->prepare($sql);
        $statement->execute($params);
        return $statement;
    }

    /** All matching rows. @return list<array<string,mixed>> */
    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    /** The first matching row, or null when nothing matches. */
    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** A single value, e.g. the result of SELECT COUNT(*). */
    public static function scalar(string $sql, array $params = []): mixed
    {
        $value = self::run($sql, $params)->fetchColumn();
        return $value === false ? null : $value;
    }

    /** Run an INSERT/UPDATE/DELETE and return how many rows changed. */
    public static function execute(string $sql, array $params = []): int
    {
        return self::run($sql, $params)->rowCount();
    }

    /** Run an INSERT and return the new row's id. */
    public static function insert(string $sql, array $params = []): int
    {
        self::run($sql, $params);
        return (int) self::pdo()->lastInsertId();
    }

    /**
     * CONCEPT: transaction = "all or nothing". If anything inside throws, every change
     * made inside is undone, so the database is never left half-updated.
     */
    public static function transaction(callable $work): mixed
    {
        $pdo = self::pdo();
        $pdo->beginTransaction();
        try {
            $result = $work();
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}
