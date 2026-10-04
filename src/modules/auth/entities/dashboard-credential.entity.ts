import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('dashboard_credentials')
export class DashboardCredential {
  // Reuses the associated API key id, so each key can own at most one dashboard user.
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index('IDX_dashboard_credentials_username', { unique: true })
  @Column({ type: 'varchar', length: 100 })
  username!: string;

  @Column({ type: 'varchar', length: 64 })
  passwordSalt!: string;

  @Column({ type: 'varchar', length: 128 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 64 })
  sessionSecret!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
