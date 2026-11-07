<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Auth;
use Mwaki\Database;
use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\Intakes;
use Mwaki\Validator;

final class ProgramController
{
    private const SELECT = 'SELECT id, name, faculty, annual_tuition_kes, additional_fees_kes, min_kcse, intakes FROM programs';

    /**
     * GET /api/programs - the catalogue of degree programs (public).
     *
     * One endpoint feeds the admission form, the student form and the tuition table, so a
     * program is defined in exactly ONE place (the database). Change it there and every
     * page updates. That idea is called a "single source of truth".
     */
    public static function index(array $params): void
    {
        $rows = Database::all(self::SELECT . ' ORDER BY faculty, name');
        Http::json(200, ['programs' => array_map([self::class, 'present'], $rows)]);
    }

    /** POST /api/programs - ADMINS ONLY: add a program to the catalogue. */
    public static function create(array $params): void
    {
        Auth::requireUser('admin');
        $clean = self::validated(Http::readJson());

        try {
            $id = Database::insert(
                'INSERT INTO programs (name, faculty, annual_tuition_kes, additional_fees_kes, min_kcse, intakes) VALUES (?, ?, ?, ?, ?, ?)',
                self::columnValues($clean)
            );
        } catch (\PDOException $e) {
            self::throwIfDuplicateName($e);
        }
        Http::json(201, ['program' => self::findOr404($id)]);
    }

    /** PUT /api/programs/7 - ADMINS ONLY: replace a program's details. Students and applications keep pointing at it by id. */
    public static function update(array $params): void
    {
        Auth::requireUser('admin');
        $id = (int) $params['id'];
        self::findOr404($id);
        $clean = self::validated(Http::readJson());

        try {
            Database::execute(
                'UPDATE programs SET name = ?, faculty = ?, annual_tuition_kes = ?, additional_fees_kes = ?, min_kcse = ?, intakes = ? WHERE id = ?',
                [...self::columnValues($clean), $id]
            );
        } catch (\PDOException $e) {
            self::throwIfDuplicateName($e);
        }
        Http::json(200, ['program' => self::findOr404($id)]);
    }

    /**
     * DELETE /api/programs/7 - ADMINS ONLY.
     *
     * CONCEPT: referential integrity. Students and applications point at a program (a FOREIGN KEY). Deleting the
     * program would leave them pointing at nothing, so the database REFUSES (ON DELETE RESTRICT). We check first so we
     * can explain WHY, with numbers; the database rule is still the safety net behind our check. History must stay
     * intact: a program anyone has ever applied to cannot be deleted, only edited.
     */
    public static function destroy(array $params): void
    {
        Auth::requireUser('admin');
        $id = (int) $params['id'];
        $program = self::findOr404($id);

        $students     = (int) Database::scalar('SELECT COUNT(*) FROM students WHERE program_id = ?', [$id]);
        $applications = (int) Database::scalar('SELECT COUNT(*) FROM applications WHERE program_id = ?', [$id]);
        if ($students > 0 || $applications > 0) {
            throw self::inUse($program['name'], $students, $applications);
        }

        try {
            Database::execute('DELETE FROM programs WHERE id = ?', [$id]);
        } catch (\PDOException $e) {
            if (str_contains($e->getMessage(), 'FOREIGN KEY')) {          // someone added a student a moment ago
                throw self::inUse($program['name'], 0, 0);
            }
            throw $e;
        }
        Http::json(204);
    }

    // ------------------------------------------------------------------ helpers

    private static function validated(array $body): array
    {
        [$clean, $errors] = Validator::check($body, [
            'name'              => ['required', 'string', 'minlen:3', 'maxlen:100'],
            'faculty'           => ['required', 'string', 'minlen:2', 'maxlen:80'],
            'annualTuitionKes'  => ['int', 'between:0,100000000'],
            'additionalFeesKes' => ['int', 'between:0,100000000'],
            'minKcse'           => ['required', 'in:' . implode(',', (array) config('kcse_order'))],
        ], ['name' => 'Program name', 'annualTuitionKes' => 'Annual tuition', 'additionalFeesKes' => 'Additional fees', 'minKcse' => 'Minimum KCSE grade']);

        // Tuition and fees are shown side by side on the tuition page, so give both or neither.
        $hasTuition = ($clean['annualTuitionKes'] ?? null) !== null;
        $hasFees    = ($clean['additionalFeesKes'] ?? null) !== null;
        if ($hasTuition && !$hasFees && !isset($errors['additionalFeesKes'])) {
            $errors['additionalFeesKes'] = 'Enter the additional fees as well (0 if there are none).';
        }
        if ($hasFees && !$hasTuition && !isset($errors['annualTuitionKes'])) {
            $errors['annualTuitionKes'] = 'Enter the annual tuition as well, or clear the additional fees.';
        }

        // "intakes" is a LIST, which the simple Validator does not handle, so it is checked by hand.
        $months = array_keys((array) config('intake_months'));        // January, March, May, September (chronological)
        $intakes = $body['intakes'] ?? null;
        if (!is_array($intakes) || !array_is_list($intakes) || $intakes === []) {
            $errors['intakes'] = 'Choose at least one intake month.';
        } elseif (array_filter($intakes, static fn($m): bool => !is_string($m) || !in_array($m, $months, true)) !== []) {
            $errors['intakes'] = 'Intakes must be chosen from: ' . implode(', ', $months) . '.';
        } else {
            $clean['intakes'] = array_values(array_intersect($months, $intakes));   // de-duplicated, in calendar order
        }

        if ($errors !== []) {
            throw new HttpException(422, 'Please correct the highlighted fields.', $errors);
        }
        return $clean;
    }

    private static function columnValues(array $c): array
    {
        return [$c['name'], $c['faculty'], $c['annualTuitionKes'], $c['additionalFeesKes'], $c['minKcse'], implode(',', $c['intakes'])];
    }

    private static function throwIfDuplicateName(\PDOException $e): never
    {
        if (str_contains($e->getMessage(), 'programs.name')) {
            throw new HttpException(409, 'A program with that name already exists.', ['name' => 'A program with that name already exists.'], 'duplicate');
        }
        throw $e;
    }

    private static function inUse(string $name, int $students, int $applications): HttpException
    {
        $parts = [];
        if ($students > 0)     $parts[] = $students . ' student' . ($students === 1 ? '' : 's');
        if ($applications > 0) $parts[] = $applications . ' application' . ($applications === 1 ? '' : 's');
        $by = $parts === [] ? 'other records' : implode(' and ', $parts);
        return new HttpException(409, "\"$name\" cannot be deleted because it is used by $by. You can edit it instead.", [], 'in_use');
    }

    private static function findOr404(int $id): array
    {
        $row = Database::one(self::SELECT . ' WHERE id = ?', [$id]);
        if ($row === null) {
            throw new HttpException(404, 'That program does not exist.', [], 'not_found');
        }
        return self::present($row);
    }

    /** Database row -> JSON. The database uses snake_case; JavaScript convention is camelCase, so we translate here. */
    private static function present(array $row): array
    {
        $periods = explode(',', $row['intakes']);
        return [
            'id'                => (int) $row['id'],
            'name'              => $row['name'],
            'faculty'           => $row['faculty'],
            'annualTuitionKes'  => $row['annual_tuition_kes'] === null ? null : (int) $row['annual_tuition_kes'],
            'additionalFeesKes' => $row['additional_fees_kes'] === null ? null : (int) $row['additional_fees_kes'],
            'minKcse'           => $row['min_kcse'],
            'intakes'           => $periods,
            // Only intakes that have not started yet, calculated from today's date.
            'upcomingIntakes'   => Intakes::upcoming($periods),
        ];
    }
}
