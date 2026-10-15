using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;
using OuraViz.Api.Models;
using OuraViz.Api.Services;

namespace OuraViz.Api.Controllers;

public enum Metric
{
    // Activity (daily_activity)
    Steps, ActivityScore, HighActivityTime, MediumActivityTime, LowActivityTime, SedentaryTime, RestingTime,
    NonWearTime, WalkingDistance, TargetMeters, MetersToTarget,

    // Sleep (sleep periods, daily_sleep)
    Sleep, SleepScore, DeepSleep, LightSleep, RemSleep, AwakeTime, TimeInBed, Latency, Efficiency,
    BedtimeStart, BedtimeEnd,

    // Readiness (daily_readiness, daily_stress)
    ReadinessScore, TemperatureDeviation, TemperatureTrendDeviation, StressHigh, RecoveryHigh,

    // Heart and breathing (heartrate, sleep periods, daily_spo2)
    HeartRate, HeartRateMin, HeartRateMax, SleepLowestHeartRate, SleepAverageHeartRate, SleepMaxHeartRate,
    SleepAverageHrv, SleepMaxHrv, AverageBreath, Spo2, BreathingDisturbanceIndex,
}

[ApiController]
[Route("api/metrics")]
public class MetricsController(OuraDbContext db) : ControllerBase
{
    /// <summary>Where a metric's daily values come from, and the unit they are in.</summary>
    private sealed record MetricSource(
        string Unit, Func<OuraDbContext, DateOnly, DateOnly, CancellationToken, Task<Dictionary<DateOnly, double>>> Load);

    private static MetricSource Activity(string unit, Func<DailyActivity, double?> value) =>
        new(unit, (db, s, e, ct) => LoadAsync(db.DailyActivities, value, s, e, ct));
    private static MetricSource Sleep(string unit, Func<DailySleep, double?> value) =>
        new(unit, (db, s, e, ct) => LoadAsync(db.DailySleep, value, s, e, ct));
    private static MetricSource Score(string unit, Func<DailyScore, double?> value) =>
        new(unit, (db, s, e, ct) => LoadAsync(db.DailyScores, value, s, e, ct));
    private static MetricSource Health(string unit, Func<DailyHealth, double?> value) =>
        new(unit, (db, s, e, ct) => LoadAsync(db.DailyHealth, value, s, e, ct));

    /// <summary>
    /// Units: steps; seconds (durations); timeOfDay (seconds from local midnight, negative the
    /// evening before); score (0–100); percent; bpm; ms; breathsPerMinute; celsius (deviation
    /// from baseline); index (unitless); meters.
    /// </summary>
    private static readonly Dictionary<Metric, MetricSource> Sources = new()
    {
        [Metric.Steps] = Activity("steps", a => a.Steps),
        [Metric.ActivityScore] = Activity("score", a => a.Score),
        [Metric.HighActivityTime] = Activity("seconds", a => a.HighActivitySeconds),
        [Metric.MediumActivityTime] = Activity("seconds", a => a.MediumActivitySeconds),
        [Metric.LowActivityTime] = Activity("seconds", a => a.LowActivitySeconds),
        [Metric.SedentaryTime] = Activity("seconds", a => a.SedentarySeconds),
        [Metric.RestingTime] = Activity("seconds", a => a.RestingSeconds),
        [Metric.NonWearTime] = Activity("seconds", a => a.NonWearSeconds),
        [Metric.WalkingDistance] = Activity("meters", a => a.EquivalentWalkingDistanceMeters),
        [Metric.TargetMeters] = Activity("meters", a => a.TargetMeters),
        [Metric.MetersToTarget] = Activity("meters", a => a.MetersToTarget),

        [Metric.Sleep] = Sleep("seconds", s => s.TotalSleepSeconds),
        [Metric.SleepScore] = Score("score", s => s.SleepScore),
        [Metric.DeepSleep] = Sleep("seconds", s => s.DeepSleepSeconds),
        [Metric.LightSleep] = Sleep("seconds", s => s.LightSleepSeconds),
        [Metric.RemSleep] = Sleep("seconds", s => s.RemSleepSeconds),
        [Metric.AwakeTime] = Sleep("seconds", s => s.AwakeSeconds),
        [Metric.TimeInBed] = Sleep("seconds", s => s.TimeInBedSeconds),
        [Metric.Latency] = Sleep("seconds", s => s.LatencySeconds),
        [Metric.Efficiency] = Sleep("percent", s => s.Efficiency),
        [Metric.BedtimeStart] = Sleep("timeOfDay", s => s.BedtimeStartOffsetSeconds),
        [Metric.BedtimeEnd] = Sleep("timeOfDay", s => s.BedtimeEndOffsetSeconds),

        [Metric.ReadinessScore] = Score("score", s => s.ReadinessScore),
        [Metric.TemperatureDeviation] = Score("celsius", s => s.TemperatureDeviation),
        [Metric.TemperatureTrendDeviation] = Score("celsius", s => s.TemperatureTrendDeviation),
        [Metric.StressHigh] = Health("seconds", h => h.StressHighSeconds),
        [Metric.RecoveryHigh] = Health("seconds", h => h.RecoveryHighSeconds),

        [Metric.HeartRate] = Health("bpm", h => h.HeartRateAverage),
        [Metric.HeartRateMin] = Health("bpm", h => h.HeartRateMin),
        [Metric.HeartRateMax] = Health("bpm", h => h.HeartRateMax),
        [Metric.SleepLowestHeartRate] = Sleep("bpm", s => s.LowestHeartRate),
        [Metric.SleepAverageHeartRate] = Sleep("bpm", s => s.AverageHeartRate),
        [Metric.SleepMaxHeartRate] = Sleep("bpm", s => s.MaxHeartRate),
        [Metric.SleepAverageHrv] = Sleep("ms", s => s.AverageHrv),
        [Metric.SleepMaxHrv] = Sleep("ms", s => s.MaxHrv),
        [Metric.AverageBreath] = Sleep("breathsPerMinute", s => s.AverageBreath),
        [Metric.Spo2] = Health("percent", h => h.Spo2Average),
        [Metric.BreathingDisturbanceIndex] = Health("index", h => h.BreathingDisturbanceIndex),
    };

    /// <summary>
    /// GET /api/metrics/steps?start=2025-01-01&amp;end=2025-12-31&amp;interval=weekly
    /// Values are in the metric's unit (see <see cref="Sources"/>); days without a value are
    /// skipped, not counted as zero.
    /// </summary>
    [HttpGet("{metric}")]
    public async Task<ActionResult<SeriesResponse>> Get(
        Metric metric,
        [FromQuery] DateOnly start,
        [FromQuery] DateOnly end,
        [FromQuery] Interval interval = Interval.Daily,
        CancellationToken ct = default)
    {
        if (end < start) return BadRequest("end must be on or after start.");
        if (interval == Interval.Daily && end.DayNumber - start.DayNumber > 3660)
            return BadRequest("Daily interval is limited to 10 years; pick a coarser interval.");
        if (!Sources.TryGetValue(metric, out var source)) return NotFound();

        var byDay = await source.Load(db, start, end, ct);
        var total = byDay.Values.Sum();
        return new SeriesResponse(
            metric, source.Unit, start, end, interval,
            MetricAggregator.Aggregate(byDay, start, end, interval),
            Total: total,
            DaysWithData: byDay.Count,
            AveragePerDay: byDay.Count == 0 ? 0 : total / byDay.Count);
    }

    /// <summary>Each day's value in [start, end], skipping days where it is null.</summary>
    private static async Task<Dictionary<DateOnly, double>> LoadAsync<T>(
        DbSet<T> set, Func<T, double?> value, DateOnly start, DateOnly end, CancellationToken ct)
        where T : class, IDailyRow
    {
        // At most a few thousand small rows, so the value is picked out in memory.
        var rows = await set.AsNoTracking()
            .Where(x => EF.Property<DateOnly>(x, "Day") >= start && EF.Property<DateOnly>(x, "Day") <= end)
            .ToListAsync(ct);
        var byDay = new Dictionary<DateOnly, double>();
        foreach (var row in rows)
        {
            if (value(row) is { } v) byDay[row.Day] = v;
        }
        return byDay;
    }

    /// <summary>The span of days that have any data, used to default the date pickers.</summary>
    [HttpGet("range")]
    public async Task<DataRange> GetRange(CancellationToken ct)
    {
        var activityDays = db.DailyActivities.Select(a => a.Day);
        var sleepDays = db.DailySleep.Select(s => s.Day);

        var activityCount = await activityDays.CountAsync(ct);
        var sleepCount = await sleepDays.CountAsync(ct);
        if (activityCount == 0 && sleepCount == 0) return new DataRange(null, null, 0, 0);

        var all = activityDays.Union(sleepDays);
        return new DataRange(await all.MinAsync(ct), await all.MaxAsync(ct), activityCount, sleepCount);
    }
}

public record SeriesResponse(
    Metric Metric, string Unit, DateOnly Start, DateOnly End, Interval Interval,
    List<MetricBucket> Buckets, double Total, int DaysWithData, double AveragePerDay);

public record DataRange(DateOnly? FirstDay, DateOnly? LastDay, int ActivityDays, int SleepDays);
