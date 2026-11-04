<?php
declare(strict_types=1);

/*
 * public/submit_inquiry.php  -  the "classic" way to process a form.
 *
 * contact.html's <form action="submit_inquiry.php" method="post"> works WITHOUT JavaScript:
 * the browser sends the fields as application/x-www-form-urlencoded, PHP puts them in $_POST,
 * and we answer with a redirect or a page. When JavaScript IS available, contact.js intercepts the
 * submit and uses the JSON API instead. Same rules either way (InquiryService).
 * This approach - "the page works first, JavaScript improves it" - is called PROGRESSIVE ENHANCEMENT.
 *
 * CSRF NOTE: this endpoint deliberately has no CSRF token. CSRF defends actions that depend on WHO
 * YOU ARE (delete a student, change a password). Sending an anonymous message depends on nothing about
 * you, so a forged request gains an attacker nothing they could not do by filling in the form themselves.
 * Spam is handled separately: honeypot field + throttle.
 */

require_once dirname(__DIR__) . '/src/bootstrap.php';

use Mwaki\Http;
use Mwaki\HttpException;
use Mwaki\InquiryService;

Http::securityHeaders();

/**
 * CONCEPT: escaping OUTPUT. Whatever a visitor typed may contain HTML such as <script>.
 * Before we print it into a page we convert the special characters (< > & " ') into harmless
 * entities (&lt; &gt; ...). The browser then DISPLAYS the text instead of RUNNING it.
 * Rule of thumb: escape at the moment you output, every time, for every value that came from outside.
 */
function e(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function render_page(int $status, string $title, string $bodyHtml): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        . '<title>' . e($title) . ' - Mwaki University</title>'
        . '<link rel="stylesheet" href="style.css"></head>'
        . '<body class="no-sidebar"><main class="main-wrapper"><div class="card">'
        . '<h1>' . e($title) . '</h1>' . $bodyHtml
        . '</div></main></body></html>';
    exit;
}

// Only POST is meaningful here. Opening the URL in the address bar (a GET) gets a polite refusal.
if (Http::method() !== 'POST') {
    header('Allow: POST');
    render_page(405, 'Use the contact form', '<p>Please send your message from the <a href="contact.html">contact page</a>.</p>');
}

try {
    // A bot filled the hidden field: pretend it worked, store nothing.
    if (InquiryService::isBot($_POST)) {
        error_log('[mwaki] honeypot triggered on submit_inquiry.php');
        header('Location: /contact.html?sent=1', true, 303);
        exit;
    }

    [$clean, $errors] = InquiryService::validate($_POST);
    if ($errors !== []) {
        $who   = isset($_POST['name']) && is_string($_POST['name']) && trim($_POST['name']) !== '' ? trim($_POST['name']) : 'there';
        $items = '';
        foreach ($errors as $message) {
            $items .= '<li>' . e($message) . '</li>';
        }
        render_page(422, 'Please check your message',
            '<p>Thanks for writing, <strong>' . e($who) . '</strong>. We could not send your message yet:</p>'
            . '<ul style="list-style: disc; padding-left: 1.5rem; margin: 1rem 0;">' . $items . '</ul>'
            . '<p><a class="btn" href="contact.html">Back to the form</a></p>');
    }

    InquiryService::assertNotThrottled($clean['email']);
    InquiryService::store($clean);

    // CONCEPT: Post/Redirect/Get. After a successful POST we redirect to a normal page (303 See Other).
    // If we instead showed the result directly, pressing Refresh would make the browser offer to
    // "resubmit the form" and send the message twice. A redirect makes Refresh harmless.
    // The target is a fixed string, never taken from the request (no open-redirect hole).
    header('Location: /contact.html?sent=1', true, 303);
    exit;
} catch (HttpException $e) {
    render_page($e->getStatus(), 'We could not send your message', '<p>' . e($e->getMessage()) . '</p><p><a class="btn" href="contact.html">Back to the form</a></p>');
}
