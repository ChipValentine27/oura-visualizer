using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;
using OuraViz.Api.Models;

namespace OuraViz.Api.Services;

/// <summary>
/// Days written per table. <see cref="Skipped"/> lists Oura collections the connection couldn't
/// read (usually a scope that wasn't granted); their metrics stay empty.
/// </summary>
public record SyncResult(int ActivityDays, int SleepDays, int ScoreDays, int HealthDays, List<string> Skipped);

public record BatterySyncResult(int Readings);

public record TagSyncResult(int Tags);

public class OuraSyncService(OuraDbContext db, OuraClient oura)
{
    // Oura also records "rest" periods (lying down awake) and soft-deleted periods; neither is sleep.
    private static readonly HashSet<string> IgnoredSleepTypes = ["rest", "deleted"];

    /// <summary>Pulls every supported Oura collection for the range and upserts it into SQLite.</summary>
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
                HighActivitySeconds = d.HighActivityTime,
                MediumActivitySeconds = d.MediumActivityTime,
                LowActivitySeconds = d.LowActivityTime,
                SedentarySeconds = d.SedentaryTime,
                RestingSeconds = d.RestingTime,
                NonWearSeconds = d.NonWearTime,
                EquivalentWalkingDistanceMeters = d.EquivalentWalkingDistance,
                TargetMeters = d.TargetMeters,
                OuraId = d.Id,
                UpdatedAt = now,
            })
            .ToList();

        // Several periods (main sleep, naps) can share one day; total the durations per day and
        // take the nightly averages and bedtimes from the longest period.
        var sleep = (await oura.GetSleepPeriodsAsync(start, end, ct))
            .Where(p => p.Type is null || !IgnoredSleepTypes.Contains(p.Type))
            .GroupBy(p => p.Day)
            .Select(g =>
            {
                var main = g.MaxBy(p => p.TotalSleepDuration ?? 0)!;
                return new DailySleep
                {
                    Day = g.Key,
                    TotalSleepSeconds = g.Sum(p => p.TotalSleepDuration ?? 0),
                    TimeInBedSeconds = g.Sum(p => p.TimeInBed ?? 0),
                    DeepSleepSeconds = g.Sum(p => p.DeepSleepDuration ?? 0),
                    RemSleepSeconds = g.Sum(p => p.RemSleepDuration ?? 0),
                    LightSleepSeconds = g.Sum(p => p.LightSleepDuration ?? 0),
                    AwakeSeconds = g.Sum(p => p.AwakeTime ?? 0),
                    PeriodCount = g.Count(),
                    LatencySeconds = main.Latency,
                    Efficiency = main.Efficiency,
                    BedtimeStartOffsetSeconds = OffsetFromMidnight(main.BedtimeStart, g.Key),
                    BedtimeEndOffsetSeconds = OffsetFromMidnight(main.BedtimeEnd, g.Key),
                    LowestHeartRate = main.LowestHeartRate,
                    AverageHeartRate = main.AverageHeartRate,
                    MaxHeartRate = MaxOf(main.HeartRate),
                    AverageHrv = main.AverageHrv,
                    MaxHrv = MaxOf(main.Hrv),
                    AverageBreath = main.AverageBreath,
                    UpdatedAt = now,
                };
            })
            .ToList();

        // Sleep and readiness scores come from two collections; merge them into one row per day.
        var sleepScores = await oura.GetDailySleepAsync(start, end, ct);
        var readiness = await oura.GetDailyReadinessAsync(start, end, ct);
        var scores = new RowsByDay<DailyScore>(day => new DailyScore { Day = day, UpdatedAt = now });
        foreach (var d in sleepScores) scores[d.Day].SleepScore = d.Score;
        foreach (var d in readiness)
        {
            var row = scores[d.Day];
            row.ReadinessScore = d.Score;
            row.TemperatureDeviation = d.TemperatureDeviation;
            row.TemperatureTrendDeviation = d.TemperatureTrendDeviation;
        }

        // The rest are optional: a connection without a collection's scope just skips it.
        var skipped = new List<string>();
        async Task<List<T>> Optional<T>(Func<Task<List<T>>> fetch)
        {
            try
            {
                return await fetch();
            }
            catch (OuraCollectionUnavailableException ex)
            {
                skipped.Add(ex.Collection);
                return [];
            }
        }

        var health = new RowsByDay<DailyHealth>(day => new DailyHealth { Day = day, UpdatedAt = now });
        foreach (var d in await Optional(() => oura.GetDailySpo2Async(start, end, ct)))
        {
            health[d.Day].Spo2Average = d.Spo2Percentage?.Average;
            health[d.Day].BreathingDisturbanceIndex = d.BreathingDisturbanceIndex;
        }
        foreach (var d in await Optional(() => oura.GetDailyStressAsync(start, end, ct)))
        {
            health[d.Day].StressHighSeconds = d.StressHigh;
            health[d.Day].RecoveryHighSeconds = d.RecoveryHigh;
        }
        // All-day heart rate is ~288 samples a day and pages slowly, so it is the bulk of a sync.
        // Only days without a stored value are fetched (plus the last two, which may still be
        // filling in); days already stored keep their values.
        var storedHeartRate = await db.DailyHealth.AsNoTracking()
            .Where(h => h.Day >= start && h.Day <= end && h.HeartRateAverage != null)
            .ToDictionaryAsync(h => h.Day, ct);
        var refreshFrom = DateOnly.FromDateTime(DateTime.Today).AddDays(-1);
        var heartRateSamples = new List<OuraHeartRateSample>();
        foreach (var (from, to) in MissingRanges(start, end, d => storedHeartRate.ContainsKey(d) && d < refreshFrom))
        {
            heartRateSamples.AddRange(await Optional(() => oura.GetHeartRateAsync(from, to, ct)));
            if (skipped.Contains("heartrate")) break;
        }
        // Samples are bucketed by the server's local day, matching the range the client asked for.
        var heartRateDays = heartRateSamples
            .GroupBy(s => DateOnly.FromDateTime(s.Timestamp.ToLocalTime().DateTime))
            .Where(g => g.Key >= start && g.Key <= end);
        foreach (var g in heartRateDays)
        {
            var row = health[g.Key];
            row.HeartRateAverage = Math.Round(g.Average(s => s.Bpm), 1);
            row.HeartRateMin = g.Min(s => s.Bpm);
            row.HeartRateMax = g.Max(s => s.Bpm);
        }
        // A day rewritten for its SpO2 or stress keeps the heart rate it already had.
        foreach (var row in health.Rows.Where(r => r.HeartRateAverage is null))
        {
            if (!storedHeartRate.TryGetValue(row.Day, out var stored)) continue;
            row.HeartRateAverage = stored.HeartRateAverage;
            row.HeartRateMin = stored.HeartRateMin;
            row.HeartRateMax = stored.HeartRateMax;
        }

        await UpsertAsync(db.DailyActivities, activity, CopyActivity, ct);
        await UpsertAsync(db.DailySleep, sleep, CopySleep, ct);
        await UpsertAsync(db.DailyScores, scores.Rows, CopyScore, ct);
        await UpsertAsync(db.DailyHealth, health.Rows, CopyHealth, ct);
        await db.SaveChangesAsync(ct);

        return new SyncResult(activity.Count, sleep.Count, scores.Rows.Count, health.Rows.Count, skipped);
    }

    /// <summary>
    /// Pulls ring battery samples in [from, to) from Oura. Kept apart from
    /// <see cref="SyncFromOuraAsync"/> so battery and health data sync independently.
    /// </summary>
    public async Task<BatterySyncResult> SyncBatteryFromOuraAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var readings = (await oura.GetRingBatteryLevelsAsync(from, to, ct))
            // Windows can overlap on their shared edge; keep one sample per instant.
            .DistinctBy(r => r.Timestamp)
            .Select(r => new RingBatteryReading
            {
                TimestampMs = r.Timestamp.ToUnixTimeMilliseconds(),
                Level = r.Level,
                Charging = r.Charging,
                InCharger = r.InCharger,
                UpdatedAt = now,
            })
            .ToList();

        await ReplaceBatteryAsync(from, to, readings, ct);
        return new BatterySyncResult(readings.Count);
    }

    /// <summary>
    /// Pulls the tags that start in [start, end] from Oura. Kept apart from
    /// <see cref="SyncFromOuraAsync"/> since it needs its own scope.
    /// </summary>
    public async Task<TagSyncResult> SyncTagsFromOuraAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var tags = (await oura.GetEnhancedTagsAsync(start, end, ct))
            .DistinctBy(t => t.Id)
            .Select(t => new OuraTag
            {
                Id = t.Id,
                TagTypeCode = t.TagTypeCode,
                CustomName = t.CustomName,
                Comment = t.Comment,
                StartDay = t.StartDay,
                EndDay = t.EndDay,
                StartTime = t.StartTime,
                EndTime = t.EndTime,
                UpdatedAt = now,
            })
            .ToList();

        await ReplaceTagsAsync(start, end, tags, ct);
        return new TagSyncResult(tags.Count);
    }

    /// <summary>
    /// The incoming tags become the whole record of tags starting in [start, end], so a tag
    /// deleted in the Oura app disappears on the next sync.
    /// </summary>
    private async Task ReplaceTagsAsync(DateOnly start, DateOnly end, List<OuraTag> tags, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var ids = tags.Select(t => t.Id).ToList();
        await db.Tags
            .Where(t => (t.StartDay >= start && t.StartDay <= end) || ids.Contains(t.Id))
            .ExecuteDeleteAsync(ct);
        db.Tags.AddRange(tags);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>
    /// Seconds from local midnight on <paramref name="day"/> to the wall-clock time of
    /// <paramref name="at"/> in its own offset (negative the evening before, past 86,400 the day after).
    /// </summary>
    private static int? OffsetFromMidnight(DateTimeOffset? at, DateOnly day) =>
        at is { } t ? (int)Math.Round((t.DateTime - day.ToDateTime(TimeOnly.MinValue)).TotalSeconds) : null;

    /// <summary>The contiguous runs of days in [start, end] that <paramref name="have"/> says are missing.</summary>
    private static IEnumerable<(DateOnly From, DateOnly To)> MissingRanges(DateOnly start, DateOnly end, Func<DateOnly, bool> have)
    {
        DateOnly? runStart = null;
        for (var d = start; d <= end; d = d.AddDays(1))
        {
            if (!have(d)) runStart ??= d;
            else if (runStart is { } s)
            {
                yield return (s, d.AddDays(-1));
                runStart = null;
            }
        }
        if (runStart is { } last) yield return (last, end);
    }

    private static double? MaxOf(OuraSampleSeries? series) =>
        series?.Items?.Where(v => v is not null).Max();

    /// <summary>Rows merged from several collections, created on first use for each day.</summary>
    private sealed class RowsByDay<T>(Func<DateOnly, T> create)
    {
        private readonly Dictionary<DateOnly, T> _rows = [];
        public T this[DateOnly day] => _rows.TryGetValue(day, out var row) ? row : _rows[day] = create(day);
        public List<T> Rows => [.. _rows.Values];
    }

    /// <summary>
    /// Generates plausible values for every metric (weekday/weekend rhythm, seasonal drift, noise,
    /// a mild link between active days and longer sleep) so the UI can be explored
    /// before Oura is connected.
    /// </summary>
    public async Task<SyncResult> SeedDemoAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var stepsRng = new Random(42);
        var sleepRng = new Random(7);
        var scoreRng = new Random(11); // separate, so adding scores didn't change the demo steps/sleep
        var extraRng = new Random(23); // likewise for everything added after the scores
        var now = DateTimeOffset.UtcNow;
        var activity = new List<DailyActivity>();
        var sleep = new List<DailySleep>();
        var scores = new List<DailyScore>();
        var health = new List<DailyHealth>();
        int Score(double value) => (int)Math.Round(Math.Clamp(value, 30, 99));
        double Jitter(double spread) => (scoreRng.NextDouble() - 0.5) * 2 * spread;
        double Extra(double min, double max) => min + extraRng.NextDouble() * (max - min);
        var temperatureTrend = 0.0;

        for (var day = start; day <= end; day = day.AddDays(1))
        {
            var weekend = day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;

            var seasonal = Math.Sin((day.DayOfYear - 80) / 365.0 * 2 * Math.PI) * 1500; // more steps in summer
            var baseline = weekend ? 10500 : 8200;
            var noise = (stepsRng.NextDouble() - 0.5) * 5000;
            var lazyDay = stepsRng.NextDouble() < 0.06 ? -5000 : 0;
            var steps = (int)Math.Max(800, baseline + seasonal + noise + lazyDay);
            var activeness = steps / 9000.0;
            var walked = (int)(steps * Extra(0.72, 0.8));
            var target = (int)Math.Round(Extra(7000, 10000) / 100) * 100;
            var nonWear = (int)(extraRng.NextDouble() < 0.2 ? Extra(1800, 7200) : Extra(0, 1200));

            activity.Add(new DailyActivity
            {
                Day = day,
                Steps = steps,
                ActiveCalories = (int)(steps * 0.04),
                TotalCalories = 2100 + (int)(steps * 0.04),
                Score = Score(55 + (steps - 4000) / 250.0 + Jitter(6)),
                HighActivitySeconds = (int)(activeness * Extra(300, 2400)),
                MediumActivitySeconds = (int)(activeness * Extra(1800, 5400)),
                LowActivitySeconds = (int)(activeness * Extra(10800, 18000)),
                SedentarySeconds = (int)Extra(25200, 39600),
                RestingSeconds = (int)Extra(25200, 32400),
                NonWearSeconds = nonWear,
                EquivalentWalkingDistanceMeters = walked,
                TargetMeters = target,
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

            // Bed around 23:15 on weeknights, later at weekends; the main night excludes the nap.
            var bedtimeStart = (int)((weekend ? -900 : -2700) + Extra(-2700, 2700));
            var lowestHr = (int)Math.Round(Extra(47, 55) - (total / 3600.0 - 7) * 0.8);
            var averageHr = lowestHr + Extra(5, 10);
            var averageHrv = (int)Math.Round(Extra(34, 58) + (total / 3600.0 - 7) * 3);

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
                LatencySeconds = (int)Extra(240, 1500),
                Efficiency = (int)Math.Round(efficiency * 100),
                BedtimeStartOffsetSeconds = bedtimeStart,
                BedtimeEndOffsetSeconds = bedtimeStart + (int)((total - nap) / efficiency),
                LowestHeartRate = lowestHr,
                AverageHeartRate = Math.Round(averageHr, 1),
                MaxHeartRate = Math.Round(averageHr + Extra(10, 22)),
                AverageHrv = averageHrv,
                MaxHrv = Math.Round(averageHrv * Extra(1.6, 2.4)),
                AverageBreath = Math.Round(Extra(13.4, 15.6), 1),
                UpdatedAt = now,
            });

            // Longer nights score higher; readiness follows the night's score loosely.
            var sleepScore = Score(45 + (total / 3600.0 - 4.5) * 11 + Jitter(5));
            var temperature = Math.Round(Extra(-0.35, 0.35) + (extraRng.NextDouble() < 0.03 ? 0.6 : 0), 2);
            temperatureTrend = Math.Round(temperatureTrend * 0.7 + temperature * 0.3, 2);
            scores.Add(new DailyScore
            {
                Day = day,
                SleepScore = sleepScore,
                ReadinessScore = Score(70 + (sleepScore - 75) * 0.4 + Jitter(8)),
                TemperatureDeviation = temperature,
                TemperatureTrendDeviation = temperatureTrend,
                UpdatedAt = now,
            });

            health.Add(new DailyHealth
            {
                Day = day,
                Spo2Average = Math.Round(Extra(95.4, 98.6), 1),
                BreathingDisturbanceIndex = (int)Extra(1, 9),
                StressHighSeconds = (int)((weekend ? 0.6 : 1) * Extra(1200, 9000)),
                RecoveryHighSeconds = (int)(Extra(2400, 10800) + (total / 3600.0 - 7) * 900),
                HeartRateAverage = Math.Round(lowestHr + Extra(13, 20) + activeness * 2, 1),
                HeartRateMin = lowestHr - (int)Extra(0, 3),
                HeartRateMax = (int)(Extra(105, 125) + activeness * 25),
                UpdatedAt = now,
            });

        }

        await UpsertAsync(db.DailyActivities, activity, CopyActivity, ct);
        await UpsertAsync(db.DailySleep, sleep, CopySleep, ct);
        await UpsertAsync(db.DailyScores, scores, CopyScore, ct);
        await UpsertAsync(db.DailyHealth, health, CopyHealth, ct);
        await db.SaveChangesAsync(ct);
        await ReplaceTagsAsync(start, end, DemoTags(start, end, now), ct);

        return new SyncResult(activity.Count, sleep.Count, scores.Count, health.Count, []);
    }

    /// <summary>
    /// A sprinkling of the tags people commonly log: weekend drinks, the occasional late meal or
    /// sick spell (which spans days), and now and then a custom tag with a comment.
    /// </summary>
    private static List<OuraTag> DemoTags(DateOnly start, DateOnly end, DateTimeOffset now)
    {
        var rng = new Random(31);
        var tags = new List<OuraTag>();
        OuraTag Tag(DateOnly day, string code, string? customName = null, string? comment = null, DateOnly? endDay = null) =>
            new()
            {
                Id = $"demo-{day:yyyyMMdd}-{tags.Count}",
                TagTypeCode = code,
                CustomName = customName,
                Comment = comment,
                StartDay = day,
                EndDay = endDay,
                UpdatedAt = now,
            };

        for (var day = start; day <= end; day = day.AddDays(1))
        {
            var weekend = day.DayOfWeek is DayOfWeek.Friday or DayOfWeek.Saturday;
            if (rng.NextDouble() < (weekend ? 0.45 : 0.08)) tags.Add(Tag(day, "tag_generic_alcohol"));
            if (rng.NextDouble() < 0.12) tags.Add(Tag(day, "tag_generic_late_meal"));
            if (rng.NextDouble() < 0.1) tags.Add(Tag(day, "tag_generic_caffeine"));
            if (rng.NextDouble() < 0.06) tags.Add(Tag(day, "tag_generic_meditation"));
            if (rng.NextDouble() < 0.01)
                tags.Add(Tag(day, "tag_generic_sick", endDay: day.AddDays(rng.Next(2, 5))));
            if (rng.NextDouble() < 0.02)
                tags.Add(Tag(day, "custom", customName: "Travel", comment: "Different time zone"));
        }
        return tags;
    }

    /// <summary>
    /// Generates a ring battery trace every 30 minutes over [from, to): a slow drain that's faster
    /// by day, and a charge of about an hour and a half whenever the ring runs low.
    /// </summary>
    public async Task<BatterySyncResult> SeedBatteryDemoAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var rng = new Random(23);
        var now = DateTimeOffset.UtcNow;
        if (to > now) to = now; // a ring can't have reported a reading that hasn't happened yet
        var step = TimeSpan.FromMinutes(30);
        var readings = new List<RingBatteryReading>();
        var level = 80.0;
        var charging = false;
        var chargeBelow = 12 + rng.Next(14); // people top up at different levels

        for (var t = from; t < to; t += step)
        {
            if (charging)
            {
                level = Math.Min(100, level + 22 + rng.NextDouble() * 6);
                if (level >= 100) { charging = false; chargeBelow = 12 + rng.Next(14); }
            }
            else
            {
                var hour = t.ToLocalTime().Hour;
                var awake = hour is >= 7 and < 23;
                level = Math.Max(0, level - (awake ? 0.45 : 0.25) - rng.NextDouble() * 0.2);
                if (level <= chargeBelow) charging = true;
            }

            readings.Add(new RingBatteryReading
            {
                TimestampMs = t.ToUnixTimeMilliseconds(),
                Level = (int)Math.Round(level),
                Charging = charging,
                InCharger = charging,
                UpdatedAt = now,
            });
        }

        await ReplaceBatteryAsync(from, to, readings, ct);
        return new BatterySyncResult(readings.Count);
    }

    /// <summary>
    /// The incoming samples become the whole record for [from, to): a time series has no natural
    /// "day" to upsert by, and a resync should drop samples Oura no longer reports.
    /// </summary>
    private async Task ReplaceBatteryAsync(DateTimeOffset from, DateTimeOffset to, List<RingBatteryReading> readings, CancellationToken ct)
    {
        var fromMs = from.ToUnixTimeMilliseconds();
        var toMs = to.ToUnixTimeMilliseconds();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.RingBatteryReadings
            .Where(r => r.TimestampMs >= fromMs && r.TimestampMs < toMs)
            .ExecuteDeleteAsync(ct);
        db.RingBatteryReadings.AddRange(readings.Where(r => r.TimestampMs >= fromMs && r.TimestampMs < toMs));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>Inserts new days and overwrites existing ones in place. Caller saves changes.</summary>
    private static async Task UpsertAsync<T>(DbSet<T> set, List<T> rows, Action<T, T> copy, CancellationToken ct)
        where T : class, IDailyRow
    {
        if (rows.Count == 0) return;

        var min = rows.Min(r => r.Day);
        var max = rows.Max(r => r.Day);
        var existing = await set
            .Where(x => EF.Property<DateOnly>(x, "Day") >= min && EF.Property<DateOnly>(x, "Day") <= max)
            .ToDictionaryAsync(x => x.Day, ct);

        foreach (var row in rows)
        {
            if (existing.TryGetValue(row.Day, out var current)) copy(row, current);
            else set.Add(row);
        }
    }

    private static void CopyActivity(DailyActivity from, DailyActivity to)
    {
        to.Steps = from.Steps;
        to.ActiveCalories = from.ActiveCalories;
        to.TotalCalories = from.TotalCalories;
        to.Score = from.Score;
        to.HighActivitySeconds = from.HighActivitySeconds;
        to.MediumActivitySeconds = from.MediumActivitySeconds;
        to.LowActivitySeconds = from.LowActivitySeconds;
        to.SedentarySeconds = from.SedentarySeconds;
        to.RestingSeconds = from.RestingSeconds;
        to.NonWearSeconds = from.NonWearSeconds;
        to.EquivalentWalkingDistanceMeters = from.EquivalentWalkingDistanceMeters;
        to.TargetMeters = from.TargetMeters;
        to.OuraId = from.OuraId;
        to.UpdatedAt = from.UpdatedAt;
    }

    private static void CopyScore(DailyScore from, DailyScore to)
    {
        to.SleepScore = from.SleepScore;
        to.ReadinessScore = from.ReadinessScore;
        to.TemperatureDeviation = from.TemperatureDeviation;
        to.TemperatureTrendDeviation = from.TemperatureTrendDeviation;
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
        to.LatencySeconds = from.LatencySeconds;
        to.Efficiency = from.Efficiency;
        to.BedtimeStartOffsetSeconds = from.BedtimeStartOffsetSeconds;
        to.BedtimeEndOffsetSeconds = from.BedtimeEndOffsetSeconds;
        to.LowestHeartRate = from.LowestHeartRate;
        to.AverageHeartRate = from.AverageHeartRate;
        to.MaxHeartRate = from.MaxHeartRate;
        to.AverageHrv = from.AverageHrv;
        to.MaxHrv = from.MaxHrv;
        to.AverageBreath = from.AverageBreath;
        to.UpdatedAt = from.UpdatedAt;
    }

    private static void CopyHealth(DailyHealth from, DailyHealth to)
    {
        to.Spo2Average = from.Spo2Average;
        to.BreathingDisturbanceIndex = from.BreathingDisturbanceIndex;
        to.StressHighSeconds = from.StressHighSeconds;
        to.RecoveryHighSeconds = from.RecoveryHighSeconds;
        to.HeartRateAverage = from.HeartRateAverage;
        to.HeartRateMin = from.HeartRateMin;
        to.HeartRateMax = from.HeartRateMax;
        to.UpdatedAt = from.UpdatedAt;
    }
}
