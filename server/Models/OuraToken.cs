namespace OuraViz.Api.Models;

/// <summary>
/// The single Oura OAuth connection for this app. Tokens are encrypted with
/// ASP.NET Core Data Protection before they are written to SQLite.
/// </summary>
public class OuraToken
{
    /// <summary>Always <see cref="SingletonId"/>; the app connects to one Oura account.</summary>
    public int Id { get; set; }
    public required string EncryptedAccessToken { get; set; }
    public required string EncryptedRefreshToken { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public string? Scope { get; set; }
    public DateTimeOffset ConnectedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public const int SingletonId = 1;
}
