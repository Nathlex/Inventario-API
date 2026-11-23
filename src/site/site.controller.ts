import { Controller, Get, Param } from '@nestjs/common';
import { SiteService } from './site.service';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('site')
@Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  @Get()
  findAll() {
    return this.siteService.findAll();
  }

  @Get('company/:companyID')
  findByCompany(@Param('companyID') companyID: string) {
    return this.siteService.findByCompany(+companyID);
  }
}