using Microsoft.AspNetCore.Mvc;
using OuraViz.Api.Services;

namespace OuraViz.Api.Controllers;

[ApiController]
[Route("api/sync")]
public class SyncController(OuraSyncService sync) : ControllerBase
{
    // A sync can take minutes and both kinds write the same tables, so only one runs at a time;
    // a second request (another tab, a reload mid-sync) is turned away instead of doubling the
    // calls to Oura.
    private static readonly SemaphoreSlim SyncLock = new(1, 1);

    /// <summary>POST /api/sync/oura?start=2024-01-01&amp;end=2024-12-31 pulls every supported collection from the Oura API.</summary>
    [HttpPost("oura")]
    public async Task<IActionResult> SyncOura([FromQuery] DateOnly start, [FromQuery] DateOnly end, CancellationToken ct)
    {
        if (end < start) return BadRequest("end must be on or after start.");
        if (!await SyncLock.WaitAsync(0, ct)) return AlreadyRunning();

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
        finally
        {
            SyncLock.Release();
        }
    }

    /// <summary>POST /api/sync/demo?start=...&amp;end=... fills the database with synthetic data.</summary>
    [HttpPost("demo")]
    public async Task<IActionResult> SeedDemo([FromQuery] DateOnly start, [FromQuery] DateOnly end, CancellationToken ct)
    {
        if (end < start) return BadRequest("end must be on or after start.");
        if (!await SyncLock.WaitAsync(0, ct)) return AlreadyRunning();

        try
        {
            return Ok(await sync.SeedDemoAsync(start, end, ct));
        }
        finally
        {
            SyncLock.Release();
        }
    }

    private ObjectResult AlreadyRunning() =>
        Problem("A sync is already running. Wait for it to finish, then try again.", statusCode: 409, title: "Sync in progress");
}
