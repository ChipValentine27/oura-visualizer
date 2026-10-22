namespace OuraViz.Api.Models;

/// <summary>A table with one row per calendar day, keyed by <see cref="Day"/>.</summary>
public interface IDailyRow
{
    DateOnly Day { get; }
}
