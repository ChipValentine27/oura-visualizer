namespace OuraViz.Api.Services;

/// <summary>Bound from the "Oura" configuration section.</summary>
public class OuraOptions
{
    /// <summary>From your app at https://cloud.ouraring.com/oauth/applications.</summary>
    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }

    /// <summary>
    /// Must match a redirect URI registered on the Oura app exactly. When empty, it is
    /// derived from the incoming request as {scheme}://{host}/api/oura/callback.
    /// </summary>
    public string? RedirectUri { get; set; }

    /// <summary>Space-separated Oura scopes. "daily" covers daily activity, sleep and readiness.</summary>
    public string Scopes { get; set; } = "daily";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}
