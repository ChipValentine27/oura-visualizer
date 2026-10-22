# Oura Visualizer

ASP.NET Core (.NET 10) API + React (Vite, TypeScript, Recharts) + SQLite (EF Core).

```
server/   ASP.NET Core Web API, EF Core + SQLite (oura.db), Oura API client
client/   React app; dev server proxies /api to the backend
```

## Run (development)

```bash
dotnet tool restore
dotnet run --project server --launch-profile http   # http://localhost:5080
npm --prefix client install
npm --prefix client run dev                         # http://localhost:5173
```

The database is created and migrated automatically on startup.
Click **Load demo data** to explore the UI with three years of synthetic data
for every metric. It overwrites those days in the database, including any real
data you've synced for them.

## Health Visualizer

The app has two tabs, **Health Visualizer** and **[Battery Life](#battery-life)**,
which share the date range and interval. The open tab is remembered in this
browser.

**Health Visualizer** shows up to **4 metrics at once** as
grouped bars on one chart, on a shared percentage scale. It uses the date range
(From/To and the 30D/90D/1Y/3Y presets) and the Daily/Weekly/Monthly/Yearly
interval.

Metrics are grouped into four categories in the metric picker (`CATEGORIES`
and the definitions in `client/src/metrics.ts`):

| Category | Metrics | Source (Oura API v2) |
|---|---|---|
| Sleep | Sleep, deep, light and REM sleep, awake time, time in bed, time to fall asleep (seconds) | `sleep` periods |
| | Sleep efficiency (%) | `sleep.efficiency` |
| | Sleep score (0–100) | `daily_sleep.score` |
| | Bedtime, wake time (clock time) | `sleep.bedtime_start`, `bedtime_end` |
| Readiness | Readiness (0–100) | `daily_readiness.score` |
| | Temperature deviation, temperature trend (°C from baseline) | `daily_readiness` |
| | High stress time, high recovery time (seconds) | `daily_stress.stress_high`, `recovery_high` |
| Activity | Steps, activity score (0–100) | `daily_activity` |
| | Walking distance, activity target (meters) | `equivalent_walking_distance`, `target_meters` |
| | High/medium/low activity, sedentary, resting and non-wear time (seconds) | `daily_activity` |
| Heart & breathing | Heart rate 24h average/low/high (bpm) | `heartrate` samples, by local day |
| | Lowest, average and peak sleep heart rate (bpm) | `sleep.lowest_heart_rate`, `average_heart_rate`, max of `heart_rate.items` |
| | HRV, peak HRV (ms) | `sleep.average_hrv`, max of `hrv.items` |
| | Breathing rate (breaths/min) | `sleep.average_breath` |
| | Blood oxygen (%), breathing disturbance (index) | `daily_spo2` |

- Sleep durations are summed over the day's periods (main sleep plus naps;
  "rest" periods excluded). Efficiency, latency, bedtimes, heart rate, HRV and
  breathing come from the day's longest period.
- Clock times are stored as seconds from local midnight on the record's day
  (negative for a bedtime the evening before) so they average cleanly.
- The nightly heart rate and HRV series are reduced to their peak per night; the
  chart works in days, so the 5-minute series themselves aren't charted.
- Days without a value are skipped, not counted as zero.

A **Compare to** toggle picks the baseline:

- **Average** (default): how far each period is above (+) or below (−) that
  metric's **mean for the selected date range**: `(value − mean) / mean`. The
  mean is taken over the daily values in the range (days without data are
  skipped), so changing the date range changes it. Clock times and temperature
  deviations sit around zero or on a clock, where a ratio means nothing, so they
  show the plain difference instead, with ±100% = 1 hour or 1 °C.
- **Daily goal**: each value as a percentage of its daily goal, on a 0%–100%
  scale with a Goal line at 100%; the scale extends in 25% steps only when a bar
  goes past the goal.
  - Clock times and temperature deviations can't have a goal (marked "avg only"
    in the picker). In this mode they can't be picked, and any already shown stay
    selected but sit out the chart until you switch back to Average.
  - Each shown metric's chip has an editable **Goal** box. Until you type one,
    most metrics follow the average for the selected period (marked "avg"), and
    scores and percentages use 100, so a score of 82 reads as 82%. Durations take
    "7h 30m", "45m" or "7:30"; a plain number is hours for long durations (sleep,
    time in bed) and minutes for short ones (latency, stress). Distances take
    "8 km" or "8000 m"; other units take a number, optionally with the unit.
  - Enter or clicking away saves, Escape cancels, unreadable text is flagged and
    not applied. **Use average** / **Use 100** (or clearing the box) goes back
    to the default.
  - Typed goals are remembered in this browser (localStorage).
- **Unit**: the actual values, on an axis in their own unit (hours for
  durations, clock times, steps, bpm...), starting at zero. The picker's tabs
  switch from categories to units (`UNITS` in `client/src/metrics.ts`; units
  with a single metric, such as steps, get no tab), and the
  chart shows one unit at a time: that of the first selected metric. Metrics of
  the same unit can be added alongside; picking one of another unit switches the
  chart to that unit and replaces the metrics shown. Metrics of other units
  already selected when you switch to Unit stay selected but sit out the chart
  (marked "Different unit").

For weekly and longer intervals each bucket's per-day average is compared.
Using a shared percentage scale, or one unit at a time, instead of two y-axes
keeps the comparison honest; the tooltip and records show the raw values.

- **Show metrics** / **Hide metrics** opens the picker: one tab per category
  (per unit in Unit mode), each showing how many of its metrics are on the
  chart. At least one and at most four stay on (`MAX_VISIBLE_METRICS` in
  `client/src/metrics.ts`); the others are disabled once four are on. Only shown
  metrics are fetched. The chips, stats, heading and records follow the
  selection, which is remembered in this browser.
- **Show records** / **Hide records** lists the values behind each bar.
- The swatch in each chip opens a picker with 10 colors (the 8-color validated
  categorical palette plus lime and cyan, each with light- and dark-theme values
  in `client/src/index.css`). There are more metrics than colors, so colors only
  have to differ among the metrics on the chart: a metric that joins with a color
  already in use gets the first free one. Choices are remembered in this browser.
- Hovering a bar darkens it, fades the other metrics, and highlights its row in
  the tooltip. Hovering the gap between bars shows the whole period.

## Battery Life

The **Battery Life** tab uses the same From/To dates and Daily/Weekly/Monthly/
Yearly interval as the Health Visualizer, but syncs separately: **Sync battery**
(at the right of the tab bar) pulls only ring battery data, and **Sync from
Oura** never touches it.

- Source: Oura API v2 `ring_battery_level`, a time series of samples
  (`timestamp`, `level` 0–100%, `charging`, `in_charger`), requested in 7-day
  windows and stored in the `RingBatteryReadings` table.
- Only the battery % Oura reports is shown, plus its average, lowest and highest;
  nothing else is derived. Everything is on a fixed 0–100% scale, and a gap of
  more than 3 hours between readings breaks the line.
- **Up to 31 days:** a line of the reported readings over time; the interval sets
  where the time axis is labelled. Levels are whole percents, so a slow drain
  arrives as stairs; to keep the line smooth, each short run of equal readings
  is drawn at its middle reading (runs over 2 hours, real plateaus, keep their
  first and last). Every plotted point is a real reading.
- **Longer ranges:** a reading-by-reading line would be a solid smear, so each
  period's average is drawn as a line over a band from its lowest to highest
  reading. If the interval would give more than 120 periods (a year by day, say)
  the chart steps up to the next coarser interval and says so.
- Stats: the latest reading, and the average, lowest and highest reported level
  in the range (over every reading, never the thinned set).
- **Show table** lists the average, lowest and highest level and the reading
  count for each period charted. Readings are grouped by your
  local days (the browser's time zone), in the same calendar buckets as the
  health metrics (ISO weeks, clipped at the range edges).
- **Load demo battery** seeds a synthetic year of battery data up to now,
  replacing what is stored for that time.
- If Oura still answers battery requests with 401 after a token refresh, the
  sync reports that the Oura app isn't permitted to read battery data, and the
  connection is kept.

## Connecting your Oura data

The app signs in to Oura with OAuth2 and manages tokens itself, so you never
paste an access token.

1. Register an app at https://cloud.ouraring.com/oauth/applications and add this
   redirect URI exactly (development goes through the Vite proxy):
   `http://localhost:5173/api/oura/callback`
2. Store the app's client ID and secret with user secrets (these don't expire):

   ```bash
   dotnet user-secrets set Oura:ClientId <client-id> --project server
   dotnet user-secrets set Oura:ClientSecret <client-secret> --project server
   ```

3. Restart the API, click **Connect Oura**, and approve access on Oura's page.
4. Pick a date range and click **Sync from Oura**. Syncs upsert by day, so
   re-syncing a range is safe.
5. Ring battery syncs on its own: click **Sync battery** on the Battery Life
   tab. It replaces the stored samples for the selected days.

How tokens are handled:

- The access and refresh tokens are stored in the `OuraTokens` table, encrypted
  with ASP.NET Core Data Protection (keys under `%LOCALAPPDATA%\ASP.NET\DataProtection-Keys`).
- Before each Oura call the access token is refreshed if it expires within
  5 minutes; a 401 from Oura forces one refresh and retry. Refreshes are
  serialized and the newest refresh token is always saved, since Oura may
  rotate it on every use.
- If Oura rejects the refresh token, or the stored tokens can't be decrypted
  (for example, the database was copied to another machine), the connection is
  cleared and the UI shows **Connect Oura** again.
- **Disconnect Oura** revokes the grant at Oura (best effort) and deletes the
  stored tokens.

Other settings in the `Oura` section: `Scopes` (default
`daily heartrate spo2Daily ring_configuration`, the last for battery; reconnect
after changing it; a health sync skips, and reports, any collection the
connection has no scope for) and `RedirectUri` (when empty, derived from the request as
`{scheme}://{host}/api/oura/callback`; set it for production to match what you
registered).

## API

| Method | Route | Purpose |
|---|---|---|
| GET  | `/api/metrics/{metric}?start=&end=&interval=daily\|weekly\|monthly\|yearly` | Bucketed totals + per-day averages, plus the range's daily mean, in the response's `unit`. `{metric}` is any `MetricId` in `client/src/api.ts` (`steps`, `bedtimeStart`, `spo2`...) |
| GET  | `/api/metrics/range` | First/last day stored, activity days and sleep nights |
| GET  | `/api/oura/status` | Client configured? Connected? Token expiry |
| GET  | `/api/oura/connect` | Starts OAuth (browser navigation, redirects to Oura) |
| GET  | `/api/oura/callback` | OAuth redirect target; returns to `/?oura=connected\|error` |
| POST | `/api/oura/disconnect` | Revoke and forget the Oura tokens |
| POST | `/api/sync/oura?start=&end=` | Pull every supported collection from Oura (409 if not connected); `skipped` lists collections the connection has no scope for |
| POST | `/api/sync/demo?start=&end=` | Seed synthetic data |
| GET  | `/api/battery?start=&end=&interval=daily\|weekly\|monthly\|yearly&timeZone=` | Reported battery readings for the range (local days in `timeZone`, an IANA id), plus average/lowest/highest level for the range and per bucket; `includeReadings=false` returns only the stats and buckets |
| POST | `/api/sync/battery?from=&to=` | Pull ring battery samples from Oura (separate from `/api/sync/oura`); 403 if Oura refuses battery access |
| POST | `/api/sync/battery/demo?from=&to=` | Seed a synthetic battery trace (one sample every 30 minutes) |

The battery sync routes take ISO 8601 instants with an offset
(`2025-03-01T00:00:00-05:00`) because Oura serves battery as a time series; the
client sends local midnights.

Weeks are ISO weeks (Monday start). Buckets that straddle the chosen range are
clipped to it, so compare partial periods with **Daily avg** rather than **Total**.

## Adding a schema change

```bash
dotnet ef migrations add <Name> --project server -o Data/Migrations
```

## Production build

`npm --prefix client run build` writes the bundle into `server/wwwroot`, which
the API serves, so `dotnet publish server` produces a single deployable app.
