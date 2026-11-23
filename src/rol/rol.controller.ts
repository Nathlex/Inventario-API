import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RolService } from './rol.service';
import { CreateRolDto } from './dto/create-rol.dto';
import { UpdateRolDto } from './dto/update-rol.dto';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('rol')
@Roles(RoleId.ADMINISTRADOR)
export class RolController {
  constructor(private readonly rolService: RolService) {}

  @Post()
  create(@Body() createRolDto: CreateRolDto) {
    return this.rolService.create(createRolDto);
  }

  @Get()
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findAll() {
    return this.rolService.findAll();
  }

  @Get(':id')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findOne(@Param('id') id: string) {
    return this.rolService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateRolDto: UpdateRolDto) {
    return this.rolService.update(+id, updateRolDto);
  }

  @Patch(':id/updateRoleStatus')
  updateStatus(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.rolService.updateStatus(+id, body.isActive);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.rolService.remove(+id);
  }
}