using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;
using OuraViz.Api.Models;

namespace OuraViz.Api.Services;

public class ActivitySyncService(OuraDbContext db, OuraClient oura)
{
    /// <summary>Pulls daily activity from Oura and upserts it into SQLite. Returns rows written.</summary>
    public async Task<int> SyncFromOuraAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var docs = await oura.GetDailyActivityAsync(start, end, ct);
        var rows = docs.Select(d => new DailyActivity
        {
            Day = d.Day,
            Steps = d.Steps,
            ActiveCalories = d.ActiveCalories,
            TotalCalories = d.TotalCalories,
            Score = d.Score,
            OuraId = d.Id,
        });
        return await UpsertAsync(rows, ct);
    }

    /// <summary>
    /// Generates plausible step data (weekday/weekend rhythm, seasonal drift, noise)
    /// so the UI can be explored before an Oura token is set up.
    /// </summary>
    public async Task<int> SeedDemoAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var rng = new Random(42);
        var rows = new List<DailyActivity>();
        for (var day = start; day <= end; day = day.AddDays(1))
        {
            var weekend = day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
            var seasonal = Math.Sin((day.DayOfYear - 80) / 365.0 * 2 * Math.PI) * 1500; // more steps in summer
            var baseline = weekend ? 10500 : 8200;
            var noise = (rng.NextDouble() - 0.5) * 5000;
            var lazyDay = rng.NextDouble() < 0.06 ? -5000 : 0;
            var steps = (int)Math.Max(800, baseline + seasonal + noise + lazyDay);

            rows.Add(new DailyActivity
            {
                Day = day,
                Steps = steps,
                ActiveCalories = (int)(steps * 0.04),
                TotalCalories = 2100 + (int)(steps * 0.04),
            });
        }
        return await UpsertAsync(rows, ct);
    }

    private async Task<int> UpsertAsync(IEnumerable<DailyActivity> rows, CancellationToken ct)
    {
        var list = rows.ToList();
        if (list.Count == 0) return 0;

        var min = list.Min(r => r.Day);
        var max = list.Max(r => r.Day);
        var existing = await db.DailyActivities
            .Where(a => a.Day >= min && a.Day <= max)
            .ToDictionaryAsync(a => a.Day, ct);

        var now = DateTimeOffset.UtcNow;
        foreach (var row in list)
        {
            if (existing.TryGetValue(row.Day, out var current))
            {
                current.Steps = row.Steps;
                current.ActiveCalories = row.ActiveCalories;
                current.TotalCalories = row.TotalCalories;
                current.Score = row.Score;
                current.OuraId = row.OuraId;
                current.UpdatedAt = now;
            }
            else
            {
                row.UpdatedAt = now;
                db.DailyActivities.Add(row);
            }
        }
        await db.SaveChangesAsync(ct);
        return list.Count;
    }
}
