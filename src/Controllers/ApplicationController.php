<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Database;
use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\Intakes;
use Mwaki\Validator;

final class ApplicationController
{
    private const HOW_HEARD = ['Social Media', 'Friend/Family', 'School Visit', 'Radio/TV', 'Online Ad', 'Other'];
    private const MIN_AGE = 15;
    // Characters for reference numbers. I, O, 0 and 1 are left out because people mix them up
    // when reading a number aloud or copying it from a printout.
    private const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    /**
     * POST /api/applications  - submit an admission application (public: no sign-in).
     *
     * CONCEPT: two layers of validation.
     *   Layer 1 (Validator): is each field well-formed on its own?  (an email looks like an email)
     *   Layer 2 (this method): do the fields make sense TOGETHER and against the database?
     *           (does the program exist? is the KCSE grade high enough FOR THAT PROGRAM? is the
     *           intake still open FOR THAT PROGRAM?)
     * Layer 2 is business logic; the browser could not enforce it even if it tried, because the
     * browser does not hold the database.
     */
    public static function create(array $params): void
    {
        $body = Http::readJson();

        // Only the fields listed here are read; anything else in the JSON is ignored.
        // That is why a request containing "status":"approved" cannot approve itself.
        [$clean, $errors] = Validator::check($body, [
            'fullName'     => ['required', 'string', 'minlen:3', 'maxlen:100'],
            'email'        => ['required', 'email', 'maxlen:120'],
            'phone'        => ['required', 'phone'],
            'gender'       => ['in:Male,Female'],                                    // optional
            'dob'          => ['required', 'pastdate'],
            'address'      => ['required', 'string', 'minlen:3', 'maxlen:200'],
            'programId'    => ['required', 'int'],
            'kcseGrade'    => ['required', 'in:' . implode(',', (array) config('kcse_order'))],
            'intakeYear'   => ['required', 'int'],
            'intakePeriod' => ['required', 'string', 'maxlen:20'],
            'motivation'   => ['required', 'string', 'minlen:20', 'maxlen:1000'],
            'howHeard'     => ['required', 'in:' . implode(',', self::HOW_HEARD)],
        ], [
            'fullName' => 'Full name', 'dob' => 'Date of birth', 'programId' => 'Program',
            'kcseGrade' => 'KCSE mean grade', 'intakeYear' => 'Intake year',
            'intakePeriod' => 'Intake period', 'howHeard' => 'This answer',
            'motivation' => 'Your reason for applying',
        ]);

        // ---- layer 2 ------------------------------------------------------------------
        $program = null;
        if (!isset($errors['programId'])) {
            $program = Database::one('SELECT id, name, faculty, min_kcse, intakes FROM programs WHERE id = ?', [$clean['programId']]);
            if ($program === null) {
                $errors['programId'] = 'Please choose a program from the list.';
            }
        }

        if (!isset($errors['dob'])) {
            $age = (new \DateTimeImmutable($clean['dob']))->diff(new \DateTimeImmutable('today'))->y;
            if ($age < self::MIN_AGE || $age > 100) {
                $errors['dob'] = 'Applicants must be at least ' . self::MIN_AGE . ' years old. Please check the date.';
            }
        }

        if ($program !== null) {
            if (!isset($errors['kcseGrade']) && !self::meetsMinimum($clean['kcseGrade'], $program['min_kcse'])) {
                $errors['kcseGrade'] = "{$program['name']} requires a KCSE mean grade of {$program['min_kcse']} or above.";
            }
            if (!isset($errors['intakeYear'], $errors['intakePeriod'])
                && !Intakes::isOpen($clean['intakeYear'], $clean['intakePeriod'], explode(',', $program['intakes']))) {
                $errors['intakePeriod'] = "That intake is not open for {$program['name']}. Offered intakes: "
                    . str_replace(',', ', ', $program['intakes']) . '.';
            }
        }

        if ($errors !== []) {
            throw new HttpException(422, 'Please correct the highlighted fields.', $errors);
        }

        // ---- save it -------------------------------------------------------------------
        $email = strtolower($clean['email']);

        // A transaction keeps "check for a duplicate" and "insert" together as one unit.
        $row = Database::transaction(function () use ($clean, $program, $email): array {
            $duplicate = Database::scalar(
                "SELECT 1 FROM applications
                  WHERE email = ? AND program_id = ? AND intake_year = ? AND intake_period = ? AND status <> 'rejected'",
                [$email, $program['id'], $clean['intakeYear'], $clean['intakePeriod']]
            );
            if ($duplicate !== null) {
                // 409 Conflict: the request is valid, but clashes with something that already exists.
                // We do not reveal the existing reference number (it would let anyone read it).
                throw new HttpException(409, 'You have already applied for this program and intake with this email address. Use "Track your application" to check on it.', [], 'duplicate');
            }

            // Reference numbers are random. If two ever collide, the UNIQUE column makes the
            // insert fail, and we simply draw another one.
            for ($attempt = 0; $attempt < 5; $attempt++) {
                try {
                    $id = Database::insert(
                        'INSERT INTO applications
                            (reference, full_name, email, phone, gender, dob, address, program_id,
                             kcse_grade, intake_year, intake_period, motivation, how_heard)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [self::newReference(), $clean['fullName'], $email, $clean['phone'], $clean['gender'], $clean['dob'],
                         $clean['address'], $program['id'], $clean['kcseGrade'], $clean['intakeYear'],
                         $clean['intakePeriod'], $clean['motivation'], $clean['howHeard']]
                    );
                    return Database::one(self::SELECT_PRESENTABLE . ' WHERE a.id = ?', [$id]);
                } catch (\PDOException $e) {
                    if (!str_contains($e->getMessage(), 'applications.reference')) {
                        throw $e;                       // some other database problem
                    }
                }
            }
            throw new \RuntimeException('Could not generate a unique reference number.');
        });

        Http::json(201, ['application' => self::present($row, true)]);
    }

    /**
     * GET /api/applications/status?ref=MU-2026-ABC123&email=me@example.com
     *
     * SECURITY: needs BOTH the reference and the email, and gives the SAME 404 for "no such
     * reference" and "wrong email". If it said which one was wrong, someone could confirm that
     * a particular person had applied. It also returns only what the applicant needs (no phone,
     * address or date of birth): share the minimum.
     */
    public static function status(array $params): void
    {
        [$clean, $errors] = Validator::check($_GET, [
            'ref'   => ['required', 'string', 'maxlen:20'],
            'email' => ['required', 'email', 'maxlen:120'],
        ], ['ref' => 'Reference number']);
        if ($errors !== []) {
            throw new HttpException(422, 'Please enter your reference number and the email you applied with.', $errors);
        }

        $row = Database::one(
            self::SELECT_PRESENTABLE . ' WHERE a.reference = ? AND a.email = ?',
            [strtoupper($clean['ref']), strtolower($clean['email'])]
        );
        if ($row === null) {
            throw new HttpException(404, 'We could not find an application with that reference number and email address.', [], 'not_found');
        }
        Http::json(200, ['application' => self::present($row, false)]);
    }

    // ------------------------------------------------------------------ helpers

    private const SELECT_PRESENTABLE =
        'SELECT a.reference, a.full_name, a.email, a.kcse_grade, a.intake_year, a.intake_period, a.status, a.created_at,
                p.name AS program, p.faculty
           FROM applications a JOIN programs p ON p.id = a.program_id';

    /** Shape a database row for the browser. $isOwnerView adds the name and email the applicant just typed. */
    private static function present(array $row, bool $isOwnerView): array
    {
        $data = [
            'reference'    => $row['reference'],
            'program'      => $row['program'],
            'faculty'      => $row['faculty'],
            'intakeYear'   => (int) $row['intake_year'],
            'intakePeriod' => $row['intake_period'],
            'status'       => $row['status'],
            'submittedAt'  => str_replace(' ', 'T', $row['created_at']) . 'Z',
        ];
        if ($isOwnerView) {
            $data['fullName']  = $row['full_name'];
            $data['email']     = $row['email'];
            $data['kcseGrade'] = $row['kcse_grade'];
        }
        return $data;
    }

    /** Grades are ranked in config('kcse_order') from lowest to highest. */
    private static function meetsMinimum(string $grade, string $minimum): bool
    {
        $order = (array) config('kcse_order');
        $have  = array_search($grade, $order, true);
        $need  = array_search($minimum, $order, true);
        return $have !== false && $need !== false && $have >= $need;
    }

    /** e.g. MU-2026-K7F3QA. random_int() is cryptographically secure, so references cannot be guessed in sequence. */
    private static function newReference(): string
    {
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= self::REFERENCE_ALPHABET[random_int(0, strlen(self::REFERENCE_ALPHABET) - 1)];
        }
        return 'MU-' . date('Y') . '-' . $code;
    }
}
