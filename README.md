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
Click **Load demo data** to explore the UI with three years of synthetic steps and sleep.

## Views

All views share the date range (From/To and the 30D/90D/1Y/3Y presets) and the
Daily/Weekly/Monthly/Yearly interval.

- **Steps**: total steps per period, or the daily average (10K goal line).
- **Sleep**: total sleep per period, or the nightly average (8h goal line).
  A day's sleep is the sum of Oura's sleep periods for that day (main sleep
  plus naps); "rest" periods are excluded.
- **Steps + Sleep**: grouped bars on one chart showing how far each period is
  above (+) or below (−) that metric's **median for the selected date range**:
  `(value − median) / median`. The median is taken over the daily values in the
  range (days without data are skipped); for weekly and longer intervals each
  bucket's per-day average is compared against it. Changing the date range
  changes the median. Using a shared percentage scale instead of two y-axes
  keeps the comparison honest; the tooltip and table show the raw values.
  - Checkboxes above the chart add or remove each series (at least one stays on);
    the stats, heading and table follow the selection.
  - Hovering a bar darkens it, fades the other series, and highlights its row
    in the tooltip. Hovering the gap between bars shows the whole period.

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
| GET  | `/api/metrics/{steps\|sleep}?start=&end=&interval=daily\|weekly\|monthly\|yearly` | Bucketed totals + per-day averages, plus the range's daily median (sleep in seconds) |
| GET  | `/api/metrics/range` | First/last day stored, activity days and sleep nights |
| GET  | `/api/oura/status` | Client configured? Connected? Token expiry |
| GET  | `/api/oura/connect` | Starts OAuth (browser navigation, redirects to Oura) |
| GET  | `/api/oura/callback` | OAuth redirect target; returns to `/?oura=connected\|error` |
| POST | `/api/oura/disconnect` | Revoke and forget the Oura tokens |
| POST | `/api/sync/oura?start=&end=` | Pull daily activity and sleep from Oura (409 if not connected) |
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
