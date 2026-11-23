import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { PrismaShopic } from 'src/database/database.service';
import { QueryAssetDto } from './dto/query-asset.dto';
import { PaginatedResult } from 'src/common/interfaces/paginated-result.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class AssetService {
  constructor(private readonly prismaShopic: PrismaShopic) {}

  // Formato: HS-{ProductTypeID con 2 digitos}-{secuencia con 2 digitos}
  // Ej: el 5o monitor (ProductTypeID = 3) -> HS-03-05
  private async generateAssetTag(
    productTypeID: number,
    tx: Prisma.TransactionClient = this.prismaShopic,
  ): Promise<string> {
    const productCode = String(productTypeID).padStart(2, '0');
    const tagPrefix = `HS-${productCode}-`;

    const existingDetails = await tx.assetDetail.findMany({ 
      where: {
        AssetTAG: { startsWith: tagPrefix },
      },
      select: { AssetTAG: true },
    });

    let maxSeq = 0;
    for (const d of existingDetails) {
      if (!d.AssetTAG) continue;
      const seqPart = d.AssetTAG.substring(tagPrefix.length);
      const seq = parseInt(seqPart, 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }

    const nextSeq = maxSeq + 1;
    const padded = String(nextSeq).padStart(2, '0');
    return `${tagPrefix}${padded}`;
  }

  async create(createAssetDto: CreateAssetDto, userEmail?: string) {
    const { name, vendorID, productTypeID, assetState, companyID, siteID, userID, assignmentFromDate, assignmentToDate, detail } =
      createAssetDto;

    try {
      // 1. Datos del usuario en sesión que registra el activo
      let lastUpdateBy = 1; 
      let userName: string | null = null;

      if (userEmail) {
        const user = await this.prismaShopic.user.findFirst({
          where: { Email: userEmail },
          select: { UserID: true, Name: true, DepartmentID: true }
        });
        if (user) {
          lastUpdateBy = user.UserID;
          userName = user.Name;
        }
      }

      // 2. Asignación automática: Site "IT", Departamento "IT" y Empresa de IT
      const [itSite, itDepart] = await Promise.all([
        this.prismaShopic.site.findFirst({
          where: { Name: 'IT' },
          include: { Company: true },
        }),
        this.prismaShopic.depart.findFirst({
          where: { Name: 'IT' },
        }),
      ]);

      const resolvedSiteID = itSite?.SiteID || siteID || 1;
      const resolvedCompanyID = itSite?.CompanyID || companyID || 1;
      const resolvedDepartID = itDepart?.DepartID || null;
      const targetSiteName = itSite?.Name || 'IT';
      const targetCompanyName = itSite?.Company?.Description || '';
      const targetDepartName = itDepart?.Name || 'IT';

      // 3. Responsable inicial: el usuario seleccionado o el creador por defecto
      const effectiveUserID = userID || lastUpdateBy;
      let effectiveUserName = userName || 'Responsable';

      if (userID && userID !== lastUpdateBy) {
        const assignedUser = await this.prismaShopic.user.findUnique({
          where: { UserID: userID },
          select: { Name: true },
        });
        if (assignedUser) effectiveUserName = assignedUser.Name;
      }

      // Estado inicial por defecto: "Stock"
      let resolvedAssetState = assetState;
      if (!resolvedAssetState) {
        const stockState = await this.prismaShopic.assetState.findFirst({
          where: { Name: { contains: 'Stock' } },
        });
        resolvedAssetState = stockState?.AssetStateID || 1;
      }

      let createdAsset: { AssetID: number } | null = null;

        try {
          createdAsset = await this.prismaShopic.$transaction(async (tx) => {
            let assetDetailID: number | null = null;

            if (detail) {
              const generatedTag = await this.generateAssetTag(productTypeID, tx);

          const newDetail = await tx.assetDetail.create({
            data: {
              ProductManuf: detail.productManuf,
              IPAddress: detail.ipAddress,
              MACAddress: detail.macAddress,
              Loanable: detail.loanable,
              VMPlatform: detail.vmPlatform,
              VirtualHost: detail.virtualHost,
              OperatingSystem: detail.operatingSystem,
              Domain: detail.domain,
              ProcessorInfo: detail.processorInfo,
              Processor: detail.processor,
              PhysicalMemory: detail.physicalMemory,
              HDDModel: detail.hddModel,
              HDDSerial: detail.hddSerial,
              HDDCapacity: detail.hddCapacity,
              KeyboardType: detail.keyboardType,
              MouseType: detail.mouseType,
              NumModel: detail.numModel,
              Model: detail.model,
              IMEI: detail.imei,
              ModemFirmwareVersion: detail.modemFirmwareVersion,
              Platform: detail.platform,
              OSName: detail.osName,
              OSVersion: detail.osVersion,
              RAM: detail.ram,
              SerialNum: detail.serialNum,
              PurchaseDate: detail.purchaseDate ? new Date(detail.purchaseDate) : null,
              WarrantyExpiryDate: detail.warrantyExpiryDate ? new Date(detail.warrantyExpiryDate) : null,
              AssetACQDate: detail.assetACQDate ? new Date(detail.assetACQDate) : null,
              AssetExpiryDate: detail.assetExpiryDate ? new Date(detail.assetExpiryDate) : null,
              AssetTAG: generatedTag,
              WarrantyExpiry: detail.warrantyExpiry ? new Date(detail.warrantyExpiry) : null,
              Barcode: detail.barcode,
              Factura: detail.factura,
              Ticket: detail.ticket,
              CreatedTime: new Date(),
              LastUpdateTime: new Date(),
              LastUpdateBy: lastUpdateBy,
            },
          });
          assetDetailID = newDetail.AssetDetailID;
        }

        // Crear el activo asignado a IT
        const newAsset = await tx.asset.create({
          data: {
            Name: name,
            VendorID: vendorID,
            ProductTypeID: productTypeID,
            AssetState: resolvedAssetState,
            CompanyID: resolvedCompanyID,
            SiteID: resolvedSiteID,
            DepartID: resolvedDepartID,
            UserID: effectiveUserID,
            AssetDetailID: assetDetailID,
          },
        });

        // 4. Congelar la foto exacta en la descripción histórica
        const contextParts = [effectiveUserName, targetDepartName, targetSiteName, targetCompanyName].filter(Boolean);
        const enrichedDesc = `Activo "${newAsset.Name}" creado → ${contextParts.join(' / ')}`;
        const descriptionParts = [
          enrichedDesc,
          `Responsable: ${effectiveUserName}`,
          `Registrado por: ${userName || userEmail || 'Sistema'}`,
        ];
        const fullDescription = descriptionParts.join(' | ');

        await tx.assetHistory.create({
          data: {
            AssetID: newAsset.AssetID,
            Operation: 'CREATE',
            Description: fullDescription,
            CreatedTime: new Date(),
          },
        });

        // Registrar pertenencia inicial
        if (effectiveUserID) {
          await tx.assetOwnershipHistory.create({
            data: {
              AssetID: newAsset.AssetID,
              UserID: effectiveUserID,
              FromDate: assignmentFromDate ? new Date(assignmentFromDate) : new Date(),
              ToDate: assignmentToDate ? new Date(assignmentToDate) : new Date('9999-12-31'),
            },
          });
        }

        return newAsset;
          });

        } catch (error: any) {
          throw error;
        }
    } catch (error: any) {
      throw new InternalServerErrorException({
        message: error.message || 'Error al crear el activo',
      });
    }
  }

  async findAll(query: QueryAssetDto): Promise<PaginatedResult<any>> {
    try {
      const page = Math.max(1, Number(query?.page) || 1);
      const limit = Math.max(1, Number(query?.limit) || 15);
      const skip = (page - 1) * limit;

      const where: any = {};

      if (query?.companyID) {
        where.CompanyID = Number(query.companyID);
      }
      if (query?.siteID) {
        where.SiteID = Number(query.siteID);
      }
      if (query?.departID) {
        where.DepartID = Number(query.departID);
      }
      if (query?.assetStateID) {
        where.AssetState = Number(query.assetStateID);
      }

      if (query?.search && query.search.trim() !== '') {
        const searchTerm = query.search.trim();
        where.OR = [
          { Name: { contains: searchTerm } },
          { AssetDetail: { AssetTAG: { contains: searchTerm } } },
          { AssetDetail: { SerialNum: { contains: searchTerm } } },
        ];
      }

      const [total, assets] = await Promise.all([
        this.prismaShopic.asset.count({ where }),
        this.prismaShopic.asset.findMany({
          where,
          skip,
          take: limit,
          orderBy: { AssetID: 'desc' },
          include: {
            Vendor: true,
            ProductType: true,
            AssetState_Asset_AssetStateToAssetState: true,
            Company: true,
            Site: true,
            AssetDetail: true,
            Depart: true,
            User: {
              include: {
                Depart: true,
              },
            },
          },
        }),
      ]);

      const mappedData = assets.map((asset) => ({
        assetID: asset.AssetID,
        name: asset.Name,
        vendorID: asset.VendorID,
        productTypeID: asset.ProductTypeID,
        assetState: asset.AssetState,
        companyID: asset.CompanyID,
        siteID: asset.SiteID,
        userID: asset.UserID,
        vendor: asset.Vendor
          ? { vendorID: asset.Vendor.VendorID, name: asset.Vendor.Name }
          : null,
        productType: asset.ProductType
          ? {
              productTypeID: asset.ProductType.ProductTypeID,
              name: asset.ProductType.Name,
              category: asset.ProductType.Category,
              group: asset.ProductType.Group,
              subCategory: asset.ProductType.SubCategory,
            }
          : null,
        assetStateInfo: asset.AssetState_Asset_AssetStateToAssetState
          ? {
              assetStateID: asset.AssetState_Asset_AssetStateToAssetState.AssetStateID,
              name: asset.AssetState_Asset_AssetStateToAssetState.Name,
            }
          : null,
        company: asset.Company
          ? { companyID: asset.Company.CompanyID, description: asset.Company.Description }
          : null,
        site: asset.Site
          ? { siteID: asset.Site.SiteID, name: asset.Site.Name, companyID: asset.Site.CompanyID }
          : null,
        user: asset.User
          ? {
              userID: asset.User.UserID,
              name: asset.User.Name,
              email: asset.User.Email,
              departmentID: asset.User.DepartmentID,
              firstName: asset.User.FirstName,
              lastName: asset.User.LastName,
            }
          : null,
        depart: asset.User?.Depart
          ? {
              departID: asset.User.Depart.DepartID,
              Name: asset.User.Depart.Name,
            }
          : asset.Depart
            ? {
                departID: asset.Depart.DepartID,
                Name: asset.Depart.Name,
              }
            : null,
        assetDetail: asset.AssetDetail
          ? {
              assetDetailID: asset.AssetDetail.AssetDetailID,
              serialNum: asset.AssetDetail.SerialNum,
              assetTAG: asset.AssetDetail.AssetTAG,
              model: asset.AssetDetail.Model,
              productManuf: asset.AssetDetail.ProductManuf,
              ipAddress: asset.AssetDetail.IPAddress,
              macAddress: asset.AssetDetail.MACAddress,
              processor: asset.AssetDetail.Processor,
              processorInfo: asset.AssetDetail.ProcessorInfo,
              ram: asset.AssetDetail.RAM,
              physicalMemory: asset.AssetDetail.PhysicalMemory,
              hddModel: asset.AssetDetail.HDDModel,
              hddCapacity: asset.AssetDetail.HDDCapacity,
              operatingSystem: asset.AssetDetail.OperatingSystem,
              purchaseDate: asset.AssetDetail.PurchaseDate,
              warrantyExpiryDate: asset.AssetDetail.WarrantyExpiryDate,
              factura: asset.AssetDetail.Factura,
              ticket: asset.AssetDetail.Ticket,
            }
          : null,
      }));

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
        message: error.message || 'Error al obtener los activos paginados',
      });
    }
  }

  async findOne(id: number) {
    try {
      const asset = await this.prismaShopic.asset.findUnique({
        where: { AssetID: id },
        include: {
          Vendor: true,
          ProductType: true,
          AssetState_Asset_AssetStateToAssetState: true,
          Company: true,
          Site: true,
          AssetDetail: true,
          Depart: true,
          User: {
            include: {
              Depart: true,
            },
          },
          AssetHistory: {
            orderBy: { CreatedTime: 'desc' },
            take: 10,
          },
          Asset: {
            include: {
              ProductType: true,
              AssetDetail: true,
            },
          },
          other_Asset: {
            include: {
              ProductType: true,
              AssetDetail: true,
            },
          },
        },
      });

      if (!asset) {
        throw new NotFoundException('Activo no encontrado');
      }

      return {
        assetID: asset.AssetID,
        name: asset.Name,
        vendorID: asset.VendorID,
        productTypeID: asset.ProductTypeID,
        assetState: asset.AssetState,
        companyID: asset.CompanyID,
        siteID: asset.SiteID,
        userID: asset.UserID,
        parentAssetID: asset.ParentAssetID,
        vendor: asset.Vendor
          ? { vendorID: asset.Vendor.VendorID, name: asset.Vendor.Name }
          : null,
        productType: asset.ProductType
          ? {
              productTypeID: asset.ProductType.ProductTypeID,
              name: asset.ProductType.Name,
              category: asset.ProductType.Category,
              group: asset.ProductType.Group,
              subCategory: asset.ProductType.SubCategory,
            }
          : null,
        assetStateInfo: asset.AssetState_Asset_AssetStateToAssetState
          ? {
              assetStateID: asset.AssetState_Asset_AssetStateToAssetState.AssetStateID,
              name: asset.AssetState_Asset_AssetStateToAssetState.Name,
            }
          : null,
        company: asset.Company
          ? { companyID: asset.Company.CompanyID, description: asset.Company.Description }
          : null,
        site: asset.Site
          ? { siteID: asset.Site.SiteID, name: asset.Site.Name, companyID: asset.Site.CompanyID }
          : null,
        user: asset.User
          ? {
              userID: asset.User.UserID,
              name: asset.User.Name,
              email: asset.User.Email,
              departmentID: asset.User.DepartmentID,
              firstName: asset.User.FirstName,
              lastName: asset.User.LastName,
            }
          : null,
        depart: asset.User?.Depart
          ? {
              departID: asset.User.Depart.DepartID,
              Name: asset.User.Depart.Name,
            }
          : asset.Depart
            ? {
                departID: asset.Depart.DepartID,
                Name: asset.Depart.Name,
              }
            : null,
        assetDetail: asset.AssetDetail
          ? {
              assetDetailID: asset.AssetDetail.AssetDetailID,
              productManuf: asset.AssetDetail.ProductManuf,
              ipAddress: asset.AssetDetail.IPAddress,
              macAddress: asset.AssetDetail.MACAddress,
              loanable: asset.AssetDetail.Loanable,
              vmPlatform: asset.AssetDetail.VMPlatform,
              virtualHost: asset.AssetDetail.VirtualHost,
              operatingSystem: asset.AssetDetail.OperatingSystem,
              domain: asset.AssetDetail.Domain,
              processorInfo: asset.AssetDetail.ProcessorInfo,
              processor: asset.AssetDetail.Processor,
              physicalMemory: asset.AssetDetail.PhysicalMemory,
              hddModel: asset.AssetDetail.HDDModel,
              hddSerial: asset.AssetDetail.HDDSerial,
              hddCapacity: asset.AssetDetail.HDDCapacity,
              keyboardType: asset.AssetDetail.KeyboardType,
              mouseType: asset.AssetDetail.MouseType,
              numModel: asset.AssetDetail.NumModel,
              model: asset.AssetDetail.Model,
              imei: asset.AssetDetail.IMEI,
              modemFirmwareVersion: asset.AssetDetail.ModemFirmwareVersion,
              platform: asset.AssetDetail.Platform,
              osName: asset.AssetDetail.OSName,
              osVersion: asset.AssetDetail.OSVersion,
              ram: asset.AssetDetail.RAM,
              serialNum: asset.AssetDetail.SerialNum,
              purchaseDate: asset.AssetDetail.PurchaseDate,
              warrantyExpiryDate: asset.AssetDetail.WarrantyExpiryDate,
              assetACQDate: asset.AssetDetail.AssetACQDate,
              assetExpiryDate: asset.AssetDetail.AssetExpiryDate,
              assetTAG: asset.AssetDetail.AssetTAG,
              warrantyExpiry: asset.AssetDetail.WarrantyExpiry,
              barcode: asset.AssetDetail.Barcode,
              factura: asset.AssetDetail.Factura,
              ticket: asset.AssetDetail.Ticket,
              createdTime: asset.AssetDetail.CreatedTime,
              lastUpdateTime: asset.AssetDetail.LastUpdateTime,
              lastUpdateBy: asset.AssetDetail.LastUpdateBy,
            }
          : null,
        parentAsset: asset.Asset
          ? {
              assetID: asset.Asset.AssetID,
              name: asset.Asset.Name,
              productType: asset.Asset.ProductType
                ? {
                    productTypeID: asset.Asset.ProductType.ProductTypeID,
                    name: asset.Asset.ProductType.Name,
                    group: asset.Asset.ProductType.Group,
                  }
                : null,
              model: asset.Asset.AssetDetail?.Model || null,
              serialNum: asset.Asset.AssetDetail?.SerialNum || null,
            }
          : null,
        childAssets: asset.other_Asset.map((child) => ({
          assetID: child.AssetID,
          name: child.Name,
          productType: child.ProductType
            ? {
                productTypeID: child.ProductType.ProductTypeID,
                name: child.ProductType.Name,
                group: child.ProductType.Group,
              }
            : null,
          model: child.AssetDetail?.Model || null,
          serialNum: child.AssetDetail?.SerialNum || null,
        })),
        history: asset.AssetHistory.map((h) => ({
          assetHistoryID: h.AssetHistoryID,
          assetID: h.AssetID,
          operation: h.Operation,
          description: h.Description,
          createdTime: h.CreatedTime,
        })),
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException({
        message: error.message || 'Error al obtener el activo',
      });
    }
  }

  async update(id: number, updateAssetDto: UpdateAssetDto, userEmail?: string) {
    const asset = await this.prismaShopic.asset.findUnique({
      where: { AssetID: id },
    });

    if (!asset) {
      throw new NotFoundException('Activo no encontrado');
    }
    
    try {
      // Obtener el usuario que actualiza
      let lastUpdateBy = 1;
      // Obtener nombre del usuario para el historial
      let userName: string | null = null;

      if (userEmail) {
        const user = await this.prismaShopic.user.findFirst({
          where: { Email: userEmail }
        });
        if (user) {
          lastUpdateBy = user.UserID;
          userName = user.Name;
        }
      }

      const { detail, ...assetData } = updateAssetDto;
      
      let updated: { AssetID: number } | null = null;

        try {
          updated = await this.prismaShopic.$transaction(async (tx) => {
            // Si cambia el ProductTypeID, regenerar el AssetTAG dentro de la transacción
            let regeneratedTag: string | undefined;
            if (
              assetData.productTypeID !== undefined &&
              assetData.productTypeID !== asset.ProductTypeID
            ) {
              regeneratedTag = await this.generateAssetTag(assetData.productTypeID, tx);
            }

      // Actualizar el activo
        const updatedAsset = await tx.asset.update({
          where: { AssetID: id },
          data: {
            Name: assetData.name,
            VendorID: assetData.vendorID,
            ProductTypeID: assetData.productTypeID,
            AssetState: assetData.assetState,
            CompanyID: assetData.companyID,
            SiteID: assetData.siteID,
            UserID: assetData.userID,
          },
        });

        // Actualizar detalles si existen
        if (detail) {
          const detailData = {
                ProductManuf: detail.productManuf,
                IPAddress: detail.ipAddress,
                MACAddress: detail.macAddress,
                Loanable: detail.loanable,
                VMPlatform: detail.vmPlatform,
                VirtualHost: detail.virtualHost,
                OperatingSystem: detail.operatingSystem,
                Domain: detail.domain,
                ProcessorInfo: detail.processorInfo,
                Processor: detail.processor,
                PhysicalMemory: detail.physicalMemory,
                HDDModel: detail.hddModel,
                HDDSerial: detail.hddSerial,
                HDDCapacity: detail.hddCapacity,
                KeyboardType: detail.keyboardType,
                MouseType: detail.mouseType,
                NumModel: detail.numModel,
                Model: detail.model,
                IMEI: detail.imei,
                ModemFirmwareVersion: detail.modemFirmwareVersion,
                Platform: detail.platform,
                OSName: detail.osName,
                OSVersion: detail.osVersion,
                RAM: detail.ram,
                SerialNum: detail.serialNum,
                // AssetTAG es inmutable salvo cambio de ProductTypeID: se ignora el valor enviado por el cliente
                AssetTAG: regeneratedTag ?? undefined,
                Barcode: detail.barcode,
                Factura: detail.factura,
                Ticket: detail.ticket,
                PurchaseDate: detail.purchaseDate ? new Date(detail.purchaseDate) : undefined,
                WarrantyExpiryDate: detail.warrantyExpiryDate ? new Date(detail.warrantyExpiryDate) : undefined,
                LastUpdateTime: new Date(),
                LastUpdateBy: lastUpdateBy,
              };

          if (updatedAsset.AssetDetailID) {
            // Ya tiene un detalle vinculado, actualizarlo
            await tx.assetDetail.update({
              where: { AssetDetailID: updatedAsset.AssetDetailID },
              data: detailData,
            });
          } else {
            // No tiene detalle, crear uno nuevo y vincularlo al asset
            // Generar tag si no se regenero antes (ProductTypeID sin cambios)
            const tagForNewDetail =
              regeneratedTag ??
              (await this.generateAssetTag(assetData.productTypeID ?? asset.ProductTypeID, tx));

            const newDetail = await tx.assetDetail.create({
              data: {
                ...detailData,
                AssetTAG: tagForNewDetail,
                PurchaseDate: detail.purchaseDate ? new Date(detail.purchaseDate) : null,
                WarrantyExpiryDate: detail.warrantyExpiryDate ? new Date(detail.warrantyExpiryDate) : null,
                CreatedTime: new Date(),
              },
            });
            await tx.asset.update({
              where: { AssetID: id },
              data: { AssetDetailID: newDetail.AssetDetailID },
            });
          }
        }

        await tx.assetHistory.create({
          data: {
            AssetID: id,
            Operation: 'UPDATE',
            Description: `Activo "${updatedAsset.Name}" actualizado | Registrado por: ${userName}`,
            CreatedTime: new Date(),
          },
      });

      return updatedAsset;
          });
        } catch (error: any) {
          throw error;
        }

    return {
      success: true,
      message: 'Activo actualizado exitosamente',
      data: { assetID: updated.AssetID },
  };
    } catch (error: any) {
      throw new InternalServerErrorException({
        message: error.message || 'Error al actualizar el activo',
      });
    }
  }

  // --- Asset Assignment (Parent/Child relationships) ---

  private mapChildAsset(child: any) {
    return {
      assetID: child.AssetID,
      name: child.Name,
      productType: child.ProductType
        ? {
            productTypeID: child.ProductType.ProductTypeID,
            name: child.ProductType.Name,
            group: child.ProductType.Group,
          }
        : null,
      model: child.AssetDetail?.Model || null,
      serialNum: child.AssetDetail?.SerialNum || null,
    };
  }

  async getChildren(parentAssetID: number) {
    const asset = await this.prismaShopic.asset.findUnique({
      where: { AssetID: parentAssetID },
    });
    if (!asset) {
      throw new NotFoundException('Activo no encontrado');
    }

    const children = await this.prismaShopic.asset.findMany({
      where: { ParentAssetID: parentAssetID },
      include: {
        ProductType: true,
        AssetDetail: true,
      },
    });

    return children.map(this.mapChildAsset);
  }

  async getParent(childAssetID: number) {
    const asset = await this.prismaShopic.asset.findUnique({
      where: { AssetID: childAssetID },
      include: {
        Asset: {
          include: {
            ProductType: true,
            AssetDetail: true,
          },
        },
      },
    });
    if (!asset) {
      throw new NotFoundException('Activo no encontrado');
    }
    if (!asset.Asset) {
      return null;
    }
    return this.mapChildAsset(asset.Asset);
  }

  async getRelationships(assetID: number) {
    const asset = await this.prismaShopic.asset.findUnique({
      where: { AssetID: assetID },
      include: {
        ProductType: true,
        AssetDetail: true,
        Asset: {
          include: {
            ProductType: true,
            AssetDetail: true,
          },
        },
        other_Asset: {
          include: {
            ProductType: true,
            AssetDetail: true,
          },
        },
        User: true,
      },
    });
    if (!asset) {
      throw new NotFoundException('Activo no encontrado');
    }

    return {
      asset: {
        assetID: asset.AssetID,
        name: asset.Name,
        parentAssetID: asset.ParentAssetID,
        productType: asset.ProductType
          ? {
              productTypeID: asset.ProductType.ProductTypeID,
              name: asset.ProductType.Name,
              group: asset.ProductType.Group,
            }
          : null,
        model: asset.AssetDetail?.Model || null,
        serialNum: asset.AssetDetail?.SerialNum || null,
        user: asset.User
          ? { userID: asset.User.UserID, name: asset.User.Name }
          : null,
      },
      parentAsset: asset.Asset ? this.mapChildAsset(asset.Asset) : null,
      childAssets: asset.other_Asset.map(this.mapChildAsset),
    };
  }

  async assignChild(parentAssetID: number, childAssetID: number, userEmail?: string) {

     let userName: string | null = null;
      if (userEmail) {
        const user = await this.prismaShopic.user.findFirst({
          where: { Email: userEmail }
        });
        if (user) {
          userName = user.Name;
        }
      }
      
    const parent = await this.prismaShopic.asset.findUnique({
      where: { AssetID: parentAssetID },
      include: { ProductType: true },
    });
    if (!parent) {
      throw new NotFoundException('Activo padre no encontrado');
    }

    const child = await this.prismaShopic.asset.findUnique({
      where: { AssetID: childAssetID },
      include: { ProductType: true },
    });
    if (!child) {
      throw new NotFoundException('Activo hijo no encontrado');
    }

    // Validate: parent must be "Equipo"
    if (parent.ProductType?.Group !== 'Equipo') {
      throw new InternalServerErrorException({
        message: 'Solo los activos de tipo "Equipo" pueden tener componentes o accesorios asignados',
      });
    }

    // Validate: child must be "Componente" or "Accesorio"
    if (child.ProductType?.Group !== 'Componente' && child.ProductType?.Group !== 'Accesorio') {
      throw new InternalServerErrorException({
        message: 'Solo se pueden asignar activos de tipo "Componente" o "Accesorio" a un equipo',
      });
    }

    // Validate: child is not already assigned to another parent
    if (child.ParentAssetID && child.ParentAssetID !== parentAssetID) {
      throw new InternalServerErrorException({
        message: `Este activo ya esta asignado a otro equipo (ID: ${child.ParentAssetID})`,
      });
    }

    // Prevent self-assignment
    if (parentAssetID === childAssetID) {
      throw new InternalServerErrorException({
        message: 'Un activo no puede asignarse a si mismo',
      });
    }
    try{
      //inicia transaccion
      await this.prismaShopic.$transaction( async (tx) => {

        await tx.asset.update({
          where: { AssetID: childAssetID },
          data: { ParentAssetID: parentAssetID },
        });

        await tx.assetHistory.create({
          data: {
            AssetID: parentAssetID,
            Operation: 'ASSIGN',
            Description: `"${child.Name}" asignado a "${parent.Name}" | Registrado por: ${userName}`,
            CreatedTime: new Date(),
          },
        });

        await tx.assetHistory.create({
          data: {
            AssetID: childAssetID,
            Operation: 'ASSIGN',
            Description: `"${child.Name}" asignado a "${parent.Name}" | Registrado por: ${userName}`,
            CreatedTime: new Date(),
          },
        });

      });
      return {
        success: true,
        message: `"${child.Name}" asignado exitosamente a "${parent.Name}"`,
      };
    } catch (error: any) {
        if (error instanceof HttpException) {
          throw error;
        }
        throw new InternalServerErrorException({
          message: error.message || 'Error al asignar el activo al equipo',
        });
      }
  }

  async unassignChild(parentAssetID: number, childAssetID: number, userEmail?: string) {

    let userName: string | null = null;
      if (userEmail) {
        const user = await this.prismaShopic.user.findFirst({
          where: { Email: userEmail }
        });
        if (user) {
          userName = user.Name;
        }
      }

    const [child, parent] = await Promise.all([
      this.prismaShopic.asset.findUnique({ where: { AssetID: childAssetID } }),
      this.prismaShopic.asset.findUnique({ where: { AssetID: parentAssetID } }),
    ]);

    if (!child) {
      throw new NotFoundException(`Activo hijo con ID ${childAssetID} no encontrado`);
    }
    if (!parent) {
      throw new NotFoundException(`Activo padre con ID ${parentAssetID} no encontrado`);
    }
    if (child.ParentAssetID !== parentAssetID) {
      throw new BadRequestException('El activo especificado no está asignado a este equipo');
    }

    try{
      
    //inicia transaccion  
      await this.prismaShopic.$transaction( async (tx) => {
        
        // Desvincular hijo
        await tx.asset.update({
          where: { AssetID: childAssetID },
          data: { ParentAssetID: null },
        });
        // Registrar en historial del padre
        await tx.assetHistory.create({
          data: {
            AssetID: parentAssetID,
            Operation: 'UNASSIGN',
            Description: `"${child.Name}" removido del equipo "${parent.Name} | Registrado por: ${userName}`,
            CreatedTime: new Date(),
          },
        });
        // Registrar en historial del hijo
        await tx.assetHistory.create({
          data: {
            AssetID: childAssetID,
            Operation: 'UNASSIGN',
            Description: `"${child.Name}" removido del equipo "${parent.Name} | Registrado por: ${userName}`,
            CreatedTime: new Date(),
          },
        });

      });

    return {
      success: true,
      message: `"${child.Name}" se removio exitosamente`,
    };

    } catch (error: any){
      if (error instanceof HttpException){
        throw error;
      }
      console.error('[AssetService.unassignChild] Error en base de datos:', error);
      throw new InternalServerErrorException(
        'Ocurrió un error interno al intentar desasignar el activo del equipo',
      );
    }
  }

  async assignParent(childAssetID: number, parentAssetID: number, userEmail?: string) {
    return this.assignChild(parentAssetID, childAssetID, userEmail);
  }

  async unassignParent(childAssetID: number, userEmail?: string) {
    const child = await this.prismaShopic.asset.findUnique({
      where: { AssetID: childAssetID },
    });
    if (!child) {
      throw new NotFoundException('Activo no encontrado');
    }
    if (!child.ParentAssetID) {
      throw new InternalServerErrorException({
        message: 'Este activo no tiene un equipo asignado',
      });
    }

    return this.unassignChild(child.ParentAssetID, childAssetID, userEmail);
  }
}
