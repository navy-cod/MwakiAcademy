<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Auth;
use Mwaki\Database;
use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\Validator;

/**
 * A STUDENT's view of their own record. Every method starts with
 *     Auth::requireUser('student')
 * so only a student can reach it, and every query filters by the caller's own student_id.
 * A student can never see or edit another student's row through these endpoints.
 *
 * What a student may EDIT: phone, address, imageUrl (contact details and photo).
 * What stays READ-ONLY: name, email, studentCode, grade, program, dob. Those are staff decisions.
 */
final class MeController
{
    /** GET /api/me/student */
    public static function showStudent(array $params): void
    {
        $user = Auth::requireUser('student');
        Http::json(200, ['student' => self::present(self::ownRow($user))]);
    }

    /** PATCH /api/me/student  body: {"phone","address","imageUrl"} */
    public static function updateStudent(array $params): void
    {
        $user = Auth::requireUser('student');
        $row  = self::ownRow($user);                              // 404/403 before any validation work

        [$clean, $errors] = Validator::check(Http::readJson(), [
            'phone'    => ['required', 'phone'],
            'address'  => ['required', 'string', 'minlen:3', 'maxlen:200'],
            // https only: a "javascript:" or "data:" URL in an image could run code, and the strict
            // Content-Security-Policy only allows https images anyway.
            'imageUrl' => ['https_url', 'maxlen:300'],
        ], ['imageUrl' => 'Image address']);

        if ($errors !== []) {
            throw new HttpException(422, 'Please correct the highlighted fields.', $errors);
        }

        Database::execute(
            "UPDATE students
                SET phone = ?, address = ?, image_url = ?, updated_at = datetime('now')
              WHERE id = ?",
            [$clean['phone'], $clean['address'], $clean['imageUrl'], $row['id']]
        );

        Http::json(200, ['student' => self::present(self::ownRow($user))]);
    }

    // ------------------------------------------------------------------ helpers

    /** The caller's own students row. */
    private static function ownRow(array $user): array
    {
        if (($user['student_id'] ?? null) === null) {
            // Should be impossible: a 'student' role requires student_id (see the schema CHECK).
            throw new HttpException(403, 'This account is not linked to a student record.', [], 'no_student');
        }
        $row = Database::one(
            'SELECT s.*, p.name AS program FROM students s
               JOIN programs p ON p.id = s.program_id
              WHERE s.id = ?',
            [$user['student_id']]
        );
        if ($row === null) {
            throw new HttpException(404, 'Your student record could not be found.', [], 'not_found');
        }
        return $row;
    }

    /** Database row -> JSON. Matches StudentController::present() so the browser sees the same shape. */
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
        ];
    }
}