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

The app has a single view, **Health Visualizer**: up to **4 metrics at once** as
grouped bars on one chart, on a shared percentage scale. It uses the date range
(From/To and the 30D/90D/1Y/3Y presets) and the Daily/Weekly/Monthly/Yearly
interval.

Metrics are grouped into four categories in the **Choose metrics** picker
(`CATEGORIES` and the definitions in `client/src/metrics.ts`):

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

For weekly and longer intervals each bucket's per-day average is compared.
Using a shared percentage scale instead of two y-axes keeps the comparison
honest; the tooltip and table show the raw values.

- **Choose metrics** opens the picker: one tab per category, each showing how
  many of its metrics are on the chart. At least one and at most four stay on
  (`MAX_VISIBLE_METRICS` in `client/src/metrics.ts`); the others are disabled
  once four are on. Only shown metrics are fetched. The chips, stats, heading
  and table follow the selection, which is remembered in this browser.
- The swatch in each chip opens a picker with 10 colors (the 8-color validated
  categorical palette plus lime and cyan, each with light- and dark-theme values
  in `client/src/index.css`). There are more metrics than colors, so colors only
  have to differ among the metrics on the chart: a metric that joins with a color
  already in use gets the first free one. Choices are remembered in this browser.
- Hovering a bar darkens it, fades the other metrics, and highlights its row in
  the tooltip. Hovering the gap between bars shows the whole period.

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
`daily heartrate spo2Daily`; reconnect after changing it; a sync
skips, and reports, any collection the connection has no scope for) and `RedirectUri` (when empty, derived from the request as
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

Weeks are ISO weeks (Monday start). Buckets that straddle the chosen range are
clipped to it, so compare partial periods with **Daily avg** rather than **Total**.

## Adding a schema change

```bash
dotnet ef migrations add <Name> --project server -o Data/Migrations
```

## Production build

`npm --prefix client run build` writes the bundle into `server/wwwroot`, which
the API serves, so `dotnet publish server` produces a single deployable app.
