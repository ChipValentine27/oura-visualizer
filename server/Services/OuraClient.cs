using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;

namespace OuraViz.Api.Services;

/// <summary>
/// Thrown for a collection the connection can't read (usually a scope that wasn't granted).
/// Sync skips that collection instead of failing.
/// </summary>
public class OuraCollectionUnavailableException(string collection, HttpStatusCode status)
    : Exception($"Oura returned {(int)status} for {collection}.")
{
    public string Collection { get; } = collection;
}

/// <summary>
/// Thin wrapper over the Oura Cloud API v2 (https://cloud.ouraring.com/v2/docs).
/// Access tokens come from <see cref="OuraTokenService"/>, which keeps them fresh.
/// </summary>
public class OuraClient(HttpClient http, OuraTokenService tokens, ILogger<OuraClient> logger)
{
    // The heartrate endpoint takes datetimes and rejects long ranges, so it is read in windows.
    private const int HeartRateWindowDays = 30;

    public Task<List<OuraDailyActivity>> GetDailyActivityAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraDailyActivity>("daily_activity", start, end, optional: false, ct);

    /// <summary>One document per day carrying the 0–100 sleep score.</summary>
    public Task<List<OuraDailyScoreDoc>> GetDailySleepAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraDailyScoreDoc>("daily_sleep", start, end, optional: false, ct);

    /// <summary>One document per day carrying the 0–100 readiness score and temperature readings.</summary>
    public Task<List<OuraDailyReadiness>> GetDailyReadinessAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraDailyReadiness>("daily_readiness", start, end, optional: false, ct);

    /// <summary>Individual sleep periods (a night's sleep, naps, rest); several may share a day.</summary>
    public Task<List<OuraSleepPeriod>> GetSleepPeriodsAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraSleepPeriod>("sleep", start, end, optional: false, ct);

    // The collections below need scopes beyond "daily" (or are newer); a connection without
    // them gets OuraCollectionUnavailableException rather than a failed sync.

    public Task<List<OuraDailySpo2>> GetDailySpo2Async(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraDailySpo2>("daily_spo2", start, end, optional: true, ct);

    public Task<List<OuraDailyStress>> GetDailyStressAsync(DateOnly start, DateOnly end, CancellationToken ct) =>
        GetCollectionAsync<OuraDailyStress>("daily_stress", start, end, optional: true, ct);

    /// <summary>All-day heart rate samples (about every 5 minutes) from local midnight on start to the end of end.</summary>
    public async Task<List<OuraHeartRateSample>> GetHeartRateAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var results = new List<OuraHeartRateSample>();
        for (var from = start; from <= end; from = from.AddDays(HeartRateWindowDays))
        {
            var to = from.AddDays(HeartRateWindowDays);
            if (to > end.AddDays(1)) to = end.AddDays(1);
            var query = $"start_datetime={Uri.EscapeDataString(LocalMidnight(from))}&end_datetime={Uri.EscapeDataString(LocalMidnight(to))}";
            results.AddRange(await GetPagesAsync<OuraHeartRateSample>("heartrate", query, optional: true, ct));
        }
        return results;
    }

    private static string LocalMidnight(DateOnly day)
    {
        var local = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Local);
        return new DateTimeOffset(local).ToString("yyyy-MM-ddTHH:mm:sszzz");
    }

    /// <summary>Reads every page of a day-ranged /v2/usercollection endpoint.</summary>
    private Task<List<T>> GetCollectionAsync<T>(string collection, DateOnly start, DateOnly end, bool optional, CancellationToken ct) =>
        // Oura treats end_date as exclusive for these collections, so ask for one extra day.
        GetPagesAsync<T>(collection, $"start_date={start:yyyy-MM-dd}&end_date={end.AddDays(1):yyyy-MM-dd}", optional, ct);

    private async Task<List<T>> GetPagesAsync<T>(string collection, string query, bool optional, CancellationToken ct)
    {
        var results = new List<T>();
        var seenTokens = new HashSet<string>();
        string? nextToken = null;
        var pages = 0;

        do
        {
            var url = $"v2/usercollection/{collection}?{query}";
            if (nextToken is not null) url += $"&next_token={Uri.EscapeDataString(nextToken)}";

            var page = await GetAsync<OuraPage<T>>(url, collection, optional, ct);
            results.AddRange(page.Data);
            pages++;
            nextToken = page.NextToken;

            // A token Oura already handed out would page forever; stop instead.
            if (nextToken is not null && !seenTokens.Add(nextToken))
            {
                logger.LogWarning("Oura repeated a next_token for {Collection}; stopped after {Pages} pages", collection, pages);
                break;
            }
        } while (nextToken is not null);

        logger.LogInformation("Read {Count} {Collection} records in {Pages} request(s) ({Query})", results.Count, collection, pages, query);
        return results;
    }

    /// <summary>
    /// Sends an authorized GET; on a 401 refreshes the token once and retries. For optional
    /// collections a 401/403/404 means the scope wasn't granted, so there's no refresh: the
    /// required collections are read first and have already proven the token good.
    /// </summary>
    private async Task<T> GetAsync<T>(string url, string collection, bool optional, CancellationToken ct)
    {
        var token = await tokens.GetAccessTokenAsync(ct);
        var res = await SendAsync(url, token, ct);

        if (optional && res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound)
        {
            var status = res.StatusCode;
            res.Dispose();
            throw new OuraCollectionUnavailableException(collection, status);
        }

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

/// <summary>Times are seconds; distances are meters.</summary>
public record OuraDailyActivity(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("day")] DateOnly Day,
    [property: JsonPropertyName("steps")] int Steps,
    [property: JsonPropertyName("active_calories")] int ActiveCalories,
    [property: JsonPropertyName("total_calories")] int TotalCalories,
    [property: JsonPropertyName("score")] int? Score,
    [property: JsonPropertyName("high_activity_time")] int? HighActivityTime,
    [property: JsonPropertyName("medium_activity_time")] int? MediumActivityTime,
    [property: JsonPropertyName("low_activity_time")] int? LowActivityTime,
    [property: JsonPropertyName("sedentary_time")] int? SedentaryTime,
    [property: JsonPropertyName("resting_time")] int? RestingTime,
    [property: JsonPropertyName("non_wear_time")] int? NonWearTime,
    [property: JsonPropertyName("equivalent_walking_distance")] int? EquivalentWalkingDistance,
    [property: JsonPropertyName("target_meters")] int? TargetMeters);

/// <summary>The daily_sleep document: a day and its 0–100 score.</summary>
public record OuraDailyScoreDoc(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("day")] DateOnly Day,
    [property: JsonPropertyName("score")] int? Score);

/// <summary>Temperatures are °C deviations from the user's baseline.</summary>
public record OuraDailyReadiness(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("day")] DateOnly Day,
    [property: JsonPropertyName("score")] int? Score,
    [property: JsonPropertyName("temperature_deviation")] double? TemperatureDeviation,
    [property: JsonPropertyName("temperature_trend_deviation")] double? TemperatureTrendDeviation);

/// <summary>A regularly sampled series; null items are gaps.</summary>
public record OuraSampleSeries(
    [property: JsonPropertyName("interval")] double Interval,
    [property: JsonPropertyName("items")] List<double?>? Items,
    [property: JsonPropertyName("timestamp")] DateTimeOffset? Timestamp);

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
    [property: JsonPropertyName("awake_time")] int? AwakeTime,
    [property: JsonPropertyName("latency")] int? Latency,
    [property: JsonPropertyName("efficiency")] int? Efficiency,
    [property: JsonPropertyName("bedtime_start")] DateTimeOffset? BedtimeStart,
    [property: JsonPropertyName("bedtime_end")] DateTimeOffset? BedtimeEnd,
    [property: JsonPropertyName("lowest_heart_rate")] int? LowestHeartRate,
    [property: JsonPropertyName("average_heart_rate")] double? AverageHeartRate,
    [property: JsonPropertyName("average_hrv")] int? AverageHrv,
    [property: JsonPropertyName("average_breath")] double? AverageBreath,
    [property: JsonPropertyName("heart_rate")] OuraSampleSeries? HeartRate,
    [property: JsonPropertyName("hrv")] OuraSampleSeries? Hrv);

public record OuraSpo2Percentage([property: JsonPropertyName("average")] double? Average);

public record OuraDailySpo2(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("day")] DateOnly Day,
    [property: JsonPropertyName("spo2_percentage")] OuraSpo2Percentage? Spo2Percentage,
    [property: JsonPropertyName("breathing_disturbance_index")] int? BreathingDisturbanceIndex);

/// <summary>Seconds of high stress and high recovery.</summary>
public record OuraDailyStress(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("day")] DateOnly Day,
    [property: JsonPropertyName("stress_high")] int? StressHigh,
    [property: JsonPropertyName("recovery_high")] int? RecoveryHigh);

public record OuraHeartRateSample(
    [property: JsonPropertyName("bpm")] int Bpm,
    [property: JsonPropertyName("source")] string? Source,
    [property: JsonPropertyName("timestamp")] DateTimeOffset Timestamp);
