<?php
declare(strict_types=1);

namespace Mwaki;

/**
 * Everything about contact-form messages, written ONCE and used by TWO entry points:
 *   - POST /api/inquiries        (JavaScript sends JSON)         -> Controllers/InquiryController
 *   - public/submit_inquiry.php  (a plain HTML form, no JS)      -> that file
 * Sharing the rules means the two paths can never disagree about what a valid message is.
 */
final class InquiryService
{
    /** The name of the decoy field. Real visitors never see it, so never fill it in. */
    public const HONEYPOT_FIELD = 'website';

    private const MAX_PER_EMAIL_PER_HOUR = 3;
    private const MAX_IN_TOTAL_PER_HOUR  = 60;

    /**
     * CONCEPT: honeypot. Spam bots fill in every field they find. We add one the browser hides
     * with CSS. A human leaves it empty; a bot fills it. If it is filled, we know it is a bot.
     * (Not bullet-proof, but free and invisible to real users.)
     */
    public static function isBot(array $input): bool
    {
        $value = $input[self::HONEYPOT_FIELD] ?? '';
        return is_array($value) || trim((string) $value) !== '';
    }

    /** @return array{0: array<string,mixed>, 1: array<string,string>} [clean, errors] */
    public static function validate(array $input): array
    {
        return Validator::check($input, [
            'name'    => ['required', 'string', 'minlen:2', 'maxlen:100'],
            'email'   => ['required', 'email', 'maxlen:120'],
            'phone'   => ['phone'],                                   // optional
            'message' => ['required', 'string', 'minlen:10', 'maxlen:2000'],
        ], ['name' => 'Your name', 'message' => 'Your message']);
    }

    /**
     * Refuse floods. We have no IP column to count by (that would need a schema change), so we
     * limit per email address and also cap the total per hour. Trade-off: an attacker using
     * many different emails can still use up the total cap. See the README, "Known limits".
     */
    public static function assertNotThrottled(string $email): void
    {
        $perEmail = (int) Database::scalar(
            "SELECT COUNT(*) FROM inquiries WHERE email = ? AND created_at > datetime('now', '-1 hour')",
            [$email]
        );
        $total = (int) Database::scalar(
            "SELECT COUNT(*) FROM inquiries WHERE created_at > datetime('now', '-1 hour')"
        );
        if ($perEmail >= self::MAX_PER_EMAIL_PER_HOUR || $total >= self::MAX_IN_TOTAL_PER_HOUR) {
            throw new HttpException(429, 'We have received several messages already. Please try again in an hour.', [], 'throttled');
        }
    }

    /** @param array<string,mixed> $clean the output of validate() */
    public static function store(array $clean): void
    {
        Database::execute(
            'INSERT INTO inquiries (name, email, phone, message) VALUES (?, ?, ?, ?)',
            [$clean['name'], strtolower($clean['email']), $clean['phone'], $clean['message']]
        );
    }
}
