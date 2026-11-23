import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Req,
  Query,
} from '@nestjs/common';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { QueryAssetDto } from './dto/query-asset.dto';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('asset')
@Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR)
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post()
  create(
    @Body() createAssetDto: CreateAssetDto,
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.assetService.create(createAssetDto, userEmail);
  }

  @Get()
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findAll(@Query() query: QueryAssetDto) {
    return this.assetService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findOne(@Param('id') id: string) {
    return this.assetService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateAssetDto: UpdateAssetDto,
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.assetService.update(+id, updateAssetDto, userEmail);
  }

  @Get(':id/children')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  getChildren(@Param('id') id: string) {
    return this.assetService.getChildren(+id);
  }

  @Get(':id/parent')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  getParent(@Param('id') id: string) {
    return this.assetService.getParent(+id);
  }

  @Get(':id/relationships')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  getRelationships(@Param('id') id: string) {
    return this.assetService.getRelationships(+id);
  }

  @Patch(':id/assign')
  assignChild(
    @Param('id') id: string,
    @Body() body: { childAssetID: number },
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.assetService.assignChild(+id, body.childAssetID, userEmail);
  }

  @Patch(':id/unassign')
  unassignChild(
    @Param('id') id: string,
    @Body() body: { childAssetID: number },
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.assetService.unassignChild(+id, body.childAssetID, userEmail);
  }

  @Patch(':id/assign-parent')
  assignParent(
    @Param('id') id: string,
    @Body() body: { parentAssetID: number },
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.assetService.assignParent(+id, body.parentAssetID, userEmail);
  }

  @Patch(':id/unassign-parent')
  unassignParent(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const userEmail = req.user?.Email;
    return this.assetService.unassignParent(+id, userEmail);
  }
}