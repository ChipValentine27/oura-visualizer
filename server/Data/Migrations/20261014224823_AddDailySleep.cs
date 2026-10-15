using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OuraViz.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDailySleep : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DailySleep",
                columns: table => new
                {
                    Day = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    TotalSleepSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    TimeInBedSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    DeepSleepSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    RemSleepSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    LightSleepSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    AwakeSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    PeriodCount = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailySleep", x => x.Day);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailySleep");
        }
    }
}
