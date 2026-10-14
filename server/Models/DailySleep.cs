namespace OuraViz.Api.Models;

/// <summary>
/// Sleep totals for one Oura "day", summed across that day's sleep periods
/// (main sleep plus naps; "rest" and deleted periods are excluded). Durations are seconds.
/// </summary>
public class DailySleep
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
    public DateTimeOffset UpdatedAt { get; set; }
}
