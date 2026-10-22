namespace OuraViz.Api.Models;

/// <summary>
/// One ring battery sample from Oura's ring_battery_level time series. Keyed by the sample's
/// Unix time in milliseconds, which sorts and compares cleanly in SQLite.
/// </summary>
public class RingBatteryReading
{
    public long TimestampMs { get; set; }

    /// <summary>Battery level, 0–100%.</summary>
    public int Level { get; set; }

    public bool? Charging { get; set; }
    public bool? InCharger { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
