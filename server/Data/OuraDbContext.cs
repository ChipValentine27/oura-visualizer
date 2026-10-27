using Microsoft.EntityFrameworkCore;
using OuraViz.Api.Models;

namespace OuraViz.Api.Data;

public class OuraDbContext(DbContextOptions<OuraDbContext> options) : DbContext(options)
{
    public DbSet<DailyActivity> DailyActivities => Set<DailyActivity>();
    public DbSet<DailySleep> DailySleep => Set<DailySleep>();
    public DbSet<DailyScore> DailyScores => Set<DailyScore>();
    public DbSet<DailyHealth> DailyHealth => Set<DailyHealth>();
    public DbSet<RingBatteryReading> RingBatteryReadings => Set<RingBatteryReading>();
    public DbSet<OuraTag> Tags => Set<OuraTag>();
    public DbSet<OuraToken> OuraTokens => Set<OuraToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DailyActivity>(e =>
        {
            e.HasKey(x => x.Day);
            e.Property(x => x.OuraId).HasMaxLength(64);
        });

        modelBuilder.Entity<DailySleep>(e => e.HasKey(x => x.Day));
        modelBuilder.Entity<DailyScore>(e => e.HasKey(x => x.Day));
        modelBuilder.Entity<DailyHealth>(e => e.HasKey(x => x.Day));
        modelBuilder.Entity<RingBatteryReading>(e =>
        {
            e.HasKey(x => x.TimestampMs);
            e.Property(x => x.TimestampMs).ValueGeneratedNever();
        });

        modelBuilder.Entity<OuraTag>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(64);
            e.HasIndex(x => x.StartDay);
        });

        modelBuilder.Entity<OuraToken>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
        });
    }
}
