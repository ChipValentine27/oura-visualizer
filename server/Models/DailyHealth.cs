namespace OuraViz.Api.Models;

/// <summary>
/// Other per-day readings, merged from several Oura collections: daily_spo2, daily_stress
/// and the all-day heartrate series. A column is null when its collection had no
/// document for the day, or when the Oura connection lacks that collection's scope.
/// </summary>
public class DailyHealth : IDailyRow
{
    public DateOnly Day { get; set; }

    /// <summary>Average blood oxygen saturation during sleep, percent.</summary>
    public double? Spo2Average { get; set; }
    /// <summary>Unitless index of breathing disturbances during sleep.</summary>
    public int? BreathingDisturbanceIndex { get; set; }

    /// <summary>Seconds spent in high stress / high recovery.</summary>
    public int? StressHighSeconds { get; set; }
    public int? RecoveryHighSeconds { get; set; }

    /// <summary>From the ~5-minute all-day heartrate samples (every source: awake, rest, sleep...).</summary>
    public double? HeartRateAverage { get; set; }
    public int? HeartRateMin { get; set; }
    public int? HeartRateMax { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
