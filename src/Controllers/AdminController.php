<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Auth;
use Mwaki\Database;
use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\Validator;

/**
 * The staff side of the public forms: review admission applications and handle contact messages.
 * Every method starts with Auth::requireUser(), so nothing here is reachable without signing in.
 */
final class AdminController
{
    private const APPLICATION_SELECT =
        'SELECT a.id, a.reference, a.full_name, a.email, a.phone, a.gender, a.dob, a.address, a.kcse_grade,
                a.intake_year, a.intake_period, a.motivation, a.how_heard, a.status, a.created_at,
                p.name AS program, p.faculty
           FROM applications a JOIN programs p ON p.id = a.program_id';

    // ------------------------------------------------------------------ applications

    /** GET /api/applications?status=pending&q=amina&page=1&perPage=10 */
    public static function applications(array $params): void
    {
        Auth::requireUser('admin', 'staff');

        [$query, $errors] = Validator::check($_GET, [
            'status'  => ['in:pending,approved,rejected'],
            'q'       => ['string', 'maxlen:100'],
            'page'    => ['int', 'between:1,100000'],
            'perPage' => ['int', 'between:1,50'],
        ]);
        if ($errors !== []) {
            throw new HttpException(422, 'Those filter options are not valid.', $errors);
        }

        $conditions = [];
        $values = [];
        if (($query['status'] ?? null) !== null) {
            $conditions[] = 'a.status = :status';
            $values[':status'] = $query['status'];
        }
        $search = (string) ($query['q'] ?? '');
        if ($search !== '') {
            $values[':q'] = '%' . addcslashes($search, '%_\\') . '%';
            $conditions[] = "(a.reference LIKE :q ESCAPE '\\' OR a.full_name LIKE :q ESCAPE '\\' OR a.email LIKE :q ESCAPE '\\')";
        }
        $where = $conditions === [] ? '' : ' WHERE ' . implode(' AND ', $conditions);

        $perPage = $query['perPage'] ?? 10;
        $total   = (int) Database::scalar('SELECT COUNT(*) FROM applications a' . $where, $values);
        $pages   = max(1, (int) ceil($total / $perPage));
        $page    = min($query['page'] ?? 1, $pages);

        $rows = Database::all(
            self::APPLICATION_SELECT . $where . ' ORDER BY a.created_at DESC, a.id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) (($page - 1) * $perPage),
            $values
        );

        $counts = ['pending' => 0, 'approved' => 0, 'rejected' => 0];
        foreach (Database::all('SELECT status, COUNT(*) AS n FROM applications GROUP BY status') as $r) {
            $counts[$r['status']] = (int) $r['n'];
        }

        Http::json(200, [
            'applications' => array_map([self::class, 'presentApplication'], $rows),
            'meta'         => ['total' => $total, 'page' => $page, 'perPage' => $perPage, 'pages' => $pages],
            'counts'       => $counts,
        ]);
    }

    /**
     * PATCH /api/applications/7  body: {"status": "approved"}
     *
     * CONCEPT: PUT vs PATCH. PUT replaces a whole record; PATCH changes only the fields you send.
     * Reviewing an application changes one field (its status), so PATCH is the honest verb.
     */
    public static function updateApplication(array $params): void
    {
        $user = Auth::requireUser('admin', 'staff');
        [$clean, $errors] = Validator::check(Http::readJson(), ['status' => ['required', 'in:pending,approved,rejected']]);
        if ($errors !== []) {
            throw new HttpException(422, 'Please choose a valid status.', $errors);
        }

        $id = (int) $params['id'];
        $changed = Database::execute('UPDATE applications SET status = ? WHERE id = ?', [$clean['status'], $id]);
        if ($changed === 0) {
            throw new HttpException(404, 'That application does not exist.', [], 'not_found');
        }
        // A one-line audit trail in the server log: who changed what. (A real system would keep this in a table.)
        error_log(sprintf('[mwaki] application %d set to %s by %s', $id, $clean['status'], $user['username']));

        Http::json(200, ['application' => self::presentApplication(
            Database::one(self::APPLICATION_SELECT . ' WHERE a.id = ?', [$id])
        )]);
    }

    // ------------------------------------------------------------------ contact messages

    /** GET /api/inquiries?handled=0&page=1&perPage=10   (handled omitted = everything) */
    public static function inquiries(array $params): void
    {
        Auth::requireUser('admin', 'staff');

        [$query, $errors] = Validator::check($_GET, [
            'handled' => ['in:0,1'],
            'page'    => ['int', 'between:1,100000'],
            'perPage' => ['int', 'between:1,50'],
        ]);
        if ($errors !== []) {
            throw new HttpException(422, 'Those filter options are not valid.', $errors);
        }

        $where = '';
        $values = [];
        if (($query['handled'] ?? null) !== null) {
            $where = ' WHERE handled = :handled';
            $values[':handled'] = (int) $query['handled'];
        }

        $perPage = $query['perPage'] ?? 10;
        $total   = (int) Database::scalar('SELECT COUNT(*) FROM inquiries' . $where, $values);
        $pages   = max(1, (int) ceil($total / $perPage));
        $page    = min($query['page'] ?? 1, $pages);

        $rows = Database::all(
            'SELECT id, name, email, phone, message, handled, created_at FROM inquiries' . $where
            . ' ORDER BY created_at DESC, id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) (($page - 1) * $perPage),
            $values
        );
        $counts = Database::one('SELECT SUM(handled = 0) AS fresh, SUM(handled = 1) AS done FROM inquiries');

        Http::json(200, [
            'inquiries' => array_map(static fn(array $r): array => [
                'id'         => (int) $r['id'],
                'name'       => $r['name'],
                'email'      => $r['email'],
                'phone'      => $r['phone'],
                'message'    => $r['message'],
                'handled'    => (bool) $r['handled'],
                'receivedAt' => str_replace(' ', 'T', $r['created_at']) . 'Z',
            ], $rows),
            'meta'   => ['total' => $total, 'page' => $page, 'perPage' => $perPage, 'pages' => $pages],
            'counts' => ['new' => (int) ($counts['fresh'] ?? 0), 'handled' => (int) ($counts['done'] ?? 0)],
        ]);
    }

    /** PATCH /api/inquiries/7  body: {"handled": true} */
    public static function updateInquiry(array $params): void
    {
        Auth::requireUser('admin', 'staff');
        [$clean, $errors] = Validator::check(Http::readJson(), ['handled' => ['required', 'bool']]);
        if ($errors !== []) {
            throw new HttpException(422, 'Please say whether the message is handled.', $errors);
        }

        $changed = Database::execute('UPDATE inquiries SET handled = ? WHERE id = ?', [$clean['handled'] ? 1 : 0, (int) $params['id']]);
        if ($changed === 0) {
            throw new HttpException(404, 'That message does not exist.', [], 'not_found');
        }
        Http::json(200, ['ok' => true, 'handled' => $clean['handled']]);
    }

    // ------------------------------------------------------------------ helpers

    private static function presentApplication(array $r): array
    {
        return [
            'id'           => (int) $r['id'],
            'reference'    => $r['reference'],
            'fullName'     => $r['full_name'],
            'email'        => $r['email'],
            'phone'        => $r['phone'],
            'gender'       => $r['gender'],
            'dob'          => $r['dob'],
            'address'      => $r['address'],
            'program'      => $r['program'],
            'faculty'      => $r['faculty'],
            'kcseGrade'    => $r['kcse_grade'],
            'intakeYear'   => (int) $r['intake_year'],
            'intakePeriod' => $r['intake_period'],
            'motivation'   => $r['motivation'],
            'howHeard'     => $r['how_heard'],
            'status'       => $r['status'],
            'submittedAt'  => str_replace(' ', 'T', $r['created_at']) . 'Z',
        ];
    }
}
