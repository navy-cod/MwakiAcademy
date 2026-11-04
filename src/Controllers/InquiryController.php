<?php
declare(strict_types=1);

namespace Mwaki\Controllers;

use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\InquiryService;

final class InquiryController
{
    /** POST /api/inquiries  body: {"name","email","phone","message","website"} */
    public static function create(array $params): void
    {
        $body = Http::readJson();

        // A bot filled the hidden field. Answer "success" and quietly throw the message away,
        // so the bot's author gets no signal that they were detected and will not adapt.
        if (InquiryService::isBot($body)) {
            error_log('[mwaki] honeypot triggered on /api/inquiries');
            Http::json(201, ['ok' => true]);
        }

        [$clean, $errors] = InquiryService::validate($body);
        if ($errors !== []) {
            throw new HttpException(422, 'Please correct the highlighted fields.', $errors);
        }

        InquiryService::assertNotThrottled($clean['email']);
        InquiryService::store($clean);

        Http::json(201, ['ok' => true]);
    }
}
