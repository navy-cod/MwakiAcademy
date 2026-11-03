<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Database;
use Mwaki\Http;

final class ProgramController
{
    /**
     * GET /api/programs - the catalogue of degree programs.
     *
     * One endpoint feeds the admission form, the student form and the tuition table, so a
     * program is defined in exactly ONE place (the database). Change it there and every
     * page updates. That idea is called a "single source of truth".
     */
    public static function index(array $params): void
    {
        $rows = Database::all(
            'SELECT id, name, faculty, annual_tuition_kes, additional_fees_kes, min_kcse, intakes
               FROM programs
              ORDER BY faculty, name'
        );

        // The database uses snake_case column names; JavaScript convention is camelCase.
        // This is the place where we translate, so the front end never sees raw column names.
        $programs = array_map(static fn(array $row): array => [
            'id'                => (int) $row['id'],
            'name'              => $row['name'],
            'faculty'           => $row['faculty'],
            'annualTuitionKes'  => $row['annual_tuition_kes'] === null ? null : (int) $row['annual_tuition_kes'],
            'additionalFeesKes' => $row['additional_fees_kes'] === null ? null : (int) $row['additional_fees_kes'],
            'minKcse'           => $row['min_kcse'],
            'intakes'           => explode(',', $row['intakes']),
        ], $rows);

        // Computed on the server so the list never goes stale (no hard-coded years in HTML).
        $thisYear = (int) date('Y');

        Http::json(200, [
            'programs'    => $programs,
            'intakeYears' => range($thisYear, $thisYear + 2),
        ]);
    }
}
