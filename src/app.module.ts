import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
// Módulos de administración y usuarios
import { RolModule } from './rol/rol.module';
import { PermissionModule } from './permission/permission.module';
import { DashboardPathModule } from './dashboard-path/dashboard-path.module';
import { UserModule } from './user/user.module';
// Módulos de activos
import { AssetModule } from './asset/asset.module';
import { ProductTypeModule } from './product-type/product-type.module';
import { VendorModule } from './vendor/vendor.module';
import { AssetStateModule } from './asset-state/asset-state.module';
import { CompanyModule } from './company/company.module';
import { SiteModule } from './site/site.module';
import { MovementModule } from './movement/movement.module';
import { ReportModule } from './report/report.module';
import { StatisticsModule } from './statistics/statistics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    RolModule,
    PermissionModule,
    DashboardPathModule,
    UserModule,
    AuthModule,
    // Módulos de activos
    AssetModule,
    ProductTypeModule,
    VendorModule,
    AssetStateModule,
    CompanyModule,
    SiteModule,
    MovementModule,
    ReportModule,
    StatisticsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}