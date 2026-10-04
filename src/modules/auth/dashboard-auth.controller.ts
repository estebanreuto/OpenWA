import { Body, Controller, Get, Post, Put, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { resolveClientIp } from '../../common/utils/ip';
import { ConfigService } from '@nestjs/config';
import { CurrentApiKey, Public, RequireRole, RequireUnscopedKey } from './decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { DashboardAuthService } from './dashboard-auth.service';
import { EngineFactory } from '../../engine/engine.factory';

class DashboardLoginDto {
  @IsString()
  @MaxLength(200)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

class DashboardCredentialsDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

@ApiTags('auth')
@Controller('auth')
export class DashboardAuthController {
  constructor(
    private readonly dashboardAuth: DashboardAuthService,
    private readonly configService: ConfigService,
    private readonly engineFactory: EngineFactory,
  ) {}

  @Get('dashboard-config')
  @Public()
  @ApiOperation({ summary: 'Check whether dashboard username/password login is configured' })
  async dashboardConfig(): Promise<{ passwordLoginEnabled: boolean }> {
    return { passwordLoginEnabled: await this.dashboardAuth.isEnabled() };
  }

  @Put('dashboard-credentials')
  @RequireUnscopedKey()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Create or update the dashboard username and password (admin only)' })
  async configureCredentials(
    @Body() dto: DashboardCredentialsDto,
    @CurrentApiKey() apiKey?: ApiKey,
  ): Promise<{ configured: true }> {
    if (!apiKey) throw new UnauthorizedException();
    await this.dashboardAuth.configure(apiKey.id, dto.username, dto.password);
    return { configured: true };
  }

  @Post('dashboard-login')
  @Public()
  @ApiOperation({ summary: 'Start a dashboard session with the configured username and password' })
  @ApiResponse({ status: 200, description: 'Dashboard session created' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: DashboardLoginDto,
    @Req() req: Request,
  ): Promise<{ token: string; expiresAt: string; role: string; engineType: string }> {
    const trustedProxies = this.configService.get<string[]>('security.trustedProxies') ?? [];
    const clientIp = resolveClientIp(req, trustedProxies);
    const session = await this.dashboardAuth.login(dto.username, dto.password, dto.rememberMe === true, clientIp);
    return { ...session, engineType: this.engineFactory.getCurrentEngine() };
  }
}
