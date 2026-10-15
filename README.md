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
Click **Load demo data** to explore the UI with three years of synthetic steps,
sleep and scores. It overwrites those days in the database, including any real
data you've synced for them.

## Health Visualizer

The app has a single view, **Health Visualizer**: up to **4 metrics at once** as
grouped bars on one chart, on a shared percentage scale. It uses the date range
(From/To and the 30D/90D/1Y/3Y presets) and the Daily/Weekly/Monthly/Yearly
interval.

| Metric | Source (Oura API v2) | Notes |
|---|---|---|
| Steps | `daily_activity.steps` | |
| Sleep | `sleep` periods, `total_sleep_duration` | Sum of the day's periods (main sleep plus naps); "rest" periods excluded |
| Sleep score | `daily_sleep.score` | 0–100 |
| Readiness | `daily_readiness.score` | 0–100 |
| Activity score | `daily_activity.score` | 0–100 |

Days without a score are skipped, not counted as zero.

A **Compare to** toggle picks the baseline:

- **Average** (default): how far each period is above (+) or below (−) that
  metric's **mean for the selected date range**: `(value − mean) / mean`. The
  mean is taken over the daily values in the range (days without data are
  skipped), so changing the date range changes it.
- **Daily goal**: each value as a percentage of its daily goal, on a 0%–100%
  scale with a Goal line at 100%; the scale extends in 25% steps only when a bar
  goes past the goal.
  - Each shown metric's chip has an editable **Goal** box. Until you type one,
    steps and sleep follow the average for the selected period (marked "avg"),
    and the scores use 100, so a score of 82 reads as 82%. Steps take a number
    ("10,000"); sleep takes "7h 30m", "7:30" or hours like "7.5"; scores take
    1–100.
  - Enter or clicking away saves, Escape cancels, unreadable text is flagged and
    not applied. **Use average** / **Use 100** (or clearing the box) goes back
    to the default.
  - Typed goals are remembered in this browser (localStorage).

For weekly and longer intervals each bucket's per-day average is compared.
Using a shared percentage scale instead of two y-axes keeps the comparison
honest; the tooltip and table show the raw values.

- Checkboxes in the chips add or remove each metric: at least one and at most
  four stay on (`MAX_VISIBLE_METRICS` in `client/src/metrics.ts`); the others
  are disabled once four are on. The stats, heading and table follow the
  selection, which is remembered in this browser.
- The swatch in each chip opens a picker with 10 colors (the 8-color validated
  categorical palette plus lime and cyan, each with light- and dark-theme values
  in `client/src/index.css`). Colors used by other metrics can't be picked, so
  no two metrics share a color. Choices are remembered in this browser.
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

Other settings in the `Oura` section: `Scopes` (default `daily`; reconnect after
changing it) and `RedirectUri` (when empty, derived from the request as
`{scheme}://{host}/api/oura/callback`; set it for production to match what you
registered).

## API

| Method | Route | Purpose |
|---|---|---|
| GET  | `/api/metrics/{steps\|sleep\|sleepScore\|readinessScore\|activityScore}?start=&end=&interval=daily\|weekly\|monthly\|yearly` | Bucketed totals + per-day averages, plus the range's daily mean (sleep in seconds, scores 0–100) |
| GET  | `/api/metrics/range` | First/last day stored, activity days and sleep nights |
| GET  | `/api/oura/status` | Client configured? Connected? Token expiry |
| GET  | `/api/oura/connect` | Starts OAuth (browser navigation, redirects to Oura) |
| GET  | `/api/oura/callback` | OAuth redirect target; returns to `/?oura=connected\|error` |
| POST | `/api/oura/disconnect` | Revoke and forget the Oura tokens |
| POST | `/api/sync/oura?start=&end=` | Pull daily activity, sleep, sleep score and readiness from Oura (409 if not connected) |
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
