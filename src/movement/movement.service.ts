import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateMovementDto, MovementType } from './dto/create-movement.dto';
import { CreateBulkMovementDto } from './dto/create-bulk-movement.dto';
import { UpdateMovementDto } from './dto/update-movement.dto';
import { PrismaShopic } from 'src/database/database.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { PaginatedResult } from 'src/common/interfaces/paginated-result.interface';


// All movement operation types for queries
const ALL_MOVEMENT_OPERATIONS = [
  'BAJA', 'RESGUARDO', 'REASIGNACION', 'REPARACION',
];

@Injectable()
export class MovementService {
  constructor(private readonly prismaShopic: PrismaShopic) {}

  async create(createMovementDto: CreateMovementDto, userEmail?: string) {
    const { assetID, movementType, description, responsible, userID, companyID, siteID, departID } = createMovementDto;

    const asset = await this.prismaShopic.asset.findUnique({
      where: { AssetID: assetID },
      include: { AssetState_Asset_AssetStateToAssetState: true },
    });

    if (!asset) {
      throw new NotFoundException('Activo no encontrado');
    }

    if (asset.AssetState_Asset_AssetStateToAssetState?.Name === 'Baja') {
      throw new BadRequestException('No se pueden realizar movimientos en activos dados de baja');
    }

    try {
      const newStateID = await this.resolveNewState(movementType);

      // Resolver usuario en sesión
      let performingUserID: number | null = null;
      let performingUserName: string | null = null;
      if (userEmail) {
        const performingUser = await this.prismaShopic.user.findFirst({
          where: { Email: { contains: userEmail } },
        });
        if (performingUser) {
          performingUserID = performingUser.UserID;
          performingUserName = performingUser.Name;
        }
      }

      const effectiveUserID = userID || performingUserID;

      let targetUserName: string | null = null;
      let targetDepartName: string | null = null;
      let targetSiteName: string | null = null;
      let targetCompanyName: string | null = null;

      if (effectiveUserID) {
        const targetUser = await this.prismaShopic.user.findUnique({
          where: { UserID: effectiveUserID },
          select: { Name: true },
        });
        if (targetUser) targetUserName = targetUser.Name;
      }

      // Asignación automática IT para RESGUARDO / REPARACION
      let effectiveSiteID = siteID;
      let effectiveDepartID = departID;
      let effectiveCompanyID = companyID;

      if (movementType === 'RESGUARDO' || movementType === 'REPARACION') {
        const [itSite, itDepart] = await Promise.all([
          this.prismaShopic.site.findFirst({
            where: { Name: 'IT' },
            include: { Company: true },
          }),
          this.prismaShopic.depart.findFirst({
            where: { Name: 'IT' },
          }),
        ]);

        if (itSite) {
          effectiveSiteID = itSite.SiteID;
          effectiveCompanyID = itSite.CompanyID;
          targetSiteName = itSite.Name;
          targetCompanyName = itSite.Company?.Description || null;
        }

        if (itDepart) {
          effectiveDepartID = itDepart.DepartID;
          targetDepartName = itDepart.Name;
        }
      } else {
        if (effectiveSiteID) {
          const targetSite = await this.prismaShopic.site.findUnique({
            where: { SiteID: effectiveSiteID },
            include: { Company: true },
          });
          if (targetSite) {
            targetSiteName = targetSite.Name;
            targetCompanyName = targetSite.Company?.Description || null;
          }
        }
        if (effectiveDepartID) {
          const targetDepart = await this.prismaShopic.depart.findUnique({
            where: { DepartID: effectiveDepartID },
          });
          if (targetDepart) targetDepartName = targetDepart.Name;
        }
      }

      const effectiveResponsible = targetUserName || performingUserName || responsible || null;

      const defaultDesc = description || this.getDefaultDescription(movementType, asset.Name);
      const contextParts: string[] = [];
      if (targetUserName) contextParts.push(targetUserName);
      if (targetDepartName) contextParts.push(targetDepartName);
      if (targetSiteName) contextParts.push(targetSiteName);
      if (targetCompanyName) contextParts.push(targetCompanyName);

      const enrichedDesc = contextParts.length > 0
        ? `${defaultDesc} → ${contextParts.join(' / ')}`
        : defaultDesc;

      const descriptionParts: string[] = [];
      descriptionParts.push(enrichedDesc);
      if (effectiveResponsible) {
        descriptionParts.push(`Responsable: ${effectiveResponsible}`);
      }
      if (userEmail) {
        descriptionParts.push(`Registrado por: ${userEmail}`);
      }
      const fullDescription = descriptionParts.join(' | ');

      const result = await this.prismaShopic.$transaction(async (tx) => {
        const assetHistory = await tx.assetHistory.create({
          data: {
            AssetID: assetID,
            Operation: movementType,
            Description: fullDescription,
            CreatedTime: new Date(),
          },
        });

        const assetUpdateData: Record<string, unknown> = {};

        if (newStateID !== null) {
          assetUpdateData.AssetState = newStateID;
        }

        if (movementType === 'BAJA') {
          assetUpdateData.UserID = null;
          assetUpdateData.CompanyID = null;
          assetUpdateData.SiteID = null;
          assetUpdateData.DepartID = null;
        } else {
          if (effectiveUserID) assetUpdateData.UserID = effectiveUserID;
          if (effectiveCompanyID) assetUpdateData.CompanyID = effectiveCompanyID;
          if (effectiveSiteID) assetUpdateData.SiteID = effectiveSiteID;
          if (effectiveDepartID) assetUpdateData.DepartID = effectiveDepartID;
        }

        if (Object.keys(assetUpdateData).length > 0) {
          await tx.asset.update({
            where: { AssetID: assetID },
            data: assetUpdateData,
          });
        }

        // Historial de pertenencia
        if (movementType === 'REASIGNACION' || movementType === 'RESGUARDO' || movementType === 'REPARACION' || movementType === 'BAJA') {
          const openRecords = await tx.assetOwnershipHistory.findMany({
            where: {
              AssetID: assetID,
              ToDate: new Date('9999-12-31'),
            },
          });
          for (const record of openRecords) {
            await tx.assetOwnershipHistory.update({
              where: { AssetOwnershipHistoryID: record.AssetOwnershipHistoryID },
              data: { ToDate: new Date() },
            });
          }

          const newOwnerID = (movementType === 'RESGUARDO' || movementType === 'REPARACION' || movementType === 'REASIGNACION')
            ? effectiveUserID
            : null;

          if (newOwnerID) {
            await tx.assetOwnershipHistory.create({
              data: {
                AssetID: assetID,
                UserID: newOwnerID,
                FromDate: new Date(),
                ToDate: new Date('9999-12-31'),
              },
            });
          }
        }

        return assetHistory;
      });

      return {
        success: true,
        message: `Movimiento de tipo "${movementType}" registrado exitosamente`,
        data: {
          movementID: result.AssetHistoryID,
          assetID: result.AssetID,
          movementType: result.Operation,
        },
      };
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException({
        message: error.message || 'Error al registrar el movimiento',
      });
    }
  }

  async createBulk(dto: CreateBulkMovementDto, userEmail?: string) {
    const { assetIDs, movementType, companyID, siteID, userID, departID, fromDate, toDate, description, responsible } = dto;

    // Validar que todos los activos existen
    const assets = await this.prismaShopic.asset.findMany({
      where: { AssetID: { in: assetIDs } },
      include: { AssetState_Asset_AssetStateToAssetState: true },
    });

    if (assets.length !== assetIDs.length) {
      const foundIDs = assets.map((a) => a.AssetID);
      const missingIDs = assetIDs.filter((id) => !foundIDs.includes(id));
      throw new NotFoundException(`Activos no encontrados: ${missingIDs.join(', ')}`);
    }

    // Block movements on assets already in Baja state
    const bajaAssets = assets.filter(a => a.AssetState_Asset_AssetStateToAssetState?.Name === 'Baja');
    if (bajaAssets.length > 0) {
      const bajaNames = bajaAssets.map(a => a.Name).join(', ');
      throw new BadRequestException(`No se pueden realizar movimientos en activos dados de baja: ${bajaNames}`);
    }

    // Validar empresa y sitio solo si se proporcionan (requeridos para REASIGNACION)
    if (companyID) {
      const company = await this.prismaShopic.company.findUnique({ where: { CompanyID: companyID } });
      if (!company) throw new NotFoundException('Empresa no encontrada');
    }

    if (siteID) {
      const site = await this.prismaShopic.site.findUnique({ where: { SiteID: siteID } });
      if (!site) throw new NotFoundException('Sitio no encontrado');
    }

    try {
      // Enrich: resolve target user, department, site, company names once
      let bulkTargetUserName: string | null = null;
      let bulkTargetDepartName: string | null = null;
      let bulkTargetSiteName: string | null = null;
      let bulkTargetCompanyName: string | null = null;

      // For RESGUARDO/REPARACION: resolve the performing user from email
      // so we can reassign the asset to them
      // 1. Resolver usuario que realiza la acción
      let performingUserID: number | null = null;
      let performingUserName: string | null = null;
      if (userEmail) {
        const performingUser = await this.prismaShopic.user.findFirst({
          where: { Email: { contains: userEmail } },
        });
        if (performingUser) {
          performingUserID = performingUser.UserID;
          performingUserName = performingUser.Name;
        }
      }

      // Priorizar el usuario elegido en el formulario; si no hay, usar el de la sesión
      const effectiveUserID = userID || performingUserID;

      if (effectiveUserID) {
        const targetUser = await this.prismaShopic.user.findUnique({
          where: { UserID: effectiveUserID },
          select: { Name: true },
        });
        if (targetUser) {
          bulkTargetUserName = targetUser.Name;
        }
      }

      // 3. Regla automática para RESGUARDO y REPARACION: Site = "IT", Departamento = "IT"
      let effectiveSiteID = siteID;
      let effectiveDepartID = departID;
      let effectiveCompanyID = companyID;

      if (movementType === 'RESGUARDO' || movementType === 'REPARACION') {
        const [itSite, itDepart] = await Promise.all([
          this.prismaShopic.site.findFirst({
            where: { Name: 'IT' },
            include: { Company: true },
          }),
          this.prismaShopic.depart.findFirst({
            where: { Name: 'IT' },
          }),
        ]);

        if (itSite) {
          effectiveSiteID = itSite.SiteID;
          effectiveCompanyID = itSite.CompanyID;
          bulkTargetSiteName = itSite.Name;
          bulkTargetCompanyName = itSite.Company?.Description || null;
        }

        if (itDepart) {
          effectiveDepartID = itDepart.DepartID;
          bulkTargetDepartName = itDepart.Name;
        }
      } else {
        // En cualquier otro movimiento (como REASIGNACION), respeta lo elegido en el formulario
        if (effectiveSiteID) {
          const targetSite = await this.prismaShopic.site.findUnique({
            where: { SiteID: effectiveSiteID },
            include: { Company: true },
          });
          if (targetSite) {
            bulkTargetSiteName = targetSite.Name;
            bulkTargetCompanyName = targetSite.Company?.Description || null;
          }
        }
        if (effectiveDepartID) {
          const targetDepart = await this.prismaShopic.depart.findUnique({
            where: { DepartID: effectiveDepartID },
          });
          if (targetDepart) {
            bulkTargetDepartName = targetDepart.Name;
          }
        }
      }

      const effectiveResponsible = bulkTargetUserName || performingUserName || responsible || null;

      const bulkContextParts: string[] = [];
      if (bulkTargetUserName) bulkContextParts.push(bulkTargetUserName);
      if (bulkTargetDepartName) bulkContextParts.push(bulkTargetDepartName);
      if (bulkTargetSiteName) bulkContextParts.push(bulkTargetSiteName);
      if (bulkTargetCompanyName) bulkContextParts.push(bulkTargetCompanyName);

      const results = await this.prismaShopic.$transaction(async (tx) => {
        const movementResults: { movementID: number; assetID: number; assetName: string }[] = [];

        for (const asset of assets) {
          // Construir descripción enriquecida
          const defaultDesc = description || this.getDefaultDescription(movementType as MovementType, asset.Name);
          const enrichedDesc = bulkContextParts.length > 0
            ? `${defaultDesc} → ${bulkContextParts.join(' / ')}`
            : defaultDesc;

          const descParts: string[] = [];
          descParts.push(enrichedDesc);
          if (effectiveResponsible) descParts.push(`Responsable: ${effectiveResponsible}`);
          if (userEmail) descParts.push(`Registrado por: ${userEmail}`);
          const fullDescription = descParts.join(' | ');

          // Build update data based on movement type
          const updateData: Record<string, unknown> = {};

          // Cambiar estado si aplica
          const newStateID = await this.resolveNewState(movementType as MovementType);
          if (newStateID !== null) {
            updateData.AssetState = newStateID;
          }

          if (movementType === 'BAJA') {
            // En BAJA se limpian todas las asignaciones
            updateData.UserID = null;
            updateData.CompanyID = null;
            updateData.SiteID = null;
            updateData.DepartID = null;
          } else {
            // Cubre RESGUARDO y REPARACION (con los IDs de IT) y REASIGNACION (con los del formulario/fallback)
            if (effectiveUserID) updateData.UserID = effectiveUserID;
            if (effectiveCompanyID) updateData.CompanyID = effectiveCompanyID;
            if (effectiveSiteID) updateData.SiteID = effectiveSiteID;
            if (effectiveDepartID) updateData.DepartID = effectiveDepartID;
          }

          if (Object.keys(updateData).length > 0) {
            await tx.asset.update({
              where: { AssetID: asset.AssetID },
              data: updateData,
            });
          }

          // Crear historial del movimiento
          const assetHistory = await tx.assetHistory.create({
            data: {
              AssetID: asset.AssetID,
              Operation: movementType,
              Description: fullDescription,
              CreatedTime: new Date(),
            },
          });

          // Close previous open AssetOwnershipHistory records
          if (movementType === 'REASIGNACION' || movementType === 'RESGUARDO' || movementType === 'REPARACION' || movementType === 'BAJA') {
            const today = new Date();
            const openRecords = await tx.assetOwnershipHistory.findMany({
              where: {
                AssetID: asset.AssetID,
                ToDate: new Date('9999-12-31'),
              },
            });
            for (const record of openRecords) {
              await tx.assetOwnershipHistory.update({
                where: { AssetOwnershipHistoryID: record.AssetOwnershipHistoryID },
                data: { ToDate: new Date(fromDate || today) },
              });
            }

            // Create new ownership record for the new assignee
            const newOwnerID = (movementType === 'RESGUARDO' || movementType === 'REPARACION' || movementType === 'REASIGNACION')
              ? effectiveUserID
              : null;

            if (newOwnerID) {
              await tx.assetOwnershipHistory.create({
                data: {
                  AssetID: asset.AssetID,
                  UserID: newOwnerID,
                  FromDate: new Date(fromDate || today),
                  ToDate: toDate ? new Date(toDate) : new Date('9999-12-31'),
                },
              });
            }
          }

          movementResults.push({
            movementID: assetHistory.AssetHistoryID,
            assetID: asset.AssetID,
            assetName: asset.Name,
          });
        }

        return movementResults;
      });

      return {
        success: true,
        message: `Movimiento masivo registrado para ${results.length} activo(s)`,
        data: results,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException({
        message: error.message || 'Error al registrar el movimiento masivo',
      });
    }
  }

  async update(movementID: number, dto: UpdateMovementDto, userEmail?: string) {
    const movement = await this.prismaShopic.assetHistory.findUnique({
      where: { AssetHistoryID: movementID },
    });

    if (!movement) {
      throw new NotFoundException('Movimiento no encontrado');
    }

    const descriptionParts: string[] = [];
    const { description: currentDesc, responsible: currentResp, createdBy: currentCreatedBy } = this.parseDescription(movement.Description);

    descriptionParts.push(dto.description !== undefined ? dto.description : currentDesc);
    const responsible = dto.responsible !== undefined ? dto.responsible : currentResp;
    if (responsible) {
      descriptionParts.push(`Responsable: ${responsible}`);
    }
    const createdBy = userEmail || currentCreatedBy;
    if (createdBy) {
      descriptionParts.push(`Registrado por: ${createdBy}`);
    }
    const fullDescription = descriptionParts.join(' | ');

    try {
      await this.prismaShopic.assetHistory.update({
        where: { AssetHistoryID: movementID },
        data: { Description: fullDescription },
      });

      return {
        success: true,
        message: 'Movimiento actualizado exitosamente',
      };
    } catch (error: any) {
      throw new InternalServerErrorException({
        message: error.message || 'Error al actualizar el movimiento',
      });
    }
  }

  async findByAssetId(assetID: number) {
    const asset = await this.prismaShopic.asset.findUnique({
      where: { AssetID: assetID },
    });

    if (!asset) {
      throw new NotFoundException('Activo no encontrado');
    }

    try {
      const movements = await this.prismaShopic.assetHistory.findMany({
        where: {
          AssetID: assetID,
          Operation: { in: ALL_MOVEMENT_OPERATIONS },
        },
        orderBy: { CreatedTime: 'desc' },
        include: {
          Asset: {
            select: {
              AssetID: true,
              Name: true,
            },
          },
        },
      });

      return movements.map((m) => this.mapToMovementResponse(m));
    } catch (error: any) {
      throw new InternalServerErrorException({
        message: error.message || 'Error al obtener el historial de movimientos',
      });
    }
  }

  async findAll(paginationDto: PaginationDto): Promise<PaginatedResult<any>> {
    try {
      const page = Math.max(1, Number(paginationDto?.page) || 1);
      const limit = Math.max(1, Number(paginationDto?.limit) || 15);
      const skip = (page - 1) * limit;

      const where: any = {
        Operation: { in: ALL_MOVEMENT_OPERATIONS },
      };

      if (paginationDto?.search && paginationDto.search.trim() !== '') {
        const searchTerm = paginationDto.search.trim();
        where.OR = [
          { Description: { contains: searchTerm } },
          { Asset: { Name: { contains: searchTerm } } },
        ];
      }

      const [total, movements] = await Promise.all([
        this.prismaShopic.assetHistory.count({ where }),
        this.prismaShopic.assetHistory.findMany({
          where,
          skip,
          take: limit,
          orderBy: { CreatedTime: 'desc' },
          include: {
            Asset: {
              select: {
                AssetID: true,
                Name: true,
              },
            },
          },
        }),
      ]);

      return {
        data: movements.map((m) => this.mapToMovementResponse(m)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error: any) {
      throw new InternalServerErrorException({
        message: error.message || 'Error al obtener los movimientos',
      });
    }
  }

  async findAllHistory(paginationDto: PaginationDto): Promise<PaginatedResult<any>> {
    try {
      const page = Math.max(1, Number(paginationDto?.page) || 1);
      const limit = Math.max(1, Number(paginationDto?.limit) || 15);
      const skip = (page - 1) * limit;

      const [total, records, sites, departs] = await Promise.all([
        this.prismaShopic.assetHistory.count(),
        this.prismaShopic.assetHistory.findMany({
          skip,
          take: limit,
          orderBy: { CreatedTime: 'desc' },
          include: {
            Asset: {
              select: {
                AssetID: true,
                Name: true,
                AssetDetail: { select: { AssetTAG: true } },
                ProductType: { select: { ProductTypeID: true, Name: true, Group: true } },
                User: { select: { UserID: true, Name: true, Email: true } },
                Depart: { select: { DepartID: true, Name: true } },
                Site: { select: { SiteID: true, Name: true } },
                Company: { select: { CompanyID: true, Description: true } },
              },
            },
          },
        }),
        this.prismaShopic.site.findMany({ select: { Name: true } }),
        this.prismaShopic.depart.findMany({ select: { Name: true } }),
      ]);

      const validSiteNames = sites.map((s) => s.Name.trim().toLowerCase());
      const validDepartNames = departs.map((d) => d.Name.trim().toLowerCase());

      const emailsToResolve = new Set<string>();
      for (const m of records) {
        const { createdBy } = this.parseDescription(m.Description);
        if (createdBy) emailsToResolve.add(createdBy);
      }

      const emailNameMap = new Map<string, string>();
      if (emailsToResolve.size > 0) {
        const users = await this.prismaShopic.user.findMany({
          where: { Email: { in: Array.from(emailsToResolve) } },
          select: { Email: true, Name: true },
        });
        for (const u of users) {
          emailNameMap.set(u.Email, u.Name);
        }
      }

      const mappedData = records.map((m) => {
        const { description, responsible, createdBy } = this.parseDescription(m.Description);
        const performedBy = createdBy ? emailNameMap.get(createdBy) || createdBy : null;

        let matchedUser: string | null = null;
        let matchedSite: string | null = null;
        let matchedDepart: string | null = null;

        if (description.includes('→') || description.includes('->')) {
          const afterArrow = description.split(/→|->/)[1] || '';
          const segments = afterArrow.split('/').map((s) => s.trim());

          if (segments.length > 0) {
            const firstSeg = segments[0];
            const isDepart = validDepartNames.includes(firstSeg.toLowerCase());
            const isSite = validSiteNames.includes(firstSeg.toLowerCase());
            if (!isDepart && !isSite) matchedUser = firstSeg;
          }

          const foundSite = segments.find((seg) => validSiteNames.includes(seg.toLowerCase()));
          if (foundSite) matchedSite = foundSite;

          const foundDepart = segments.find((seg) => validDepartNames.includes(seg.toLowerCase()));
          if (foundDepart) matchedDepart = foundDepart;
        }

        const isBaja = m.Operation === 'BAJA';
        const isCreate = m.Operation === 'CREATE';
        const fallbackCreateUser = isCreate ? performedBy || null : null;
        const fallbackCreateSite = isCreate ? 'IT' : null;
        const fallbackCreateDepart = isCreate ? 'IT' : null;

        return {
          historyID: m.AssetHistoryID,
          assetID: m.AssetID,
          assetName: m.Asset?.Name || 'Activo eliminado',
          assetTAG: m.Asset?.AssetDetail?.AssetTAG || null,
          productTypeName: m.Asset?.ProductType?.Name || null,
          productTypeGroup: m.Asset?.ProductType?.Group || null,
          operation: m.Operation,
          description,
          performedBy,
          createdTime: m.CreatedTime,
          assignedUser: isBaja ? null : matchedUser || responsible || fallbackCreateUser || null,
          department: isBaja ? null : matchedDepart || fallbackCreateDepart || null,
          site: isBaja ? null : matchedSite || fallbackCreateSite || null,
          company: m.Asset?.Company?.Description || null,
        };
      });

      return {
        data: mappedData,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error: any) {
      throw new InternalServerErrorException({
        message: error.message || 'Error al obtener el historial paginado',
      });
    }
  }

  private mapToMovementResponse(m: {
    AssetHistoryID: number;
    AssetID: number;
    Operation: string;
    Description: string;
    CreatedTime: Date;
    Asset: { AssetID: number; Name: string };
  }) {
    const { description, responsible, createdBy } = this.parseDescription(m.Description);

    return {
      movementID: m.AssetHistoryID,
      assetID: m.AssetID,
      assetName: m.Asset.Name,
      movementType: m.Operation,
      description,
      responsible,
      createdTime: m.CreatedTime,
      createdBy,
    };
  }

  private parseDescription(fullDescription: string): {
    description: string;
    responsible: string | null;
    createdBy: string | null;
  } {
    if (!fullDescription) {
      return {
        description: '',
        responsible: null,
        createdBy: null,
      };
    }

    const parts = fullDescription.split(' | ');
    const rawDesc = parts[0] || fullDescription;
    let responsible: string | null = null;
    let createdBy: string | null = null;

    for (const part of parts.slice(1)) {
      if (part.startsWith('Responsable: ')) {
        responsible = part.replace('Responsable: ', '').trim();
      } else if (part.startsWith('Registrado por: ')) {
        createdBy = part.replace('Registrado por: ', '').trim();
      }
    }

    return {
      description: rawDesc,
      responsible,
      createdBy,
    };
  }

  private async resolveNewState(movementType: MovementType): Promise<number | null> {
    const stateMapping: Record<MovementType, string | null> = {
      REASIGNACION: 'Asignado',
      RESGUARDO: 'Resguardo',
      REPARACION: 'Mantenimiento',
      BAJA: 'Baja',
    };

    const targetStateName = stateMapping[movementType];
    if (!targetStateName) {
      return null;
    }

    const state = await this.prismaShopic.assetState.findFirst({
      where: {
        Name: {
          equals: targetStateName,
        },
      },
    });

    if (!state) {
      return null;
    }

    return state.AssetStateID;
  }

  private getDefaultDescription(movementType: MovementType, assetName: string): string {
    const descriptions: Record<MovementType, string> = {
      REASIGNACION: `Activo "${assetName}"`,
      RESGUARDO: `Resguardo del activo "${assetName}"`,
      REPARACION: `Reparacion del activo "${assetName}"`,
      BAJA: `Baja del activo "${assetName}"`,
    };
    return descriptions[movementType];
  }
}
