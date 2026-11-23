import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../auth/roles.decorator';
import { RoleId } from '../auth/role.enum';

@Controller('user')
@Roles(RoleId.ADMINISTRADOR)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findAll() {
    return this.userService.findAll();
  }

  @Get('search')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  searchUsers(
    @Query('q') query?: string,
    @Query('departmentID') departmentID?: string,
    @Query('siteID') siteID?: string,
  ) {
    return this.userService.searchUsers(
      query,
      departmentID ? +departmentID : undefined,
      siteID ? +siteID : undefined,
    );
  }

  @Get('departments')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  getDepartments() {
    return this.userService.getDepartments();
  }

  @Get('departments/site/:siteID')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  getDepartmentsBySite(@Param('siteID') siteID: string) {
    return this.userService.getDepartmentsBySite(+siteID);
  }

  @Get('verify/:email')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  async verifyUser(@Param('email') email: string) {
    return this.userService.verifyUser(email);
  }

  @Get('profile/:email')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  async getUserProfile(@Param('email') email: string) {
    return this.userService.getUserProfile(email);
  }

  @Get(':id')
  @Roles(RoleId.ADMINISTRADOR, RoleId.COORDINADOR, RoleId.CONSULTOR)
  findOne(@Param('id') id: string) {
    return this.userService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(+id, updateUserDto);
  }

  @Patch(':id/updateUserStatus')
  updateStatus(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.userService.updateStatus(+id, body.isActive);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userService.remove(+id);
  }
}