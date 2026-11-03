<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Auth;
use Mwaki\Database;
use Mwaki\Http;

final class StatsController
{
    /** GET /api/stats - summary numbers for the account page. Staff only. */
    public static function index(array $params): void
    {
        Auth::requireUser('admin', 'staff');

        // CONCEPT: aggregate queries. COUNT() and AVG() let the DATABASE do the arithmetic
        // over thousands of rows and send back one number. Doing this in JavaScript would
        // mean transferring every row first.
        $totals = Database::one('SELECT COUNT(*) AS total, ROUND(AVG(grade), 1) AS average FROM students');

        // CONCEPT: GROUP BY + LEFT JOIN. One result row per program, with its student count.
        // LEFT JOIN keeps programs that have NO students yet (an INNER JOIN would drop them).
        $byProgram = Database::all(
            'SELECT p.name AS program, COUNT(s.id) AS students, ROUND(AVG(s.grade), 1) AS average
               FROM programs p
          LEFT JOIN students s ON s.program_id = p.id
           GROUP BY p.id
           ORDER BY students DESC, p.name'
        );

        $applications = ['pending' => 0, 'approved' => 0, 'rejected' => 0];
        foreach (Database::all('SELECT status, COUNT(*) AS n FROM applications GROUP BY status') as $row) {
            $applications[$row['status']] = (int) $row['n'];
        }

        Http::json(200, [
            'students' => [
                'total'        => (int) $totals['total'],
                'averageGrade' => $totals['average'] === null ? null : (float) $totals['average'],
                'byProgram'    => array_map(static fn(array $r): array => [
                    'program'      => $r['program'],
                    'students'     => (int) $r['students'],
                    'averageGrade' => $r['average'] === null ? null : (float) $r['average'],
                ], $byProgram),
            ],
            'applications' => $applications,
            'inquiries'    => [
                'unhandled' => (int) Database::scalar('SELECT COUNT(*) FROM inquiries WHERE handled = 0'),
            ],
        ]);
    }
}
