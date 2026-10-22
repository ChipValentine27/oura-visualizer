using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;

namespace OuraViz.Api.Controllers;

[ApiController]
[Route("api/battery")]
public class BatteryController(OuraDbContext db) : ControllerBase
{
    /// <summary>Enough points to draw a smooth line at any chart width without shipping every sample.</summary>
    private const int MaxPoints = 600;

    /// <summary>
    /// GET /api/battery?from=2025-01-01T00:00:00-05:00&amp;to=2025-02-01T00:00:00-05:00
    /// Ring battery levels in [from, to), averaged into at most <see cref="MaxPoints"/> equal time
    /// buckets. Empty buckets are left out, so the client can tell a gap in the data from a level.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<BatteryResponse>> Get(
        [FromQuery] DateTimeOffset from, [FromQuery] DateTimeOffset to, CancellationToken ct)
    {
        if (to <= from) return BadRequest("to must be after from.");

        var fromMs = from.ToUnixTimeMilliseconds();
        var toMs = to.ToUnixTimeMilliseconds();
        var samples = await db.RingBatteryReadings.AsNoTracking()
            .Where(r => r.TimestampMs >= fromMs && r.TimestampMs < toMs)
            .OrderBy(r => r.TimestampMs)
            .Select(r => new { r.TimestampMs, r.Level, r.Charging, r.InCharger })
            .ToListAsync(ct);

        // At least a minute, so short ranges show each sample rather than splitting hairs.
        var bucketMs = Math.Max(60_000, (long)Math.Ceiling((toMs - fromMs) / (double)MaxPoints));
        var points = samples
            .GroupBy(s => (s.TimestampMs - fromMs) / bucketMs)
            .Select(g => new BatteryPoint(
                Timestamp: fromMs + g.Key * bucketMs,
                Level: Math.Round(g.Average(s => s.Level), 1),
                Min: g.Min(s => s.Level),
                Max: g.Max(s => s.Level),
                Charging: g.Any(s => IsCharging(s.Charging, s.InCharger))))
            .ToList();

        var latest = samples.LastOrDefault();
        return new BatteryResponse(
            fromMs, toMs, bucketMs, points,
            Readings: samples.Count,
            AverageLevel: samples.Count == 0 ? null : Math.Round(samples.Average(s => s.Level), 1),
            MinLevel: samples.Count == 0 ? null : samples.Min(s => s.Level),
            Latest: latest is null
                ? null
                : new BatteryReading(latest.TimestampMs, latest.Level, IsCharging(latest.Charging, latest.InCharger)),
            // A charge starts wherever a charging sample follows a non-charging one (or opens the range).
            ChargeCount: samples.Where((s, i) => IsCharging(s.Charging, s.InCharger)
                && (i == 0 || !IsCharging(samples[i - 1].Charging, samples[i - 1].InCharger))).Count());
    }

    private static bool IsCharging(bool? charging, bool? inCharger) => charging == true || inCharger == true;
}

/// <summary>Timestamps are Unix milliseconds; levels are 0–100%.</summary>
public record BatteryResponse(
    long From, long To, long BucketMs, List<BatteryPoint> Points,
    int Readings, double? AverageLevel, int? MinLevel, BatteryReading? Latest, int ChargeCount);

/// <summary>One time bucket: its start, mean level, low/high, and whether the ring charged in it.</summary>
public record BatteryPoint(long Timestamp, double Level, int Min, int Max, bool Charging);

public record BatteryReading(long Timestamp, int Level, bool Charging);
