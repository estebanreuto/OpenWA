import { MigrationInterface, QueryRunner } from 'typeorm';

/** Rebinds the original dashboard login to its admin key for per-key dashboard users. */
export class LinkDashboardUsersToApiKeys1790900000000 implements MigrationInterface {
  name = 'LinkDashboardUsersToApiKeys1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = (await queryRunner.query(
      `SELECT "id" FROM "dashboard_credentials" WHERE "id" = 'default'`,
    )) as Array<{ id: string }>;
    if (existing.length > 0) {
      const keys = (await queryRunner.query(
        `SELECT "id" FROM "api_keys" ` +
          `WHERE "role" = 'admin' AND "isActive" = 1 ` +
          `AND COALESCE("allowedSessions", '') = '' AND COALESCE("allowedChats", '') = '' ` +
          `ORDER BY "createdAt" ASC LIMIT 1`,
      )) as Array<{ id: string }>;
      if (keys.length > 0) {
        await queryRunner.query(`UPDATE "dashboard_credentials" SET "id" = ? WHERE "id" = 'default'`, [keys[0].id]);
      }
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_dashboard_credentials_username" ` +
        `ON "dashboard_credentials" ("username")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const users = (await queryRunner.query(`SELECT "id" FROM "dashboard_credentials"`)) as Array<{ id: string }>;
    if (users.length > 1) {
      throw new Error('Cannot revert API-key-linked dashboard users while multiple users exist.');
    }
    if (users.length === 1) {
      await queryRunner.query(`UPDATE "dashboard_credentials" SET "id" = 'default' WHERE "id" = ?`, [users[0].id]);
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dashboard_credentials_username"`);
  }
}
