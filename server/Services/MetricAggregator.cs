namespace OuraViz.Api.Services;

public enum Interval { Daily, Weekly, Monthly, Yearly }

public record MetricBucket(
    DateOnly Start,
    DateOnly End,
    double Total,
    int DaysWithData,
    double AveragePerDay);

public static class MetricAggregator
{
    /// <summary>
    /// Groups per-day values into contiguous buckets covering [start, end]. Buckets with no data
    /// are still emitted (with zeros) so gaps stay visible on the chart instead of collapsing.
    /// Partial first/last buckets are clipped to the requested range.
    /// </summary>
    public static List<MetricBucket> Aggregate(IReadOnlyDictionary<DateOnly, double> byDay, DateOnly start, DateOnly end, Interval interval)
    {
        var buckets = new List<MetricBucket>();

        for (var bucketStart = BucketStart(start, interval); bucketStart <= end; bucketStart = Next(bucketStart, interval))
        {
            var from = bucketStart < start ? start : bucketStart;
            var bucketEnd = Next(bucketStart, interval).AddDays(-1);
            var to = bucketEnd > end ? end : bucketEnd;

            double total = 0;
            var count = 0;
            for (var d = from; d <= to; d = d.AddDays(1))
            {
                if (byDay.TryGetValue(d, out var value))
                {
                    total += value;
                    count++;
                }
            }

            buckets.Add(new MetricBucket(from, to, total, count, count == 0 ? 0 : total / count));
        }

        return buckets;
    }

    private static DateOnly BucketStart(DateOnly day, Interval interval) => interval switch
    {
        Interval.Daily => day,
        // ISO weeks start on Monday.
        Interval.Weekly => day.AddDays(-(((int)day.DayOfWeek + 6) % 7)),
        Interval.Monthly => new DateOnly(day.Year, day.Month, 1),
        Interval.Yearly => new DateOnly(day.Year, 1, 1),
        _ => throw new ArgumentOutOfRangeException(nameof(interval)),
    };

    private static DateOnly Next(DateOnly bucketStart, Interval interval) => interval switch
    {
        Interval.Daily => bucketStart.AddDays(1),
        Interval.Weekly => bucketStart.AddDays(7),
        Interval.Monthly => bucketStart.AddMonths(1),
        Interval.Yearly => bucketStart.AddYears(1),
        _ => throw new ArgumentOutOfRangeException(nameof(interval)),
    };
}
