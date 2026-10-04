import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDashboardCredentials1788300000000 implements MigrationInterface {
  name = 'CreateDashboardCredentials1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "dashboard_credentials" (` +
        `"id" varchar(36) PRIMARY KEY NOT NULL, ` +
        `"username" varchar(100) NOT NULL, ` +
        `"passwordSalt" varchar(64) NOT NULL, ` +
        `"passwordHash" varchar(128) NOT NULL, ` +
        `"sessionSecret" varchar(64) NOT NULL, ` +
        `"updatedAt" datetime NOT NULL DEFAULT (datetime('now'))` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_dashboard_credentials_username" ` +
        `ON "dashboard_credentials" ("username")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dashboard_credentials_username"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dashboard_credentials"`);
  }
}
