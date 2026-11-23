import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  Query,
} from '@nestjs/common';
import { MovementService } from './movement.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { CreateBulkMovementDto } from './dto/create-bulk-movement.dto';
import { UpdateMovementDto } from './dto/update-movement.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('movement')
@Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR)
export class MovementController {
  constructor(private readonly movementService: MovementService) {}

  @Post()
  create(
    @Body() createMovementDto: CreateMovementDto,
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.movementService.create(createMovementDto, userEmail);
  }

  @Post('bulk')
  createBulk(
    @Body() createBulkMovementDto: CreateBulkMovementDto,
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.movementService.createBulk(createBulkMovementDto, userEmail);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMovementDto: UpdateMovementDto,
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.movementService.update(+id, updateMovementDto, userEmail);
  }

  @Get()
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findAll(@Query() paginationDto: PaginationDto) {
    return this.movementService.findAll(paginationDto);
  }

  @Get('history')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findAllHistory(@Query() paginationDto: PaginationDto) {
    return this.movementService.findAllHistory(paginationDto);
  }

  @Get('asset/:assetId')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findByAssetId(@Param('assetId') assetId: string) {
    return this.movementService.findByAssetId(+assetId);
  }
}