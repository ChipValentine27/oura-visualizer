using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;
using OuraViz.Api.Services;

namespace OuraViz.Api.Controllers;

public enum Metric { Steps, Sleep }

[ApiController]
[Route("api/metrics")]
public class MetricsController(OuraDbContext db) : ControllerBase
{
    /// <summary>
    /// GET /api/metrics/steps?start=2025-01-01&amp;end=2025-12-31&amp;interval=weekly
    /// Steps are counts; sleep values are seconds of total sleep.
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

        var byDay = metric switch
        {
            Metric.Steps => await db.DailyActivities.AsNoTracking()
                .Where(a => a.Day >= start && a.Day <= end)
                .ToDictionaryAsync(a => a.Day, a => (long)a.Steps, ct),
            Metric.Sleep => await db.DailySleep.AsNoTracking()
                .Where(s => s.Day >= start && s.Day <= end)
                .ToDictionaryAsync(s => s.Day, s => (long)s.TotalSleepSeconds, ct),
            _ => throw new ArgumentOutOfRangeException(nameof(metric)),
        };

        var total = byDay.Values.Sum();
        return new SeriesResponse(
            metric,
            Unit: metric == Metric.Sleep ? "seconds" : "steps",
            start, end, interval,
            MetricAggregator.Aggregate(byDay, start, end, interval),
            Total: total,
            DaysWithData: byDay.Count,
            AveragePerDay: byDay.Count == 0 ? 0 : (long)Math.Round((double)total / byDay.Count));
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
    List<MetricBucket> Buckets, long Total, int DaysWithData, long AveragePerDay);

public record DataRange(DateOnly? FirstDay, DateOnly? LastDay, int ActivityDays, int SleepDays);
