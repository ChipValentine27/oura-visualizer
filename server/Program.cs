using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Data;
using OuraViz.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(
        new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

builder.Services.AddDbContext<OuraDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Oura")));

// Encrypts the stored Oura tokens. A fixed application name keeps the key ring stable
// across runs; on Windows the keys live under %LOCALAPPDATA%\ASP.NET\DataProtection-Keys.
builder.Services.AddDataProtection().SetApplicationName("OuraViz");

builder.Services.Configure<OuraOptions>(builder.Configuration.GetSection("Oura"));

var ouraApi = new Uri("https://api.ouraring.com/");
builder.Services.AddHttpClient(OuraTokenService.HttpClientName, c => c.BaseAddress = ouraApi);
builder.Services.AddHttpClient<OuraClient>(c => c.BaseAddress = ouraApi);
builder.Services.AddScoped<OuraTokenService>();
builder.Services.AddScoped<OuraSyncService>();

var app = builder.Build();

// Apply pending EF Core migrations on startup so the SQLite file is always current.
using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<OuraDbContext>().Database.Migrate();
}

// In production the built React app is served from wwwroot.
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();
app.MapFallbackToFile("index.html");

app.Run();
