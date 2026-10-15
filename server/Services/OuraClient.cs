using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;

namespace OuraViz.Api.Services;

/// <summary>
/// Thin wrapper over the Oura Cloud API v2 (https://cloud.ouraring.com/v2/docs).
/// Access tokens come from <see cref="OuraTokenService"/>, which keeps them fresh.
/// </summary>
public class OuraClient(HttpClient http, OuraTokenService tokens)
{
    public Task<List<OuraDailyActivity>> GetDailyActivityAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraDailyActivity>("daily_activity", start, end, ct);

    /// <summary>One document per day carrying the 0–100 sleep score.</summary>
    public Task<List<OuraDailyScoreDoc>> GetDailySleepAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraDailyScoreDoc>("daily_sleep", start, end, ct);

    /// <summary>One document per day carrying the 0–100 readiness score.</summary>
    public Task<List<OuraDailyScoreDoc>> GetDailyReadinessAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraDailyScoreDoc>("daily_readiness", start, end, ct);

    /// <summary>Individual sleep periods (a night's sleep, naps, rest); several may share a day.</summary>
    public Task<List<OuraSleepPeriod>> GetSleepPeriodsAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraSleepPeriod>("sleep", start, end, ct);

    /// <summary>Reads every page of a /v2/usercollection endpoint for the given day range.</summary>
    private async Task<List<T>> GetCollectionAsync<T>(string collection, DateOnly start, DateOnly end, CancellationToken ct)
    {
        var results = new List<T>();
        string? nextToken = null;

        do
        {
            // Oura treats end_date as exclusive for these collections, so ask for one extra day.
            var url = $"v2/usercollection/{collection}?start_date={start:yyyy-MM-dd}&end_date={end.AddDays(1):yyyy-MM-dd}";
            if (nextToken is not null) url += $"&next_token={Uri.EscapeDataString(nextToken)}";

            var page = await GetAsync<OuraPage<T>>(url, ct);
            results.AddRange(page.Data);
            nextToken = page.NextToken;
        } while (nextToken is not null);

        return results;
    }

    /// <summary>Sends an authorized GET; on a 401 refreshes the token once and retries.</summary>
    private async Task<T> GetAsync<T>(string url, CancellationToken ct)
    {
        var token = await tokens.GetAccessTokenAsync(ct);
        var res = await SendAsync(url, token, ct);

        if (res.StatusCode == HttpStatusCode.Unauthorized)
        {
            res.Dispose();
            token = await tokens.GetAccessTokenAsync(ct, rejectedToken: token);
            res = await SendAsync(url, token, ct);
        }

        using (res)
        {
            if (res.StatusCode == HttpStatusCode.Unauthorized)
                throw new OuraNotConnectedException("Oura rejected the access token. Connect again.");
            res.EnsureSuccessStatusCode();
            return await res.Content.ReadFromJsonAsync<T>(ct)
                ?? throw new InvalidOperationException("Empty response from Oura API.");
        }
    }

    private Task<HttpResponseMessage> SendAsync(string url, string token, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return http.SendAsync(req, ct);
    }
}

public record OuraPage<T>(
    [property: JsonPropertyName("data")] List<T> Data,
    [property: JsonPropertyName("next_token")] string? NextToken);

public record OuraDailyActivity(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("day")] DateOnly Day,
    [property: JsonPropertyName("steps")] int Steps,
    [property: JsonPropertyName("active_calories")] int ActiveCalories,
    [property: JsonPropertyName("total_calories")] int TotalCalories,
    [property: JsonPropertyName("score")] int? Score);

/// <summary>The shared shape of daily_sleep and daily_readiness: a day and its 0–100 score.</summary>
public record OuraDailyScoreDoc(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("day")] DateOnly Day,
    [property: JsonPropertyName("score")] int? Score);

/// <summary>One sleep period. Durations are seconds and may be null for incomplete periods.</summary>
public record OuraSleepPeriod(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("day")] DateOnly Day,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("total_sleep_duration")] int? TotalSleepDuration,
    [property: JsonPropertyName("time_in_bed")] int? TimeInBed,
    [property: JsonPropertyName("deep_sleep_duration")] int? DeepSleepDuration,
    [property: JsonPropertyName("rem_sleep_duration")] int? RemSleepDuration,
    [property: JsonPropertyName("light_sleep_duration")] int? LightSleepDuration,
    [property: JsonPropertyName("awake_time")] int? AwakeTime);
