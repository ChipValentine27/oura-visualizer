using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OuraViz.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveTimingMetrics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyTimings");

            migrationBuilder.DropColumn(
                name: "OptimalBedtimeEndOffsetSeconds",
                table: "DailyHealth");

            migrationBuilder.DropColumn(
                name: "OptimalBedtimeStartOffsetSeconds",
                table: "DailyHealth");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "OptimalBedtimeEndOffsetSeconds",
                table: "DailyHealth",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OptimalBedtimeStartOffsetSeconds",
                table: "DailyHealth",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DailyTimings",
                columns: table => new
                {
                    Day = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    RestModeEndOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    RestModeStartOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    SessionEndOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    SessionStartOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    WorkoutEndOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    WorkoutStartOffsetSeconds = table.Column<int>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyTimings", x => x.Day);
                });
        }
    }
}
