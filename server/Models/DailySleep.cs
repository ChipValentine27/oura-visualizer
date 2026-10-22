namespace OuraViz.Api.Models;

/// <summary>
/// Sleep for one Oura "day" (the day you wake up). Durations are seconds, summed across that
/// day's sleep periods (main sleep plus naps; "rest" and deleted periods are excluded).
/// The nightly averages and bedtimes come from the day's longest period only, since averaging
/// a nap's heart rate into the night's would blur it. Nullable columns are null when Oura
/// didn't report them, or for days synced before they were added.
/// </summary>
public class DailySleep : IDailyRow
{
    public DateOnly Day { get; set; }
    public int TotalSleepSeconds { get; set; }
    public int TimeInBedSeconds { get; set; }
    public int DeepSleepSeconds { get; set; }
    public int RemSleepSeconds { get; set; }
    public int LightSleepSeconds { get; set; }
    public int AwakeSeconds { get; set; }

    /// <summary>How many sleep periods (main sleep + naps) were summed into this day.</summary>
    public int PeriodCount { get; set; }

    /// <summary>Time to fall asleep, in seconds.</summary>
    public int? LatencySeconds { get; set; }
    /// <summary>Percent of time in bed spent asleep (0–100).</summary>
    public int? Efficiency { get; set; }

    /// <summary>
    /// When the main period started and ended, as seconds from local midnight on <see cref="Day"/>
    /// (negative for a bedtime the evening before), so values average and compare in a line.
    /// </summary>
    public int? BedtimeStartOffsetSeconds { get; set; }
    public int? BedtimeEndOffsetSeconds { get; set; }

    public int? LowestHeartRate { get; set; }
    public double? AverageHeartRate { get; set; }
    /// <summary>Highest 5-minute heart rate in the night's heart_rate series.</summary>
    public double? MaxHeartRate { get; set; }
    /// <summary>Milliseconds.</summary>
    public int? AverageHrv { get; set; }
    /// <summary>Highest 5-minute HRV in the night's hrv series, in milliseconds.</summary>
    public double? MaxHrv { get; set; }
    /// <summary>Breaths per minute.</summary>
    public double? AverageBreath { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
