using Microsoft.AspNetCore.Mvc;
using OuraViz.Api.Services;

namespace OuraViz.Api.Controllers;

[ApiController]
[Route("api/sync")]
public class SyncController(OuraSyncService sync) : ControllerBase
{
    /// <summary>POST /api/sync/oura?start=2024-01-01&amp;end=2024-12-31 pulls daily activity and sleep from the Oura API.</summary>
    [HttpPost("oura")]
    public async Task<IActionResult> SyncOura([FromQuery] DateOnly start, [FromQuery] DateOnly end, CancellationToken ct)
    {
        if (end < start) return BadRequest("end must be on or after start.");

        try
        {
            return Ok(await sync.SyncFromOuraAsync(start, end, ct));
        }
        catch (OuraNotConnectedException ex)
        {
            return Problem(ex.Message, statusCode: 409, title: "Oura not connected");
        }
        catch (HttpRequestException ex)
        {
            return Problem($"Oura API request failed: {ex.Message}", statusCode: 502);
        }
    }

    /// <summary>POST /api/sync/demo?start=...&amp;end=... fills the database with synthetic data.</summary>
    [HttpPost("demo")]
    public async Task<IActionResult> SeedDemo([FromQuery] DateOnly start, [FromQuery] DateOnly end, CancellationToken ct)
    {
        if (end < start) return BadRequest("end must be on or after start.");
        return Ok(await sync.SeedDemoAsync(start, end, ct));
    }
}
