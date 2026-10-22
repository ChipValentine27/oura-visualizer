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
    /// GET /api/battery?start=2025-01-01&amp;end=2025-12-31&amp;interval=weekly&amp;timeZone=America/New_York
    /// Ring battery levels grouped into the same calendar buckets as /api/metrics. Days are the
    /// viewer's local days (<paramref name="timeZone"/> is an IANA or Windows zone id), since a
    /// sample at 11pm belongs to that evening, not to the next UTC day.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<BatteryResponse>> Get(
        [FromQuery] DateOnly start,
        [FromQuery] DateOnly end,
        [FromQuery] Interval interval = Interval.Daily,
        [FromQuery] string timeZone = "UTC",
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
            .Select(r => new Sample(
                r.TimestampMs,
                LocalDay(r.TimestampMs, tz),
                r.Level,
                r.Charging == true || r.InCharger == true))
            .ToList();

        var chargeStarts = ChargeStartDays(samples);
        var chargesByDay = chargeStarts.CountBy(d => d).ToDictionary();
        var byDay = samples.GroupBy(s => s.Day).ToDictionary(
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
            var charges = 0;
            for (var d = from; d <= to; d = d.AddDays(1))
            {
                if (byDay.TryGetValue(d, out var stats)) days.Add(stats);
                charges += chargesByDay.GetValueOrDefault(d);
            }

            var readings = days.Sum(s => s.Count);
            buckets.Add(new BatteryBucket(
                from, to,
                Readings: readings,
                DaysWithData: days.Count,
                AverageLevel: readings == 0 ? null : Math.Round((double)days.Sum(s => s.Sum) / readings, 1),
                MinLevel: readings == 0 ? null : days.Min(s => s.Min),
                MaxLevel: readings == 0 ? null : days.Max(s => s.Max),
                Charges: charges));
        }

        var latest = samples.LastOrDefault();
        return new BatteryResponse(
            start, end, interval, buckets,
            Readings: samples.Count,
            DaysWithData: byDay.Count,
            AverageLevel: samples.Count == 0 ? null : Math.Round(samples.Average(s => s.Level), 1),
            MinLevel: samples.Count == 0 ? null : samples.Min(s => s.Level),
            Latest: latest is null ? null : new BatteryReading(latest.TimestampMs, latest.Level, latest.Charging),
            ChargeCount: chargeStarts.Count);
    }

    private record Sample(long TimestampMs, DateOnly Day, int Level, bool Charging);

    private record DayStats(int Count, long Sum, int Min, int Max);

    /// <summary>Charging flags this close together belong to one session on the charger.</summary>
    private const long ChargeMergeGapMs = 10 * 60_000;

    /// <summary>A session that gains less than this is a flag blip (ring set down briefly), not a charge.</summary>
    private const int MinChargeGain = 2;

    /// <summary>
    /// The local day each real charge started on. Oura's charging flag flickers: it can blink on
    /// for a minute with no gain, or drop out mid-charge. So charging samples less than
    /// <see cref="ChargeMergeGapMs"/> apart form one session, and a session counts only if the level
    /// rose by at least <see cref="MinChargeGain"/> points by the time it ended.
    /// </summary>
    private static List<DateOnly> ChargeStartDays(List<Sample> samples)
    {
        var days = new List<DateOnly>();
        Sample? first = null;
        var lastChargingMs = 0L;
        var maxLevel = 0;

        void Close()
        {
            if (first is not null && maxLevel - first.Level >= MinChargeGain) days.Add(first.Day);
            first = null;
        }

        foreach (var s in samples)
        {
            if (first is not null && s.TimestampMs - lastChargingMs > ChargeMergeGapMs) Close();
            if (first is not null) maxLevel = Math.Max(maxLevel, s.Level);
            if (!s.Charging) continue;
            if (first is null)
            {
                first = s;
                maxLevel = s.Level;
            }
            lastChargingMs = s.TimestampMs;
        }
        Close();
        return days;
    }

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

/// <summary>Levels are 0–100%; latest.timestamp is Unix milliseconds.</summary>
public record BatteryResponse(
    DateOnly Start, DateOnly End, Interval Interval, List<BatteryBucket> Buckets,
    int Readings, int DaysWithData, double? AverageLevel, int? MinLevel, BatteryReading? Latest, int ChargeCount);

/// <summary>
/// One calendar bucket: the mean, low and high of its samples (null when it has none) and how
/// many charges started in it.
/// </summary>
public record BatteryBucket(
    DateOnly Start, DateOnly End, int Readings, int DaysWithData,
    double? AverageLevel, int? MinLevel, int? MaxLevel, int Charges);

public record BatteryReading(long Timestamp, int Level, bool Charging);
