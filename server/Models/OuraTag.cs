namespace OuraViz.Api.Models;

/// <summary>
/// One tag the user added in the Oura app (alcohol, caffeine, a custom tag...), from the
/// enhanced_tag collection. Keyed by Oura's id. A tag covers <see cref="StartDay"/> through
/// <see cref="EndDay"/>, or just the start day when it has no end.
/// </summary>
public class OuraTag
{
    public string Id { get; set; } = "";

    /// <summary>Oura's code for the tag, such as "tag_generic_alcohol", or "custom".</summary>
    public string? TagTypeCode { get; set; }

    /// <summary>The name the user gave a custom tag.</summary>
    public string? CustomName { get; set; }

    public string? Comment { get; set; }
    public DateOnly StartDay { get; set; }
    public DateOnly? EndDay { get; set; }
    public DateTimeOffset? StartTime { get; set; }
    public DateTimeOffset? EndTime { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
