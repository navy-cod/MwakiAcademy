<?php
declare(strict_types=1);

namespace Mwaki;

/**
 * An error that should be reported to the browser with a specific HTTP status code.
 *
 * CONCEPT: exceptions as control flow for errors. A controller can write
 *     throw new HttpException(404, 'Student not found.');
 * from deep inside its logic, and the exception travels UP to Http::handleException(),
 * which turns it into a tidy JSON response. Without this we would have to return and
 * check error codes after every single function call.
 */
final class HttpException extends \RuntimeException
{
    /**
     * @param int                  $status    HTTP status code (404, 422, ...)
     * @param string               $message   Safe, human-readable text for the user
     * @param array<string,string> $errors    Per-field messages, e.g. ['email' => 'Invalid email.']
     * @param string               $errorCode Short machine-readable label the JavaScript can react to
     */
    public function __construct(
        private int $status,
        string $message,
        private array $errors = [],
        private string $errorCode = ''
    ) {
        parent::__construct($message);
    }

    public function getStatus(): int       { return $this->status; }
    public function getErrors(): array     { return $this->errors; }
    public function getErrorCode(): string { return $this->errorCode; }
}
