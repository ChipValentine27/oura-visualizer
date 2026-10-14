namespace OuraViz.Api.Models;

/// <summary>
/// One row per calendar day, mirroring Oura's v2 daily_activity document.
/// Only the fields we chart today are stored; add columns as new visualizations need them.
/// </summary>
public class DailyActivity
{
    public DateOnly Day { get; set; }
    public int Steps { get; set; }
    public int ActiveCalories { get; set; }
    public int TotalCalories { get; set; }
    public int? Score { get; set; }

    /// <summary>Oura's document id, or null for demo data.</summary>
    public string? OuraId { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
