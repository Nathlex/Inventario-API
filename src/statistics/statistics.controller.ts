import { Controller, Get, Query } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('statistics')
@Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('dashboard')
  getDashboardStats(
    @Query('siteID') siteID?: string,
    @Query('group') group?: string,
    @Query('stateID') stateID?: string,
  ) {
    return this.statisticsService.getDashboardStats({
      siteID: siteID ? Number(siteID) : undefined,
      group: group || undefined,
      stateID: stateID ? Number(stateID) : undefined,
    });
  }
}