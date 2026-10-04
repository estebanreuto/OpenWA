import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ApiKey } from './entities/api-key.entity';
import { DashboardCredential } from './entities/dashboard-credential.entity';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { ChatScopeService } from './chat-scope.service';
import { ActiveKeyIndex } from './active-key-index';
import { AuthController } from './auth.controller';
import { AuthValidateController } from './auth-validate.controller';
import { DashboardAuthController } from './dashboard-auth.controller';
import { DashboardAuthService } from './dashboard-auth.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ProxyAwareThrottlerGuard } from '../../common/security/proxy-aware-throttler.guard';
import { EngineModule } from '../../engine/engine.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, DashboardCredential], 'main'), EngineModule],
  controllers: [AuthController, AuthValidateController, DashboardAuthController],
  providers: [
    AuthService,
    DashboardAuthService,
    ApiKeyUsageTracker,
    ChatScopeService,
    ActiveKeyIndex,
    {
      provide: APP_GUARD,
      useClass: ProxyAwareThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
  exports: [AuthService, DashboardAuthService, ChatScopeService, ActiveKeyIndex],
})
export class AuthModule {}
