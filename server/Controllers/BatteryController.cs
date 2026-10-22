using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;
using OuraViz.Api.Services;

namespace OuraViz.Api.Controllers;

[ApiController]
[Route("api/battery")]
public class BatteryController(OuraDbContext db) : ControllerBase
{
    /// <summary>
    /// More readings than this are thinned for the chart: enough to draw a long range in full detail
    /// without sending every sample to the browser.
    /// </summary>
    private const int MaxChartReadings = 3000;

    /// <summary>
    /// GET /api/battery?start=2025-01-01&amp;end=2025-12-31&amp;interval=weekly&amp;timeZone=America/New_York
    /// The battery levels Oura reported between local midnight on <paramref name="start"/> and the
    /// end of <paramref name="end"/>, plus the average, lowest and highest of them for the range and
    /// for each calendar bucket (the same buckets as /api/metrics). <paramref name="timeZone"/> is an
    /// IANA or Windows zone id; days are the viewer's local days. With
    /// <paramref name="includeReadings"/> false only the stats and buckets are returned.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<BatteryResponse>> Get(
        [FromQuery] DateOnly start,
        [FromQuery] DateOnly end,
        [FromQuery] Interval interval = Interval.Daily,
        [FromQuery] string timeZone = "UTC",
        [FromQuery] bool includeReadings = true,
        CancellationToken ct = default)
    {
        if (end < start) return BadRequest("end must be on or after start.");
        if (interval == Interval.Daily && end.DayNumber - start.DayNumber > 3660)
            return BadRequest("Daily interval is limited to 10 years; pick a coarser interval.");
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(timeZone, out var tz))
            return BadRequest($"Unknown time zone '{timeZone}'.");

        var fromMs = LocalMidnightMs(start, tz);
        var toMs = LocalMidnightMs(end.AddDays(1), tz);
        var samples = (await db.RingBatteryReadings.AsNoTracking()
                .Where(r => r.TimestampMs >= fromMs && r.TimestampMs < toMs)
                .OrderBy(r => r.TimestampMs)
                .Select(r => new { r.TimestampMs, r.Level, r.Charging, r.InCharger })
                .ToListAsync(ct))
            .Select(r => new BatteryReading(r.TimestampMs, r.Level, r.Charging, r.InCharger))
            .ToList();

        var byDay = samples.GroupBy(s => LocalDay(s.Timestamp, tz)).ToDictionary(
            g => g.Key,
            g => new DayStats(g.Count(), g.Sum(s => (long)s.Level), g.Min(s => s.Level), g.Max(s => s.Level)));

        var buckets = new List<BatteryBucket>();
        for (var bucketStart = MetricAggregator.BucketStart(start, interval);
             bucketStart <= end;
             bucketStart = MetricAggregator.Next(bucketStart, interval))
        {
            // Clip the first and last buckets to the range, as /api/metrics does.
            var from = bucketStart < start ? start : bucketStart;
            var bucketEnd = MetricAggregator.Next(bucketStart, interval).AddDays(-1);
            var to = bucketEnd > end ? end : bucketEnd;

            var days = new List<DayStats>();
            for (var d = from; d <= to; d = d.AddDays(1))
                if (byDay.TryGetValue(d, out var stats)) days.Add(stats);

            var readings = days.Sum(s => s.Count);
            buckets.Add(new BatteryBucket(
                from, to,
                Readings: readings,
                AverageLevel: readings == 0 ? null : Math.Round((double)days.Sum(s => s.Sum) / readings, 1),
                MinLevel: readings == 0 ? null : days.Min(s => s.Min),
                MaxLevel: readings == 0 ? null : days.Max(s => s.Max)));
        }

        // Long ranges are charted from the buckets, so the individual readings needn't be sent.
        var chartReadings = includeReadings ? Thin(samples, fromMs, toMs) : [];
        return new BatteryResponse(
            start, end, interval, fromMs, toMs,
            Readings: chartReadings,
            ReadingCount: samples.Count,
            Thinned: includeReadings && chartReadings.Count < samples.Count,
            Buckets: buckets,
            AverageLevel: samples.Count == 0 ? null : Math.Round(samples.Average(s => s.Level), 1),
            MinLevel: samples.Count == 0 ? null : samples.Min(s => s.Level),
            MaxLevel: samples.Count == 0 ? null : samples.Max(s => s.Level),
            Latest: samples.LastOrDefault());
    }

    /// <summary>
    /// Keeps at most <see cref="MaxChartReadings"/> readings by splitting the range into equal
    /// slots and keeping each slot's lowest and highest reading. Every kept point is a real
    /// reading (nothing is averaged), and the line's peaks and troughs survive.
    /// </summary>
    private static List<BatteryReading> Thin(List<BatteryReading> samples, long fromMs, long toMs)
    {
        if (samples.Count <= MaxChartReadings) return samples;

        var slotMs = Math.Max(1, (toMs - fromMs) / (MaxChartReadings / 2));
        return samples
            .GroupBy(s => (s.Timestamp - fromMs) / slotMs)
            .SelectMany(g =>
            {
                var low = g.MinBy(s => s.Level)!;
                var high = g.MaxBy(s => s.Level)!;
                return low == high ? [low] : new[] { low, high }.OrderBy(s => s.Timestamp).ToArray();
            })
            .ToList();
    }

    private record DayStats(int Count, long Sum, int Min, int Max);

    private static DateOnly LocalDay(long timestampMs, TimeZoneInfo tz) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTimeOffset.FromUnixTimeMilliseconds(timestampMs).UtcDateTime, tz));

    /// <summary>The instant a local day begins. Where DST skips midnight, the day begins an hour later.</summary>
    private static long LocalMidnightMs(DateOnly day, TimeZoneInfo tz)
    {
        var midnight = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        if (tz.IsInvalidTime(midnight)) midnight = midnight.AddHours(1);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(midnight, tz)).ToUnixTimeMilliseconds();
    }
}

/// <summary>
/// Levels are 0–100% as Oura reported them; timestamps (and From/To, the range's bounds) are Unix
/// milliseconds. Readings may be thinned for long ranges (see Thinned); the stats use every reading.
/// </summary>
public record BatteryResponse(
    DateOnly Start, DateOnly End, Interval Interval, long From, long To,
    List<BatteryReading> Readings, int ReadingCount, bool Thinned,
    List<BatteryBucket> Buckets,
    double? AverageLevel, int? MinLevel, int? MaxLevel, BatteryReading? Latest);

/// <summary>The average, lowest and highest reported level in one calendar bucket; null when it has none.</summary>
public record BatteryBucket(
    DateOnly Start, DateOnly End, int Readings, double? AverageLevel, int? MinLevel, int? MaxLevel);

/// <summary>One reading as Oura reported it, including its charging and in_charger fields.</summary>
public record BatteryReading(long Timestamp, int Level, bool? Charging, bool? InCharger);
