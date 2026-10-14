using System.Net;
using System.Security.Cryptography;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OuraViz.Api.Data;
using OuraViz.Api.Models;

namespace OuraViz.Api.Services;

/// <summary>Thrown when there is no usable Oura connection and the user must (re)connect.</summary>
public class OuraNotConnectedException(string message) : Exception(message);

/// <summary>Oura's token endpoint refused a code or refresh token (invalid_grant and friends).</summary>
public class OuraTokenRejectedException(string message) : Exception(message);

public record OuraConnectionStatus(bool Configured, bool Connected, DateTimeOffset? ExpiresAt, DateTimeOffset? ConnectedAt, string? Scope);

/// <summary>
/// Owns the Oura OAuth2 authorization-code flow: builds the consent URL, exchanges the
/// returned code for tokens, stores them encrypted in SQLite, and refreshes the access
/// token when it is about to expire (or when Oura rejects it).
/// </summary>
public class OuraTokenService(
    OuraDbContext db,
    IHttpClientFactory httpFactory,
    IOptions<OuraOptions> options,
    IDataProtectionProvider dataProtection,
    ILogger<OuraTokenService> logger)
{
    public const string HttpClientName = "OuraAuth";
    private const string AuthorizeUrl = "https://cloud.ouraring.com/oauth/authorize";

    // Refresh a little early so a token never expires mid-sync.
    private static readonly TimeSpan RefreshSkew = TimeSpan.FromMinutes(5);

    // Oura may rotate the refresh token on every use, so two concurrent refreshes would race
    // and one would be left holding a dead token. Serialize them across requests.
    private static readonly SemaphoreSlim RefreshLock = new(1, 1);

    private readonly OuraOptions _options = options.Value;
    private readonly IDataProtector _protector = dataProtection.CreateProtector("OuraViz.OuraTokens.v1");

    public bool IsConfigured => _options.IsConfigured;

    public string ResolveRedirectUri(HttpRequest request) =>
        string.IsNullOrWhiteSpace(_options.RedirectUri)
            ? $"{request.Scheme}://{request.Host}/api/oura/callback"
            : _options.RedirectUri;

    public string BuildAuthorizeUrl(string redirectUri, string state)
    {
        var query = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = _options.ClientId!,
            ["redirect_uri"] = redirectUri,
            ["scope"] = _options.Scopes,
            ["state"] = state,
        };
        return $"{AuthorizeUrl}?{string.Join("&", query.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"))}";
    }

    /// <summary>Completes the consent redirect by trading the one-time code for tokens.</summary>
    public async Task ExchangeCodeAsync(string code, string redirectUri, CancellationToken ct)
    {
        var tokens = await RequestTokensAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
        }, ct);

        var row = await db.OuraTokens.FindAsync([OuraToken.SingletonId], ct);
        var now = DateTimeOffset.UtcNow;
        if (row is null)
        {
            row = new OuraToken
            {
                Id = OuraToken.SingletonId,
                EncryptedAccessToken = "",
                EncryptedRefreshToken = "",
                ConnectedAt = now,
            };
            db.OuraTokens.Add(row);
        }
        else
        {
            row.ConnectedAt = now;
        }

        Apply(row, tokens, previousRefreshToken: null);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Returns a valid access token, refreshing it first if it is close to expiry.
    /// Pass <paramref name="rejectedToken"/> after Oura answered 401 to force a refresh
    /// (skipped if another request has already replaced that token).
    /// </summary>
    public async Task<string> GetAccessTokenAsync(CancellationToken ct, string? rejectedToken = null)
    {
        var row = await db.OuraTokens.FindAsync([OuraToken.SingletonId], ct)
            ?? throw new OuraNotConnectedException("Connect your Oura account first.");

        if (rejectedToken is null && !IsExpiring(row))
            return Unprotect(row.EncryptedAccessToken, row);

        await RefreshLock.WaitAsync(ct);
        try
        {
            // Another request may have refreshed while we waited for the lock.
            await db.Entry(row).ReloadAsync(ct);
            if (db.Entry(row).State == EntityState.Detached) throw new OuraNotConnectedException("Connect your Oura account first.");

            var current = Unprotect(row.EncryptedAccessToken, row);
            var alreadyReplaced = rejectedToken is not null && current != rejectedToken;
            if (!IsExpiring(row) && (rejectedToken is null || alreadyReplaced))
                return current;

            var refreshToken = Unprotect(row.EncryptedRefreshToken, row);
            OuraTokenResponse tokens;
            try
            {
                tokens = await RequestTokensAsync(new Dictionary<string, string>
                {
                    ["grant_type"] = "refresh_token",
                    ["refresh_token"] = refreshToken,
                }, ct);
            }
            catch (OuraTokenRejectedException ex)
            {
                // The refresh token is dead (revoked, expired, or already used). Only a new
                // consent can fix that, so drop the connection and tell the user.
                logger.LogWarning("Oura refused the refresh token ({Error}); clearing the connection.", ex.Message);
                db.OuraTokens.Remove(row);
                await db.SaveChangesAsync(ct);
                throw new OuraNotConnectedException("Your Oura authorization has expired. Connect again.");
            }

            Apply(row, tokens, previousRefreshToken: refreshToken);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Refreshed Oura access token; new expiry {ExpiresAt:u}.", row.ExpiresAt);
            return tokens.AccessToken;
        }
        finally
        {
            RefreshLock.Release();
        }
    }

    public async Task<OuraConnectionStatus> GetStatusAsync(CancellationToken ct)
    {
        var row = await db.OuraTokens.AsNoTracking().FirstOrDefaultAsync(t => t.Id == OuraToken.SingletonId, ct);
        return new OuraConnectionStatus(IsConfigured, row is not null, row?.ExpiresAt, row?.ConnectedAt, row?.Scope);
    }

    /// <summary>Revokes the grant at Oura (best effort) and forgets the stored tokens.</summary>
    public async Task DisconnectAsync(CancellationToken ct)
    {
        var row = await db.OuraTokens.FindAsync([OuraToken.SingletonId], ct);
        if (row is null) return;

        try
        {
            var access = _protector.Unprotect(row.EncryptedAccessToken);
            var http = httpFactory.CreateClient(HttpClientName);
            using var res = await http.GetAsync($"oauth/revoke?access_token={Uri.EscapeDataString(access)}", ct);
            if (!res.IsSuccessStatusCode)
                logger.LogWarning("Oura token revoke returned {Status}.", (int)res.StatusCode);
        }
        catch (Exception ex) when (ex is HttpRequestException or CryptographicException)
        {
            logger.LogWarning(ex, "Could not revoke the Oura token; removing it locally anyway.");
        }

        db.OuraTokens.Remove(row);
        await db.SaveChangesAsync(ct);
    }

    private static bool IsExpiring(OuraToken row) => row.ExpiresAt - RefreshSkew <= DateTimeOffset.UtcNow;

    private void Apply(OuraToken row, OuraTokenResponse tokens, string? previousRefreshToken)
    {
        // Always persist the newest refresh token; if Oura did not send one, keep the old.
        var refresh = tokens.RefreshToken ?? previousRefreshToken
            ?? throw new InvalidOperationException("Oura did not return a refresh token.");

        row.EncryptedAccessToken = _protector.Protect(tokens.AccessToken);
        row.EncryptedRefreshToken = _protector.Protect(refresh);
        row.ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(tokens.ExpiresIn);
        row.Scope = tokens.Scope ?? row.Scope;
        row.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private string Unprotect(string cipherText, OuraToken row)
    {
        try
        {
            return _protector.Unprotect(cipherText);
        }
        catch (CryptographicException)
        {
            // The Data Protection key ring changed (e.g. the database was copied to another
            // machine), so the stored tokens can never be read again.
            db.OuraTokens.Remove(row);
            db.SaveChanges();
            throw new OuraNotConnectedException("Stored Oura tokens could not be decrypted. Connect again.");
        }
    }

    private async Task<OuraTokenResponse> RequestTokensAsync(Dictionary<string, string> form, CancellationToken ct)
    {
        form["client_id"] = _options.ClientId!;
        form["client_secret"] = _options.ClientSecret!;

        var http = httpFactory.CreateClient(HttpClientName);
        using var res = await http.PostAsync("oauth/token", new FormUrlEncodedContent(form), ct);

        if (res.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new OuraTokenRejectedException(body);
        }
        res.EnsureSuccessStatusCode();

        return await res.Content.ReadFromJsonAsync<OuraTokenResponse>(ct)
            ?? throw new InvalidOperationException("Empty token response from Oura.");
    }

    private record OuraTokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn,
        [property: JsonPropertyName("scope")] string? Scope);
}
