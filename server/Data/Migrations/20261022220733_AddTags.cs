using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OuraViz.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Tags",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    TagTypeCode = table.Column<string>(type: "TEXT", nullable: true),
                    CustomName = table.Column<string>(type: "TEXT", nullable: true),
                    Comment = table.Column<string>(type: "TEXT", nullable: true),
                    StartDay = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    EndDay = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    StartTime = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    EndTime = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tags", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Tags_StartDay",
                table: "Tags",
                column: "StartDay");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Tags");
        }
    }
}
