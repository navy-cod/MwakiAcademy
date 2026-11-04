<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Database;
use Mwaki\Http;
use Mwaki\Intakes;

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
        $programs = array_map(static function (array $row): array {
            $periods = explode(',', $row['intakes']);
            return [
                'id'                => (int) $row['id'],
                'name'              => $row['name'],
                'faculty'           => $row['faculty'],
                'annualTuitionKes'  => $row['annual_tuition_kes'] === null ? null : (int) $row['annual_tuition_kes'],
                'additionalFeesKes' => $row['additional_fees_kes'] === null ? null : (int) $row['additional_fees_kes'],
                'minKcse'           => $row['min_kcse'],
                'intakes'           => $periods,
                // Phase 2: only intakes that have not started yet, calculated from today's date.
                'upcomingIntakes'   => Intakes::upcoming($periods),
            ];
        }, $rows);

        Http::json(200, ['programs' => $programs]);
    }
}
