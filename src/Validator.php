<?php
declare(strict_types=1);

namespace Mwaki;

/**
 * Server-side input validation.
 *
 * WHY THIS EXISTS: the browser also checks forms (required fields, email format ...), but
 * that is only a convenience for honest users. Anyone can skip the page entirely and
 * send requests with curl. The SERVER must therefore re-check everything. The golden rule:
 *     "Never trust the client."
 *
 * USAGE:
 *     [$clean, $errors] = Validator::check($body, [
 *         'email' => ['required', 'email', 'maxlen:120'],
 *         'grade' => ['required', 'number', 'between:0,100'],
 *     ]);
 *     if ($errors) { throw new HttpException(422, 'Please fix the errors.', $errors); }
 *
 * BONUS SECURITY: only the fields listed in $rules are copied into $clean. If a hacker
 * adds an extra field such as "role":"admin" to the JSON, it is silently dropped. (This
 * defends against "mass assignment" bugs.)
 */
final class Validator
{
    /**
     * @param array<string,mixed>        $input  the decoded JSON body
     * @param array<string,list<string>> $rules  field => list of rule names
     * @param array<string,string>       $labels optional friendlier field names for messages
     * @return array{0: array<string,mixed>, 1: array<string,string>}  [cleanValues, errorsByField]
     */
    public static function check(array $input, array $rules, array $labels = []): array
    {
        $clean  = [];
        $errors = [];

        foreach ($rules as $field => $fieldRules) {
            $label = $labels[$field] ?? self::humanise($field);
            $value = $input[$field] ?? null;

            // Trim stray spaces from text ("  Alice " -> "Alice"), except for fields
            // marked 'raw'. Passwords are 'raw': silently changing one would be a bug.
            if (is_string($value) && !in_array('raw', $fieldRules, true)) {
                $value = trim($value);
            }

            // Empty input: an error if required, otherwise skip the other rules.
            if ($value === null || $value === '') {
                if (in_array('required', $fieldRules, true)) {
                    $errors[$field] = "$label is required.";
                } else {
                    $clean[$field] = null;
                }
                continue;
            }

            // Arrays/objects are never valid for the simple fields we accept.
            if (!is_scalar($value)) {
                $errors[$field] = "$label is not valid.";
                continue;
            }

            foreach ($fieldRules as $rule) {
                if ($rule === 'required' || $rule === 'raw') {
                    continue;
                }
                // "maxlen:50" -> name "maxlen", argument "50"
                [$name, $argument] = array_pad(explode(':', $rule, 2), 2, '');
                $error = self::apply($name, $argument, $label, $value);
                if ($error !== null) {
                    $errors[$field] = $error;     // report the first problem per field
                    continue 2;                   // and go to the next field
                }
            }
            $clean[$field] = $value;
        }

        return [$clean, $errors];
    }

    /**
     * Apply one rule. $value is passed BY REFERENCE (&) so a rule can also convert it:
     * the 'int' rule turns the text "42" into the number 42 and 'phone' tidies the format.
     */
    private static function apply(string $name, string $argument, string $label, mixed &$value): ?string
    {
        switch ($name) {
            case 'string':
                return is_string($value) ? null : "$label must be text.";

            case 'int':
                if (is_int($value)) {
                    return null;
                }
                if (is_string($value) && preg_match('/^-?\d+$/', $value) === 1) {
                    $value = (int) $value;
                    return null;
                }
                return "$label must be a whole number.";

            case 'number':
                if (is_int($value) || is_float($value) || (is_string($value) && is_numeric($value))) {
                    $value = (float) $value;
                    return null;
                }
                return "$label must be a number.";

            case 'email':
                return filter_var($value, FILTER_VALIDATE_EMAIL) !== false
                    ? null : "$label must be a valid email address.";

            case 'minlen':
                return mb_strlen((string) $value) >= (int) $argument
                    ? null : "$label must be at least $argument characters.";

            case 'maxlen':
                return mb_strlen((string) $value) <= (int) $argument
                    ? null : "$label must be at most $argument characters.";

            case 'between':   // "between:0,100"
                [$min, $max] = array_map('floatval', explode(',', $argument));
                return is_numeric($value) && $value >= $min && $value <= $max
                    ? null : "$label must be between $min and $max.";

            case 'in':        // "in:male,female" - an allow-list. Safer than trying to block bad values.
                return in_array((string) $value, explode(',', $argument), true)
                    ? null : "Please choose a valid option for $label.";

            case 'date':      // YYYY-MM-DD and a real calendar date (rejects 2024-02-31)
                return self::isRealDate($value) ? null : "$label must be a valid date.";

            case 'pastdate':  // a real date that is not in the future and not absurdly old
                if (!self::isRealDate($value)) {
                    return "$label must be a valid date.";
                }
                return ($value <= date('Y-m-d') && $value >= '1900-01-01')
                    ? null : "$label must be a date in the past.";

            case 'https_url': // only https:// addresses; blocks javascript: and data: URLs
                $isUrl = filter_var($value, FILTER_VALIDATE_URL) !== false;
                return ($isUrl && parse_url((string) $value, PHP_URL_SCHEME) === 'https')
                    ? null : "$label must be a web address starting with https://";

            case 'phone':
                $normalised = self::normalizePhone((string) $value);
                if ($normalised === null) {
                    return "$label must be a valid Kenyan phone number (for example 0712 345 678).";
                }
                $value = $normalised;
                return null;
        }

        // A typo in a rule name is a programming mistake, so fail loudly while developing.
        throw new \LogicException("Unknown validation rule: $name");
    }

    private static function isRealDate(mixed $value): bool
    {
        return is_string($value)
            && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) === 1
            && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /**
     * Accepts 0712345678, 0112345678, +254712345678, 254 712 345 678 or 712345678 and
     * returns the single standard form +254712345678 (or null if it is not a Kenyan number).
     * Storing ONE format means searching and comparing later just works.
     */
    public static function normalizePhone(string $raw): ?string
    {
        $digits = preg_replace('/[\s\-().]/', '', $raw);     // drop spaces, dashes, brackets
        if ($digits !== null && preg_match('/^(?:\+?254|0)?([17]\d{8})$/', $digits, $m) === 1) {
            return '+254' . $m[1];
        }
        return null;
    }

    /** "firstName" or "first_name" -> "First name" (used in error messages). */
    private static function humanise(string $field): string
    {
        $spaced = preg_replace('/(?<!^)[A-Z]/', ' $0', $field) ?? $field;
        return ucfirst(strtolower(str_replace('_', ' ', $spaced)));
    }
}
