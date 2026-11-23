import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { DashboardPathService } from './dashboard-path.service';
import { CreateDashboardPathDto } from './dto/create-dashboard-path.dto';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('dashboard-path')
@Roles(RoleId.ADMINISTRADOR)
export class DashboardPathController {
  constructor(private readonly dashboardPathService: DashboardPathService) {}

  @Post()
  create(@Body() createDashboardPathDto: CreateDashboardPathDto) {
    return this.dashboardPathService.create(createDashboardPathDto);
  }

  @Get()
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findAll() {
    return this.dashboardPathService.findAll();
  }

  @Patch(':id/icon')
  updateIcon(@Param('id') id: string, @Body('icon') icon: string) {
    return this.dashboardPathService.updateIcon(+id, icon);
  }
}