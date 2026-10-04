import { randomBytes, createHmac, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { ApiKey } from './entities/api-key.entity';
import { DashboardCredential } from './entities/dashboard-credential.entity';

interface DashboardSessionClaims {
  sub: string;
  keyId: string;
  authTag: string;
  exp: number;
}

const TOKEN_PREFIX = 'owa_ds1_';
const EIGHT_HOURS = 8 * 60 * 60;
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const scrypt = promisify(scryptCallback);

@Injectable()
export class DashboardAuthService {
  constructor(
    private readonly authService: AuthService,
    @InjectRepository(DashboardCredential, 'main')
    private readonly credentials: Repository<DashboardCredential>,
  ) {}

  async isEnabled(): Promise<boolean> {
    return (await this.credentials.count()) > 0;
  }

  async findUsername(keyId: string): Promise<string | undefined> {
    return (await this.credentials.findOneBy({ id: keyId }))?.username;
  }

  async usernamesForKeys(keyIds: string[]): Promise<Map<string, string>> {
    if (keyIds.length === 0) return new Map();
    const users = await this.credentials.find({ where: { id: In(keyIds) }, select: { id: true, username: true } });
    return new Map(users.map(user => [user.id, user.username]));
  }

  async configure(keyId: string, username: string, password?: string): Promise<void> {
    const normalizedUsername = username.trim();
    if (normalizedUsername.length < 3) {
      throw new BadRequestException('Username must contain at least 3 non-space characters');
    }
    const current = await this.credentials.findOneBy({ id: keyId });
    if (!current && !password) throw new BadRequestException('A password is required for a new dashboard user');

    const nameOwner = await this.credentials.findOneBy({ username: normalizedUsername });
    if (nameOwner && nameOwner.id !== keyId) throw new ConflictException('That username is already in use');

    const passwordSalt = password ? randomBytes(16).toString('hex') : current!.passwordSalt;
    const passwordHash = password ? await this.hashPassword(password, passwordSalt) : current!.passwordHash;
    await this.credentials.save({
      id: keyId,
      username: normalizedUsername,
      passwordSalt,
      passwordHash,
      // Changing either login field expires every existing session for this key.
      sessionSecret: randomBytes(32).toString('hex'),
    });
  }

  async remove(keyId: string): Promise<void> {
    await this.credentials.delete({ id: keyId });
  }

  async login(
    username: string,
    password: string,
    rememberMe: boolean,
    clientIp?: string,
  ): Promise<{ token: string; expiresAt: string; role: string }> {
    const credential = await this.credentials.findOneBy({ username: username.trim() });
    if (!credential) throw new UnauthorizedException('Invalid username or password');
    const suppliedHash = await this.hashPassword(password, credential.passwordSalt);
    if (!this.equal(suppliedHash, credential.passwordHash)) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const key = await this.authService.validateApiKeyById(credential.id, clientIp);
    const expiresAt = new Date(Date.now() + (rememberMe ? THIRTY_DAYS : EIGHT_HOURS) * 1000);
    const claims: DashboardSessionClaims = {
      sub: credential.username,
      keyId: key.id,
      authTag: this.authTag(credential),
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const unsigned = `${TOKEN_PREFIX}${encoded}`;
    const signature = this.sign(unsigned, credential.sessionSecret);
    return { token: `${unsigned}.${signature}`, expiresAt: expiresAt.toISOString(), role: key.role };
  }

  async validateSession(token: string, clientIp?: string, sessionId?: string): Promise<ApiKey> {
    const claims = await this.readClaims(token);
    if (!claims) throw new UnauthorizedException('Dashboard session is invalid or expired');
    return this.authService.validateApiKeyById(claims.keyId, clientIp, sessionId);
  }

  isSessionToken(token: string | undefined): token is string {
    return typeof token === 'string' && token.startsWith(TOKEN_PREFIX);
  }

  async sessionExpiresAt(token: string): Promise<number | null> {
    const claims = await this.readClaims(token);
    return claims ? claims.exp * 1000 : null;
  }

  private async readClaims(token: string): Promise<DashboardSessionClaims | null> {
    if (token.length > 2048 || !token.startsWith(TOKEN_PREFIX)) return null;
    const separator = token.lastIndexOf('.');
    if (separator <= TOKEN_PREFIX.length) return null;

    let claims: DashboardSessionClaims;
    try {
      const encoded = token.slice(TOKEN_PREFIX.length, separator);
      claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as DashboardSessionClaims;
    } catch {
      return null;
    }
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.keyId !== 'string' ||
      typeof claims.authTag !== 'string' ||
      !Number.isInteger(claims.exp) ||
      claims.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    const credential = await this.credentials.findOneBy({ id: claims.keyId });
    if (!credential || claims.sub !== credential.username || claims.authTag !== this.authTag(credential)) return null;
    const unsigned = token.slice(0, separator);
    const supplied = Buffer.from(token.slice(separator + 1));
    const expected = Buffer.from(this.sign(unsigned, credential.sessionSecret));
    return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? claims : null;
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    return ((await scrypt(password, salt, 64)) as Buffer).toString('hex');
  }

  private sign(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('base64url');
  }

  private authTag(credential: DashboardCredential): string {
    return createHmac('sha256', credential.sessionSecret)
      .update(`${credential.username}\0${credential.passwordHash}`)
      .digest('base64url');
  }

  private equal(actual: string, expected: string): boolean {
    const actualHash = createHmac('sha256', 'dashboard-credential-compare').update(actual).digest();
    const expectedHash = createHmac('sha256', 'dashboard-credential-compare').update(expected).digest();
    return timingSafeEqual(actualHash, expectedHash);
  }
}
