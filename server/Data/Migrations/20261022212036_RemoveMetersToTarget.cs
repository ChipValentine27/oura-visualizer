using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OuraViz.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveMetersToTarget : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MetersToTarget",
                table: "DailyActivities");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MetersToTarget",
                table: "DailyActivities",
                type: "INTEGER",
                nullable: true);
        }
    }
}
