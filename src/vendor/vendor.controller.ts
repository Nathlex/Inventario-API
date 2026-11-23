import { Controller, Get, Post, Body } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('vendor')
@Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR)
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Get()
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findAll() {
    return this.vendorService.findAll();
  }

  @Post()
  create(@Body() body: { name: string }) {
    return this.vendorService.create(body.name);
  }
}