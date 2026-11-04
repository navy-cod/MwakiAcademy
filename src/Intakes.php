<?php
declare(strict_types=1);

namespace Mwaki;

/**
 * Which intakes can still be applied for?
 *
 * The old admission form hard-coded "2026 / 2027 / 2028" in the HTML. By November 2026 every
 * 2026 intake had already started, yet the form still offered them. Calculating the list from
 * TODAY'S DATE means it can never go out of date, and it lives in one place that both the
 * programs endpoint (to build the form) and the application endpoint (to check the answer) share.
 */
final class Intakes
{
    /**
     * @param  list<string> $periods  e.g. ['September', 'January'] (a program's intake months)
     * @return list<array{year:int, period:string, starts:string}> intakes that have NOT started yet, soonest first
     */
    public static function upcoming(array $periods, ?\DateTimeImmutable $today = null): array
    {
        $today  ??= new \DateTimeImmutable('today');        // midnight today, in config's time zone
        $months = (array) config('intake_months');
        $thisYear = (int) $today->format('Y');

        $result = [];
        for ($year = $thisYear; $year <= $thisYear + 2; $year++) {
            foreach ($periods as $period) {
                if (!isset($months[$period])) {
                    continue;                               // an unknown period name: ignore it
                }
                $starts = new \DateTimeImmutable(sprintf('%04d-%02d-01', $year, $months[$period]));
                if ($starts > $today) {
                    $result[] = ['year' => $year, 'period' => $period, 'starts' => $starts->format('Y-m-d')];
                }
            }
        }
        usort($result, static fn(array $a, array $b): int => $a['starts'] <=> $b['starts']);
        return $result;
    }

    /** Is this exact year + period still open for a program that offers $periods? */
    public static function isOpen(int $year, string $period, array $periods): bool
    {
        foreach (self::upcoming($periods) as $intake) {
            if ($intake['year'] === $year && $intake['period'] === $period) {
                return true;
            }
        }
        return false;
    }
}
