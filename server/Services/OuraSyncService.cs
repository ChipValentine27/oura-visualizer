using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;
using OuraViz.Api.Models;

namespace OuraViz.Api.Services;

public record SyncResult(int ActivityDays, int SleepDays);

public class OuraSyncService(OuraDbContext db, OuraClient oura)
{
    // Oura also records "rest" periods (lying down awake) and soft-deleted periods; neither is sleep.
    private static readonly HashSet<string> IgnoredSleepTypes = ["rest", "deleted"];

    /// <summary>Pulls daily activity and sleep from Oura and upserts both into SQLite.</summary>
    public async Task<SyncResult> SyncFromOuraAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;

        var activity = (await oura.GetDailyActivityAsync(start, end, ct))
            .Select(d => new DailyActivity
            {
                Day = d.Day,
                Steps = d.Steps,
                ActiveCalories = d.ActiveCalories,
                TotalCalories = d.TotalCalories,
                Score = d.Score,
                OuraId = d.Id,
                UpdatedAt = now,
            })
            .ToList();

        // Several periods (main sleep, naps) can share one day; total them per day.
        var sleep = (await oura.GetSleepPeriodsAsync(start, end, ct))
            .Where(p => p.Type is null || !IgnoredSleepTypes.Contains(p.Type))
            .GroupBy(p => p.Day)
            .Select(g => new DailySleep
            {
                Day = g.Key,
                TotalSleepSeconds = g.Sum(p => p.TotalSleepDuration ?? 0),
                TimeInBedSeconds = g.Sum(p => p.TimeInBed ?? 0),
                DeepSleepSeconds = g.Sum(p => p.DeepSleepDuration ?? 0),
                RemSleepSeconds = g.Sum(p => p.RemSleepDuration ?? 0),
                LightSleepSeconds = g.Sum(p => p.LightSleepDuration ?? 0),
                AwakeSeconds = g.Sum(p => p.AwakeTime ?? 0),
                PeriodCount = g.Count(),
                UpdatedAt = now,
            })
            .ToList();

        await UpsertAsync(db.DailyActivities, activity, a => a.Day, CopyActivity, ct);
        await UpsertAsync(db.DailySleep, sleep, s => s.Day, CopySleep, ct);
        await db.SaveChangesAsync(ct);

        return new SyncResult(activity.Count, sleep.Count);
    }

    /// <summary>
    /// Generates plausible steps and sleep (weekday/weekend rhythm, seasonal drift, noise,
    /// a mild link between active days and longer sleep) so the UI can be explored
    /// before Oura is connected.
    /// </summary>
    public async Task<SyncResult> SeedDemoAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var stepsRng = new Random(42);
        var sleepRng = new Random(7);
        var now = DateTimeOffset.UtcNow;
        var activity = new List<DailyActivity>();
        var sleep = new List<DailySleep>();

        for (var day = start; day <= end; day = day.AddDays(1))
        {
            var weekend = day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;

            var seasonal = Math.Sin((day.DayOfYear - 80) / 365.0 * 2 * Math.PI) * 1500; // more steps in summer
            var baseline = weekend ? 10500 : 8200;
            var noise = (stepsRng.NextDouble() - 0.5) * 5000;
            var lazyDay = stepsRng.NextDouble() < 0.06 ? -5000 : 0;
            var steps = (int)Math.Max(800, baseline + seasonal + noise + lazyDay);

            activity.Add(new DailyActivity
            {
                Day = day,
                Steps = steps,
                ActiveCalories = (int)(steps * 0.04),
                TotalCalories = 2100 + (int)(steps * 0.04),
                UpdatedAt = now,
            });

            var hours = 7.0
                + (weekend ? 0.6 : 0)
                + (steps - 8500) / 10000.0 * 0.5      // active days sleep a bit longer
                + (sleepRng.NextDouble() - 0.5) * 1.8
                - (sleepRng.NextDouble() < 0.08 ? 1.8 : 0); // the occasional short night
            var nap = sleepRng.NextDouble() < 0.1 ? sleepRng.Next(15, 45) * 60 : 0;
            var total = (int)(Math.Clamp(hours, 3.5, 10.5) * 3600) + nap;
            var efficiency = 0.84 + sleepRng.NextDouble() * 0.1;
            var inBed = (int)(total / efficiency);
            var deep = (int)(total * (0.14 + sleepRng.NextDouble() * 0.06));
            var rem = (int)(total * (0.19 + sleepRng.NextDouble() * 0.06));

            sleep.Add(new DailySleep
            {
                Day = day,
                TotalSleepSeconds = total,
                TimeInBedSeconds = inBed,
                DeepSleepSeconds = deep,
                RemSleepSeconds = rem,
                LightSleepSeconds = total - deep - rem,
                AwakeSeconds = inBed - total,
                PeriodCount = nap > 0 ? 2 : 1,
                UpdatedAt = now,
            });
        }

        await UpsertAsync(db.DailyActivities, activity, a => a.Day, CopyActivity, ct);
        await UpsertAsync(db.DailySleep, sleep, s => s.Day, CopySleep, ct);
        await db.SaveChangesAsync(ct);

        return new SyncResult(activity.Count, sleep.Count);
    }

    /// <summary>Inserts new days and overwrites existing ones in place. Caller saves changes.</summary>
    private static async Task UpsertAsync<T>(
        DbSet<T> set, List<T> rows, Func<T, DateOnly> dayOf, Action<T, T> copy, CancellationToken ct)
        where T : class
    {
        if (rows.Count == 0) return;

        var min = rows.Min(dayOf);
        var max = rows.Max(dayOf);
        var existing = await set
            .Where(x => EF.Property<DateOnly>(x, "Day") >= min && EF.Property<DateOnly>(x, "Day") <= max)
            .ToDictionaryAsync(dayOf, ct);

        foreach (var row in rows)
        {
            if (existing.TryGetValue(dayOf(row), out var current)) copy(row, current);
            else set.Add(row);
        }
    }

    private static void CopyActivity(DailyActivity from, DailyActivity to)
    {
        to.Steps = from.Steps;
        to.ActiveCalories = from.ActiveCalories;
        to.TotalCalories = from.TotalCalories;
        to.Score = from.Score;
        to.OuraId = from.OuraId;
        to.UpdatedAt = from.UpdatedAt;
    }

    private static void CopySleep(DailySleep from, DailySleep to)
    {
        to.TotalSleepSeconds = from.TotalSleepSeconds;
        to.TimeInBedSeconds = from.TimeInBedSeconds;
        to.DeepSleepSeconds = from.DeepSleepSeconds;
        to.RemSleepSeconds = from.RemSleepSeconds;
        to.LightSleepSeconds = from.LightSleepSeconds;
        to.AwakeSeconds = from.AwakeSeconds;
        to.PeriodCount = from.PeriodCount;
        to.UpdatedAt = from.UpdatedAt;
    }
}
