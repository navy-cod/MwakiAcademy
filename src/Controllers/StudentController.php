<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Auth;
use Mwaki\Database;
use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\Validator;

/**
 * CONCEPT: REST. One URL names a THING ("a student"), and the HTTP VERB says what to do with it:
 *     GET    /api/students        list them                    (safe: changes nothing)
 *     POST   /api/students        create one                   (not idempotent: twice = two students)
 *     GET    /api/students/7      read one
 *     PUT    /api/students/7      replace one                  (idempotent: twice = same result)
 *     DELETE /api/students/7      remove one                   (idempotent: already gone is still "gone")
 * "Idempotent" = repeating the identical request leaves the system in the same state as doing it once,
 * which makes retrying after a network hiccup safe.
 */
final class StudentController
{
    private const MIN_AGE = 15;

    /**
     * SECURITY: SQL placeholders (?) can hold VALUES but not column names, so a sort order from the URL
     * cannot be passed as a parameter. If we pasted it into the query ("ORDER BY " . $_GET['sort']) an attacker
     * could inject SQL. Instead the URL carries only a short KEY, and we look up the SQL ourselves.
     * Anything not in this list is refused before the query is built.
     */
    private const SORTS = [
        'name'      => 's.first_name COLLATE NOCASE ASC,  s.last_name COLLATE NOCASE ASC,  s.id ASC',
        'nameDesc'  => 's.first_name COLLATE NOCASE DESC, s.last_name COLLATE NOCASE DESC, s.id ASC',
        'grade'     => 's.grade ASC,  s.first_name COLLATE NOCASE ASC, s.id ASC',
        'gradeDesc' => 's.grade DESC, s.first_name COLLATE NOCASE ASC, s.id ASC',
        'age'       => 's.dob DESC, s.id ASC',          // youngest first = most recent birth date first
        'ageDesc'   => 's.dob ASC,  s.id ASC',
    ];

    private const SELECT = 'SELECT s.*, p.name AS program FROM students s JOIN programs p ON p.id = s.program_id';

    /** GET /api/students?q=grace&sort=gradeDesc&page=2&perPage=5 */
    public static function index(array $params): void
    {
        Auth::requireUser('admin', 'staff');

        [$query, $errors] = Validator::check($_GET, [
            'q'       => ['string', 'maxlen:100'],
            'sort'    => ['in:' . implode(',', array_keys(self::SORTS))],
            'page'    => ['int', 'between:1,100000'],
            'perPage' => ['int', 'between:1,50'],
        ]);
        if ($errors !== []) {
            throw new HttpException(422, 'Those search options are not valid.', $errors);
        }
        $search  = (string) ($query['q'] ?? '');
        $sort    = $query['sort'] ?? 'name';
        $perPage = $query['perPage'] ?? 5;
        $page    = $query['page'] ?? 1;

        // ---- search ---------------------------------------------------------------------------
        $where  = '';
        $values = [];
        if ($search !== '') {
            // In SQL's LIKE, % means "any characters" and _ means "any one character". If a visitor types
            // "%" or "_" they would match everything. addcslashes() puts a backslash in front of them so
            // they count as ordinary characters, and ESCAPE '\' tells SQLite that the backslash is our escape.
            $values[':q'] = '%' . addcslashes($search, '%_\\') . '%';
            $where = " WHERE (s.first_name LIKE :q ESCAPE '\\'
                          OR s.last_name  LIKE :q ESCAPE '\\'
                          OR (s.first_name || ' ' || s.last_name) LIKE :q ESCAPE '\\'
                          OR s.email      LIKE :q ESCAPE '\\'
                          OR s.student_code LIKE :q ESCAPE '\\')";
        }

        // ---- pagination -----------------------------------------------------------------------
        // CONCEPT: pagination. Send one "page" of rows at a time, not the whole table.
        $total = (int) Database::scalar('SELECT COUNT(*) FROM students s' . $where, $values);
        $pages = max(1, (int) ceil($total / $perPage));
        $page  = min($page, $pages);                 // asking for page 99 of 2 simply gives the last page
        $offset = ($page - 1) * $perPage;

        // LIMIT/OFFSET are pasted in as integers. That is safe ONLY because $perPage and $offset were
        // validated as numbers above and are cast to int here; they can never contain SQL text.
        $rows = Database::all(
            self::SELECT . $where . ' ORDER BY ' . self::SORTS[$sort] . ' LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset,
            $values
        );

        // Header numbers for the whole school (not just this search).
        $all = Database::one('SELECT COUNT(*) AS total, ROUND(AVG(grade), 1) AS average FROM students');

        Http::json(200, [
            'students' => array_map([self::class, 'present'], $rows),
            'meta'     => ['total' => $total, 'page' => $page, 'perPage' => $perPage, 'pages' => $pages],
            'stats'    => [
                'total'        => (int) $all['total'],
                'averageGrade' => $all['average'] === null ? null : (float) $all['average'],
            ],
        ]);
    }

    /** GET /api/students/7 */
    public static function show(array $params): void
    {
        Auth::requireUser('admin', 'staff');
        Http::json(200, ['student' => self::findOr404((int) $params['id'])]);
    }

    /** POST /api/students */
    public static function create(array $params): void
    {
        Auth::requireUser('admin', 'staff');
        $clean = self::validated(Http::readJson());

        try {
            $id = Database::insert(
                'INSERT INTO students (student_code, first_name, last_name, email, phone, grade, program_id, address, dob, image_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                self::columnValues($clean)
            );
        } catch (\PDOException $e) {
            self::throwIfDuplicate($e);
        }

        Http::json(201, ['student' => self::findOr404($id)]);
    }

    /** PUT /api/students/7 - replaces all editable fields, so the body must be complete */
    public static function update(array $params): void
    {
        Auth::requireUser('admin', 'staff');
        $id = (int) $params['id'];
        self::findOr404($id);                                 // 404 first, before any validation work
        $clean = self::validated(Http::readJson());

        try {
            Database::execute(
                "UPDATE students SET student_code = ?, first_name = ?, last_name = ?, email = ?, phone = ?, grade = ?,
                        program_id = ?, address = ?, dob = ?, image_url = ?, updated_at = datetime('now')
                  WHERE id = ?",
                [...self::columnValues($clean), $id]
            );
        } catch (\PDOException $e) {
            self::throwIfDuplicate($e);
        }

        Http::json(200, ['student' => self::findOr404($id)]);
    }

    /**
     * DELETE /api/students/7 - ADMINS ONLY.
     * CONCEPT: authorization (what you may do) is separate from authentication (who you are).
     * Staff can add and edit students but only admins can delete them. The page hides the Delete
     * button from staff as a courtesy, but THIS line is what actually enforces it.
     */
    public static function destroy(array $params): void
    {
        Auth::requireUser('admin');

        $deleted = Database::execute('DELETE FROM students WHERE id = ?', [(int) $params['id']]);
        if ($deleted === 0) {
            throw new HttpException(404, 'That student no longer exists.', [], 'not_found');
        }
        Http::json(204);                                      // 204 No Content: success, nothing to send back
    }

    // ------------------------------------------------------------------ helpers

    /** Validate a create/update body. Returns clean values; throws 422 with per-field messages. */
    private static function validated(array $body): array
    {
        if (isset($body['studentCode']) && is_string($body['studentCode'])) {
            $body['studentCode'] = strtoupper(trim($body['studentCode']));   // "mu-2026-011" -> "MU-2026-011"
        }

        [$clean, $errors] = Validator::check($body, [
            'studentCode' => ['required', 'string', 'pattern:^MU-\d{4}-\d{3,4}$'],
            'firstName'   => ['required', 'string', 'minlen:2', 'maxlen:50'],
            'lastName'    => ['required', 'string', 'minlen:2', 'maxlen:50'],
            'email'       => ['required', 'email', 'maxlen:120'],
            'phone'       => ['required', 'phone'],
            'grade'       => ['required', 'number', 'between:0,100'],
            'programId'   => ['required', 'int'],
            'address'     => ['required', 'string', 'minlen:3', 'maxlen:200'],
            'dob'         => ['required', 'pastdate'],
            // https only: a "javascript:" or "data:" address in an image/link could run code, and the
            // strict Content-Security-Policy only allows https images anyway.
            'imageUrl'    => ['https_url', 'maxlen:300'],
        ], ['studentCode' => 'Student ID', 'firstName' => 'First name', 'lastName' => 'Last name',
            'programId' => 'Course', 'dob' => 'Date of birth', 'imageUrl' => 'Image address']);

        if (!isset($errors['programId'])
            && Database::scalar('SELECT 1 FROM programs WHERE id = ?', [$clean['programId']]) === null) {
            $errors['programId'] = 'Please choose a course from the list.';
        }
        if (!isset($errors['dob'])) {
            $age = (new \DateTimeImmutable($clean['dob']))->diff(new \DateTimeImmutable('today'))->y;
            if ($age < self::MIN_AGE || $age > 100) {
                $errors['dob'] = 'Students must be at least ' . self::MIN_AGE . ' years old. Please check the date.';
            }
        }
        if ($errors !== []) {
            throw new HttpException(422, 'Please correct the highlighted fields.', $errors);
        }
        return $clean;
    }

    /** The values, in the same order as the INSERT/UPDATE column lists above. */
    private static function columnValues(array $c): array
    {
        return [$c['studentCode'], $c['firstName'], $c['lastName'], strtolower($c['email']), $c['phone'],
                $c['grade'], $c['programId'], $c['address'], $c['dob'], $c['imageUrl']];
    }

    /**
     * The database itself guarantees uniqueness (UNIQUE columns), which is race-proof: two people
     * saving the same email at the same instant cannot both win. We catch the failure and turn it into
     * a friendly 409 Conflict that points at the offending field.
     */
    private static function throwIfDuplicate(\PDOException $e): never
    {
        $errors = [];
        if (str_contains($e->getMessage(), 'students.student_code')) {
            $errors['studentCode'] = 'That student ID is already in use.';
        } elseif (str_contains($e->getMessage(), 'students.email')) {
            $errors['email'] = 'That email address already belongs to another student.';
        }
        if ($errors === []) {
            throw $e;                                        // some other database problem: let it become a 500
        }
        throw new HttpException(409, 'That student cannot be saved because it clashes with an existing one.', $errors, 'duplicate');
    }

    private static function findOr404(int $id): array
    {
        $row = Database::one(self::SELECT . ' WHERE s.id = ?', [$id]);
        if ($row === null) {
            throw new HttpException(404, 'That student does not exist.', [], 'not_found');
        }
        return self::present($row);
    }

    /** Database row -> the JSON the browser receives. Age is CALCULATED here, never stored. */
    private static function present(array $r): array
    {
        return [
            'id'          => (int) $r['id'],
            'studentCode' => $r['student_code'],
            'firstName'   => $r['first_name'],
            'lastName'    => $r['last_name'],
            'email'       => $r['email'],
            'phone'       => $r['phone'],
            'grade'       => (float) $r['grade'],
            'programId'   => (int) $r['program_id'],
            'program'     => $r['program'],
            'address'     => $r['address'],
            'dob'         => $r['dob'],
            'age'         => (new \DateTimeImmutable($r['dob']))->diff(new \DateTimeImmutable('today'))->y,
            'imageUrl'    => $r['image_url'],
            'createdAt'   => str_replace(' ', 'T', $r['created_at']) . 'Z',
            'updatedAt'   => str_replace(' ', 'T', $r['updated_at']) . 'Z',
        ];
    }
}
