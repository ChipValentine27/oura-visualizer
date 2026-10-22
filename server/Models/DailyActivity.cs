namespace OuraViz.Api.Models;

/// <summary>
/// One row per calendar day, mirroring Oura's v2 daily_activity document.
/// Only the fields we chart are stored; add columns as new visualizations need them.
/// Time columns are seconds and distances meters; the nullable ones are null for days
/// synced before they were added.
/// </summary>
public class DailyActivity : IDailyRow
{
    public DateOnly Day { get; set; }
    public int Steps { get; set; }
    public int ActiveCalories { get; set; }
    public int TotalCalories { get; set; }
    public int? Score { get; set; }

    public int? HighActivitySeconds { get; set; }
    public int? MediumActivitySeconds { get; set; }
    public int? LowActivitySeconds { get; set; }
    public int? SedentarySeconds { get; set; }
    public int? RestingSeconds { get; set; }
    public int? NonWearSeconds { get; set; }

    public int? EquivalentWalkingDistanceMeters { get; set; }
    public int? TargetMeters { get; set; }

    /// <summary>Oura's document id, or null for demo data.</summary>
    public string? OuraId { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
