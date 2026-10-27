using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;

namespace OuraViz.Api.Controllers;

[ApiController]
[Route("api/tags")]
public class TagsController(OuraDbContext db) : ControllerBase
{
    /// <summary>
    /// GET /api/tags?start=2025-01-01&amp;end=2025-12-31 — every stored tag that covers any day in
    /// [start, end], in start order. A tag with no end day covers only its start day.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<TagResponse>>> Get([FromQuery] DateOnly start, [FromQuery] DateOnly end, CancellationToken ct)
    {
        if (end < start) return BadRequest("end must be on or after start.");

        var tags = await db.Tags.AsNoTracking()
            .Where(t => t.StartDay <= end && (t.EndDay ?? t.StartDay) >= start)
            .ToListAsync(ct);

        return tags
            .OrderBy(t => t.StartDay).ThenBy(t => t.StartTime)
            .Select(t => new TagResponse(
                t.Id, Label(t.TagTypeCode, t.CustomName), t.TagTypeCode, t.Comment,
                t.StartDay, t.EndDay ?? t.StartDay, t.StartTime, t.EndTime))
            .ToList();
    }

    /// <summary>
    /// A custom tag's own name, else Oura's code made readable: "tag_generic_late_meal" becomes
    /// "Late meal", "tag_sleep_aid_melatonin" becomes "Sleep aid melatonin".
    /// </summary>
    private static string Label(string? code, string? customName)
    {
        if (!string.IsNullOrWhiteSpace(customName)) return customName.Trim();
        if (string.IsNullOrWhiteSpace(code)) return "Tag";

        var words = code;
        foreach (var prefix in new[] { "tag_generic_", "tag_" })
        {
            if (words.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                words = words[prefix.Length..];
                break;
            }
        }
        words = words.Replace('_', ' ').Trim();
        return words.Length == 0 ? "Tag" : char.ToUpper(words[0], CultureInfo.InvariantCulture) + words[1..];
    }
}

/// <summary>EndDay is the last day the tag covers (its start day when Oura gave no end).</summary>
public record TagResponse(
    string Id, string Label, string? Code, string? Comment,
    DateOnly StartDay, DateOnly EndDay, DateTimeOffset? StartTime, DateTimeOffset? EndTime);
