namespace OuraViz.Api.Models;

/// <summary>
/// Oura's 0–100 daily sleep and readiness scores (from the daily_sleep and daily_readiness
/// collections). The activity score lives on <see cref="DailyActivity.Score"/>, since it comes
/// with the activity document.
/// </summary>
public class DailyScore
{
    public DateOnly Day { get; set; }
    public int? SleepScore { get; set; }
    public int? ReadinessScore { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
