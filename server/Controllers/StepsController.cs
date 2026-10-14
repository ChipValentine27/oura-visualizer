using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;
using OuraViz.Api.Services;

namespace OuraViz.Api.Controllers;

[ApiController]
[Route("api/steps")]
public class StepsController(OuraDbContext db) : ControllerBase
{
    /// <summary>GET /api/steps?start=2025-01-01&amp;end=2025-12-31&amp;interval=weekly</summary>
    [HttpGet]
    public async Task<ActionResult<StepsResponse>> Get(
        [FromQuery] DateOnly start,
        [FromQuery] DateOnly end,
        [FromQuery] Interval interval = Interval.Daily,
        CancellationToken ct = default)
    {
        if (end < start) return BadRequest("end must be on or after start.");
        if (interval == Interval.Daily && end.DayNumber - start.DayNumber > 3660)
            return BadRequest("Daily interval is limited to 10 years; pick a coarser interval.");

        var days = await db.DailyActivities
            .AsNoTracking()
            .Where(a => a.Day >= start && a.Day <= end)
            .ToListAsync(ct);

        var buckets = StepAggregator.Aggregate(days, start, end, interval);
        var total = days.Sum(d => (long)d.Steps);

        return new StepsResponse(
            start, end, interval, buckets,
            TotalSteps: total,
            DaysWithData: days.Count,
            AverageDailySteps: days.Count == 0 ? 0 : (int)Math.Round((double)total / days.Count));
    }

    /// <summary>The span of days that have data, used to default the date pickers.</summary>
    [HttpGet("range")]
    public async Task<ActionResult<DataRange>> GetRange(CancellationToken ct)
    {
        if (!await db.DailyActivities.AnyAsync(ct)) return new DataRange(null, null, 0);
        var min = await db.DailyActivities.MinAsync(a => a.Day, ct);
        var max = await db.DailyActivities.MaxAsync(a => a.Day, ct);
        var count = await db.DailyActivities.CountAsync(ct);
        return new DataRange(min, max, count);
    }
}

public record StepsResponse(
    DateOnly Start, DateOnly End, Interval Interval, List<StepBucket> Buckets,
    long TotalSteps, int DaysWithData, int AverageDailySteps);

public record DataRange(DateOnly? FirstDay, DateOnly? LastDay, int DayCount);
