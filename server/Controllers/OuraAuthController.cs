using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using OuraViz.Api.Services;

namespace OuraViz.Api.Controllers;

/// <summary>
/// OAuth2 authorization-code flow with Oura. The browser navigates to /connect, Oura asks
/// the user for consent and redirects back to /callback, and the server keeps the tokens.
/// </summary>
[ApiController]
[Route("api/oura")]
public class OuraAuthController(OuraTokenService tokens, ILogger<OuraAuthController> logger) : ControllerBase
{
    private const string StateCookie = "oura_oauth_state";

    [HttpGet("status")]
    public Task<OuraConnectionStatus> Status(CancellationToken ct) => tokens.GetStatusAsync(ct);

    /// <summary>Starts the flow: remember a random state value and send the browser to Oura.</summary>
    [HttpGet("connect")]
    public IActionResult Connect()
    {
        if (!tokens.IsConfigured)
            return Problem("Set Oura:ClientId and Oura:ClientSecret on the server first.", statusCode: 400);

        var state = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        Response.Cookies.Append(StateCookie, state, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            // Lax still sends the cookie on Oura's top-level redirect back to us.
            SameSite = SameSiteMode.Lax,
            MaxAge = TimeSpan.FromMinutes(10),
            Path = "/api/oura",
        });

        return Redirect(tokens.BuildAuthorizeUrl(tokens.ResolveRedirectUri(Request), state));
    }

    /// <summary>Oura redirects here with ?code&amp;state (or ?error). Always ends back on the app's home page.</summary>
    [HttpGet("callback")]
    public async Task<IActionResult> Callback(
        [FromQuery] string? code,
        [FromQuery] string? state,
        [FromQuery] string? error,
        [FromQuery(Name = "error_description")] string? errorDescription,
        CancellationToken ct)
    {
        var expectedState = Request.Cookies[StateCookie];
        Response.Cookies.Delete(StateCookie, new CookieOptions { Path = "/api/oura" });

        if (error is not null)
            return BackToApp("error", error == "access_denied"
                ? "Oura access was declined, so nothing was connected."
                : errorDescription ?? error);

        // The state check stops another site from completing a login into this app.
        if (string.IsNullOrEmpty(expectedState) || state is null ||
            !CryptographicOperations.FixedTimeEquals(Convert.FromHexString(expectedState), SafeFromHex(state)))
            return BackToApp("error", "The sign-in attempt expired or did not match. Try connecting again.");

        if (string.IsNullOrEmpty(code))
            return BackToApp("error", "Oura did not return an authorization code.");

        try
        {
            await tokens.ExchangeCodeAsync(code, tokens.ResolveRedirectUri(Request), ct);
            return BackToApp("connected");
        }
        catch (Exception ex) when (ex is OuraTokenRejectedException or HttpRequestException or InvalidOperationException)
        {
            logger.LogWarning(ex, "Oura code exchange failed.");
            return BackToApp("error", "Oura did not accept the sign-in. Check the client ID, secret and redirect URI.");
        }
    }

    [HttpPost("disconnect")]
    public async Task<IActionResult> Disconnect(CancellationToken ct)
    {
        await tokens.DisconnectAsync(ct);
        return NoContent();
    }

    private RedirectResult BackToApp(string result, string? message = null) =>
        Redirect(message is null ? $"/?oura={result}" : $"/?oura={result}&message={Uri.EscapeDataString(message)}");

    private static byte[] SafeFromHex(string value)
    {
        try { return Convert.FromHexString(value); }
        catch (FormatException) { return []; }
    }
}
