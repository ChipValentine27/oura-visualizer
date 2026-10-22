using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OuraViz.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMoreMetrics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "AverageBreath",
                table: "DailySleep",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "AverageHeartRate",
                table: "DailySleep",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AverageHrv",
                table: "DailySleep",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BedtimeEndOffsetSeconds",
                table: "DailySleep",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BedtimeStartOffsetSeconds",
                table: "DailySleep",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Efficiency",
                table: "DailySleep",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LatencySeconds",
                table: "DailySleep",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LowestHeartRate",
                table: "DailySleep",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "MaxHeartRate",
                table: "DailySleep",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "MaxHrv",
                table: "DailySleep",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "TemperatureDeviation",
                table: "DailyScores",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "TemperatureTrendDeviation",
                table: "DailyScores",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "EquivalentWalkingDistanceMeters",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HighActivitySeconds",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LowActivitySeconds",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MediumActivitySeconds",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MetersToTarget",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NonWearSeconds",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RestingSeconds",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SedentarySeconds",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TargetMeters",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DailyHealth",
                columns: table => new
                {
                    Day = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    Spo2Average = table.Column<double>(type: "REAL", nullable: true),
                    BreathingDisturbanceIndex = table.Column<int>(type: "INTEGER", nullable: true),
                    StressHighSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    RecoveryHighSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    OptimalBedtimeStartOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    OptimalBedtimeEndOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    HeartRateAverage = table.Column<double>(type: "REAL", nullable: true),
                    HeartRateMin = table.Column<int>(type: "INTEGER", nullable: true),
                    HeartRateMax = table.Column<int>(type: "INTEGER", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyHealth", x => x.Day);
                });

            migrationBuilder.CreateTable(
                name: "DailyTimings",
                columns: table => new
                {
                    Day = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    WorkoutStartOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    WorkoutEndOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    SessionStartOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    SessionEndOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    RestModeStartOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    RestModeEndOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyTimings", x => x.Day);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyHealth");

            migrationBuilder.DropTable(
                name: "DailyTimings");

            migrationBuilder.DropColumn(
                name: "AverageBreath",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "AverageHeartRate",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "AverageHrv",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "BedtimeEndOffsetSeconds",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "BedtimeStartOffsetSeconds",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "Efficiency",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "LatencySeconds",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "LowestHeartRate",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "MaxHeartRate",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "MaxHrv",
                table: "DailySleep");

            migrationBuilder.DropColumn(
                name: "TemperatureDeviation",
                table: "DailyScores");

            migrationBuilder.DropColumn(
                name: "TemperatureTrendDeviation",
                table: "DailyScores");

            migrationBuilder.DropColumn(
                name: "EquivalentWalkingDistanceMeters",
                table: "DailyActivities");

            migrationBuilder.DropColumn(
                name: "HighActivitySeconds",
                table: "DailyActivities");

            migrationBuilder.DropColumn(
                name: "LowActivitySeconds",
                table: "DailyActivities");

            migrationBuilder.DropColumn(
                name: "MediumActivitySeconds",
                table: "DailyActivities");

            migrationBuilder.DropColumn(
                name: "MetersToTarget",
                table: "DailyActivities");

            migrationBuilder.DropColumn(
                name: "NonWearSeconds",
                table: "DailyActivities");

            migrationBuilder.DropColumn(
                name: "RestingSeconds",
                table: "DailyActivities");

            migrationBuilder.DropColumn(
                name: "SedentarySeconds",
                table: "DailyActivities");

            migrationBuilder.DropColumn(
                name: "TargetMeters",
                table: "DailyActivities");
        }
    }
}
