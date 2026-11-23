import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { PrismaShopic } from '../database/database.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prismaShopic: PrismaShopic) {

    const clientId = process.env.AZURE_AD_CLIENT_ID;
    const tenantId = process.env.AZURE_AD_TENANT_ID;

    if (!clientId || !tenantId) {
      throw new Error(
        'Faltan AZURE_AD_CLIENT_ID o AZURE_AD_TENANT_ID en el archivo .env',
      );
    }

    super({
      // 1. Extraer el token del encabezado: "Authorization: Bearer <token>"
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      // 2. Descargar y validar la firma usando las llaves públicas de Microsoft (JWKS)
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      }),

      // 3. Reglas de validación estricta
      ignoreExpiration: false, // Si ya expiró, rechazar de inmediato
      audience: `api://${clientId}`, // Comprueba que el token sea para esta API
      algorithms: ['RS256'],
    });
  }

  // 4. Este método SOLO se ejecuta si la firma, emisor, audiencia y vigencia son 100% legítimos
async validate(payload: any) {
    if (!payload) {
      throw new UnauthorizedException('Token inválido');
    }

    // Azure AD coloca el correo en 'preferred_username', 'upn' o 'email'
    const userEmail: string | undefined =
      payload.preferred_username || payload.upn || payload.email;

    if (!userEmail) {
      throw new UnauthorizedException({
        success: false,
        message: 'El token no contiene una identidad de correo válida',
      });
    }

    // Verificar si el usuario existe en la base de datos
    const user = await this.prismaShopic.user.findFirst({
      where: {
        Email: userEmail.toLowerCase(),
        isActive: true,
        rol: {
        isActive: true,
        },
      },
      include: {
        rol: true,
      },
    });

    if (!user) {
        throw new ForbiddenException({
          success: false,
          message:
          'Usuario no registrado, inactivo o sin rol activo. Acceso denegado.',
        });
      }

  // Passport asigna automáticamente este retorno a (req as any).user
    return {
      UserID: user.UserID,
      Email: user.Email,
      Name: user.Name,
      rolD: user.rolD,
      rolName: user.rol?.name,
      isActive: user.isActive,
    };
    
  }
}