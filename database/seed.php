<?php
declare(strict_types=1);

/*
 * database/seed.php  -  create the database and fill it with starting data.
 *
 *     php database/seed.php
 *
 * "Seeding" = loading the first rows an app needs. This script is IDEMPOTENT: you can run
 * it as often as you like and it will not create duplicates.
 * To start completely fresh: delete storage/mwaki.sqlite and run it again.
 *
 * Optional environment variables (otherwise random passwords are generated and printed):
 *     MWAKI_ADMIN_PASSWORD, MWAKI_STAFF_PASSWORD     (at least 12 characters)
 */

if (PHP_SAPI !== 'cli') {          // this must never be runnable from a web browser
    http_response_code(404);
    exit;
}

require_once dirname(__DIR__) . '/src/bootstrap.php';

use Mwaki\Database;
use Mwaki\Validator;

$pdo = Database::pdo();

// ---------------------------------------------------------------- 1. tables
$pdo->exec((string) file_get_contents(__DIR__ . '/schema.sql'));
echo "Tables ready.\n";

// ---------------------------------------------------------------- 2. programs
// Names are the ones the admission and student forms already used. Tuition figures come from
// the original tuition.html; BSc Information Technology and BSc Mathematics had no published
// figure, so they stay NULL and the tuition page says "contact admissions".
// Faculty and intake months follow the table in faculties.html.
$programs = [
    // name,                          faculty,                  tuition, fees,  min KCSE, intakes
    ['BSc Computer Science',          'Science and Technology', 645650,  64565, 'C+', 'September,January'],
    ['BSc Information Technology',    'Science and Technology', null,    null,  'C+', 'September,January'],
    ['BSc Mathematics',               'Science and Technology', null,    null,  'C+', 'September,January'],
    ['BBA Business Administration',   'Business and Economics', 581085,  58109, 'C+', 'September,May'],
    ['BEd Education',                 'Education',              516520,  51652, 'C+', 'September,January'],
    ['BA Literature',                 'Arts and Humanities',    451955,  45196, 'C+', 'September,January'],
    ['BSc Nursing',                   'Health Sciences',        774780,  77478, 'C+', 'September,March'],
];

// "UPSERT": insert the row, or if a program with this name exists, update it instead.
$upsert = $pdo->prepare(
    'INSERT INTO programs (name, faculty, annual_tuition_kes, additional_fees_kes, min_kcse, intakes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
         faculty = excluded.faculty,
         annual_tuition_kes = excluded.annual_tuition_kes,
         additional_fees_kes = excluded.additional_fees_kes,
         min_kcse = excluded.min_kcse,
         intakes = excluded.intakes'
);
foreach ($programs as $row) {
    $upsert->execute($row);
}
echo count($programs) . " programs ready.\n";

// ---------------------------------------------------------------- 3. students (from students.json)
$jsonPath = __DIR__ . '/students.json';
$students = json_decode((string) file_get_contents($jsonPath), true, 8, JSON_THROW_ON_ERROR);

$programIds = [];
foreach (Database::all('SELECT id, name FROM programs') as $p) {
    $programIds[$p['name']] = (int) $p['id'];
}

// INSERT OR IGNORE skips rows whose UNIQUE column (student_code) already exists.
$insert = $pdo->prepare(
    'INSERT OR IGNORE INTO students
        (student_code, first_name, last_name, email, phone, grade, program_id, address, dob, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

$imported = 0;
$pdo->beginTransaction();
foreach ($students as $s) {
    // The JSON stores dates as DD/MM/YYYY; the database standard is YYYY-MM-DD.
    $dob = DateTimeImmutable::createFromFormat('!d/m/Y', (string) $s['dob']);
    $phone = Validator::normalizePhone((string) $s['contactNumber']);
    $programId = $programIds[$s['course']] ?? null;

    if ($dob === false || $phone === null || $programId === null) {
        fwrite(STDERR, "Skipped {$s['studentId']}: could not convert its date, phone or course.\n");
        continue;
    }
    // Note: the old JSON also stored "age". We do not import it. Age changes every year, so it is
    // calculated from the date of birth whenever it is needed.
    $insert->execute([
        $s['studentId'], $s['firstName'], $s['lastName'], $s['email'], $phone,
        $s['grade'], $programId, $s['address'], $dob->format('Y-m-d'), $s['imageUrl'] ?? null,
    ]);
    $imported += $insert->rowCount();
}
$pdo->commit();
echo "Students: $imported new row(s) imported from students.json.\n";

// ---------------------------------------------------------------- 4. staff accounts
function generatePassword(): string
{
    // 12 random bytes -> 16 URL-safe characters. random_bytes() is cryptographically secure.
    return rtrim(strtr(base64_encode(random_bytes(12)), '+/', '-_'), '=');
}

if ((int) Database::scalar('SELECT COUNT(*) FROM users') === 0) {
    $accounts = [
        ['admin', 'admin', getenv('MWAKI_ADMIN_PASSWORD') ?: null],
        ['staff', 'staff', getenv('MWAKI_STAFF_PASSWORD') ?: null],
    ];
    echo "\nCreated staff accounts. Passwords are shown ONCE - copy them now:\n";
    foreach ($accounts as [$username, $role, $given]) {
        if ($given !== null && strlen($given) < 12) {
            fwrite(STDERR, "The password for $username must be at least 12 characters.\n");
            exit(1);
        }
        $password = $given ?? generatePassword();
        Database::execute(
            'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
            [$username, password_hash($password, PASSWORD_DEFAULT), $role]
        );
        echo "  $role  /  username: $username  /  password: " . ($given !== null ? '(the one you supplied)' : $password) . "\n";
    }
} else {
    echo "Staff accounts already exist - left unchanged.\n";
}
echo "\nDone. Database file: " . config('db.path') . "\n";
