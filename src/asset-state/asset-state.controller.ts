import { Controller, Get } from '@nestjs/common';
import { AssetStateService } from './asset-state.service';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('asset-state')
@Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
export class AssetStateController {
  constructor(private readonly assetStateService: AssetStateService) {}

  @Get()
  findAll() {
    return this.assetStateService.findAll();
  }
}