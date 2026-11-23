import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { RoleId } from './role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleId[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.isActive !== true || typeof user.rolD !== 'number') {
      throw new ForbiddenException({
        success: false,
        message: 'Acceso denegado: perfil de usuario inválido o inactivo.',
      });
    }

    if (!requiredRoles.includes(user.rolD)) {
      throw new ForbiddenException({
        success: false,
        message: 'No tienes permisos suficientes para realizar esta acción.',
      });
    }

    return true;
  }
}