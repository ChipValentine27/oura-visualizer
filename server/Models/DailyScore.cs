namespace OuraViz.Api.Models;

/// <summary>
/// Oura's 0–100 daily sleep and readiness scores (from the daily_sleep and daily_readiness
/// collections), plus readiness's body temperature readings. The activity score lives on
/// <see cref="DailyActivity.Score"/>, since it comes with the activity document.
/// </summary>
public class DailyScore : IDailyRow
{
    public DateOnly Day { get; set; }
    public int? SleepScore { get; set; }
    public int? ReadinessScore { get; set; }

    /// <summary>°C from the user's baseline, not an absolute temperature.</summary>
    public double? TemperatureDeviation { get; set; }
    /// <summary>°C; the trend of <see cref="TemperatureDeviation"/> over recent days.</summary>
    public double? TemperatureTrendDeviation { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
