import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaShopic } from 'src/database/database.service';

interface DashboardFilters {
  siteID?: number;
  group?: string;
  stateID?: number;
}

@Injectable()
export class StatisticsService {
  constructor(private readonly prismaShopic: PrismaShopic) {}

  async getDashboardStats(filters: DashboardFilters = {}) {
    try {
      // Construcción de filtros base
      const where: Record<string, unknown> = {};
      if (filters.siteID) where.SiteID = filters.siteID;
      if (filters.stateID) where.AssetState = filters.stateID;
      if (filters.group) {
        where.ProductType = { Group: filters.group };
      }
      //Filtro relacional para AssetHistory
      const historyWhere: Record<string, unknown> = {};
      if (filters.siteID || filters.stateID || filters.group) {
        historyWhere.Asset = where;
      }
      //Fechas de corte para consultas en la base de datosconst 
      const now = new Date(); 
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

      const [
        assets,  
        assignedAssetsCount,     
        inactiveAssetsCount,
        assetsBySiteRaw,    
        assetsByStateRaw,           
        recentHistory,           
        recentMovementsRaw,     
        assetStates,             
        sites,                   
        productTypes,            
      ] = await Promise.all([
        //Consulta de activos
       this.prismaShopic.asset.findMany({
          where,
          select: {
            AssetID: true,
            Name: true,
            SiteID: true,
            UserID: true,
            ProductType: {
              select: { Name: true },
            },
            AssetDetail: {
              select: {
                WarrantyExpiryDate: true,
                AssetACQDate: true,
              },
            },
          },
        }),
        //Conteo de equipos asignados con usuario
        this.prismaShopic.asset.count({
          where: {
            ...where,
            UserID: { not: null },
            AssetState_Asset_AssetStateToAssetState: { Name: 'Asignado' },
          },
        }),
        //Conteo de equipos inactivos
        this.prismaShopic.asset.count({
          where: {
            ...where,
            AssetState_Asset_AssetStateToAssetState: {
              Name: { in: ['Baja', 'Mantenimiento', 'Resguardo'] },
            },
          },
        }),
        //Agrupación por sede en SQL
        this.prismaShopic.asset.groupBy({
          by: ['SiteID'],
          where,
          _count: { _all: true },
        }),
        //Agrupación por estado en SQL
        this.prismaShopic.asset.groupBy({
          by: ['AssetState'],
          where,
          _count: { _all: true },
        }),
        //Consulta de fechas de los últimos 6 meses
        this.prismaShopic.assetHistory.findMany({
          where: {
            ...historyWhere,
            CreatedTime: { gte: sixMonthsAgo },
          },
          select: { CreatedTime: true },
        }),
        //Consulta de los últimos 10 movimientos
        this.prismaShopic.assetHistory.findMany({
          where: historyWhere,
          select: {
            AssetID: true,
            Operation: true,
            Description: true,
            CreatedTime: true,
            Asset: {
              select: {
                Name: true,
                User: { select: { Name: true } },
              },
            },
          },
          orderBy: { CreatedTime: 'desc' },
          take: 10,
        }),
        //Estados
        this.prismaShopic.assetState.findMany(),
        //Sedes
        this.prismaShopic.site.findMany(),
        //Tipos de producto
        this.prismaShopic.productType.findMany(),
      ]);

      const totalAssets = assets.length;
      //Distribución de activos por sede
      const siteMap = new Map(sites.map((s) => [s.SiteID, s.Name]));

      // Construir un mapa (Map): AssetID → detalle (a partir de la relación AssetDetail incluida)
      const detailMap = new Map<number, { WarrantyExpiryDate: Date | null; AssetACQDate: Date | null }>();
      for (const a of assets) {
        if (a.AssetDetail) {
          detailMap.set(a.AssetID, a.AssetDetail);
        }
      }

      // ========== UTILIZACIÓN Y DISPONIBILIDAD ==========

      const assignedAssets = assignedAssetsCount;
      const utilizationRate = totalAssets > 0 ? Math.round((assignedAssets / totalAssets) * 100) : 0;

      const inactiveAssets = inactiveAssetsCount;
      const inactiveRate = totalAssets > 0 ? Math.round((inactiveAssets / totalAssets) * 100) : 0;

      // ========== CICLO DE VIDA Y OBSOLESCENCIA ==========

      // Índice de obsolescencia (assets > 4 years old)
      const fourYearsAgo = new Date();
      fourYearsAgo.setFullYear(fourYearsAgo.getFullYear() - 4);

      let obsoleteCount = 0;
      let totalWithAcqDate = 0;
      for (const asset of assets) {
        const detail = detailMap.get(asset.AssetID);
        if (detail?.AssetACQDate) {
          totalWithAcqDate++;
          if (new Date(detail.AssetACQDate) < fourYearsAgo) {
            obsoleteCount++;
          }
        }
      }
      const obsolescenceRate = totalWithAcqDate > 0 ? Math.round((obsoleteCount / totalWithAcqDate) * 100) : 0;

      // Activos próximos a vencer garantía (within 90 days)
      const ninetyDaysFromNow = new Date();
      ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

      let warrantyExpiringCount = 0;
      const warrantyAlertsList: {
        name: string,
        site: string,
        daysUntilExpiry: number,
      }[] = [];

      for (const asset of assets) {
        const detail = detailMap.get(asset.AssetID);
        if (detail?.WarrantyExpiryDate) {
          const expiryDate = new Date(detail.WarrantyExpiryDate);
          if (expiryDate > now && expiryDate <= ninetyDaysFromNow) {
            warrantyExpiringCount++;
            const daysUntilExpiry = Math.ceil(
              (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            );
            warrantyAlertsList.push({
              name: asset.Name,
              site: (asset.SiteID ? siteMap.get(asset.SiteID) : null) || 'Sin sede',
              daysUntilExpiry,
            });
          }
        }
      }

      // Sort warranty alerts by days ascending (most urgent first)
      warrantyAlertsList.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

      // Antigüedad promedio por tipo de equipo
      const ageByType = new Map<string, { totalYears: number; count: number }>();
      for (const asset of assets) {
        const detail = detailMap.get(asset.AssetID);
        if (detail?.AssetACQDate && asset.ProductType) {
          const acqDate = new Date(detail.AssetACQDate);
          const ageYears = (now.getTime() - acqDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
          const typeName = asset.ProductType.Name;
          const current = ageByType.get(typeName) || { totalYears: 0, count: 0 };
          current.totalYears += ageYears;
          current.count++;
          ageByType.set(typeName, current);
        }
      }
      const avgAgeByType = Array.from(ageByType.entries())
        .map(([type, data]) => ({
          type,
          avgYears: Math.round((data.totalYears / data.count) * 10) / 10,
          count: data.count,
        }))
        .sort((a, b) => b.avgYears - a.avgYears);

      // ========== DISTRIBUCIÓN Y TRAZABILIDAD ==========

      const distributionBySite = assetsBySiteRaw
        .map((group) => ({
          site: (group.SiteID ? siteMap.get(group.SiteID) : null) || 'Sin sede',
          count: group._count._all,
        }))
        .sort((a, b) => b.count - a.count);
  
      // Cobertura de garantía activa
      let activeWarrantyCount = 0;
      let totalWithWarranty = 0;
      for (const asset of assets) {
        const detail = detailMap.get(asset.AssetID);
        if (detail?.WarrantyExpiryDate) {
          totalWithWarranty++;
          if (new Date(detail.WarrantyExpiryDate) > now) {
            activeWarrantyCount++;
          }
        }
      }
      const warrantyCoverageRate = totalWithWarranty > 0
        ? Math.round((activeWarrantyCount / totalWithWarranty) * 100)
        : 0;

      // ========== Movements by month (last 6 months) ==========
      const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const movementsByMonth: { month: string; count: number }[] = [];

      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);

        const count = recentHistory.filter((h) => {
          const created = new Date(h.CreatedTime);
          return created >= monthStart && created < monthEnd;
        }).length;

        movementsByMonth.push({
          month: monthNames[d.getMonth()],
          count,
        });
      }

      const recentMovements = recentMovementsRaw.slice(0, 10).map((m) => ({
        assetName: m.Asset?.Name || 'N/A',
        operation: m.Operation,
        user: m.Asset?.User?.Name || '—',
        date: m.CreatedTime,
      }));

      // ========== STATS BY STATE ==========
      const stateMap = new Map(assetStates.map((s) => [s.AssetStateID, s.Name]));

      const distributionByState = assetsByStateRaw
        .map((group) => ({
          state: (group.AssetState ? stateMap.get(group.AssetState) : null) || 'Sin estado',
          count: group._count._all,
        }))
        .sort((a, b) => b.count - a.count);

      // Warranty expiring percentage
      const warrantyExpiringPercent = totalAssets > 0
        ? Math.round((warrantyExpiringCount / totalAssets) * 1000) / 10
        : 0;

      // ========== DATA COMPLETENESS ==========
      const noSiteCount = assets.filter((a) => !a.SiteID).length;
      const noUserCount = assets.filter((a) => !a.UserID).length;
      const noAcqDateCount = assets.filter((a) => !detailMap.get(a.AssetID)?.AssetACQDate).length;
      const noWarrantyCount = assets.filter((a) => !detailMap.get(a.AssetID)?.WarrantyExpiryDate).length;
      const dataCompleteness = {
        noSiteCount,
        noUserCount,
        noAcqDateCount,
        noWarrantyCount,
        completenessPercent: totalAssets > 0
          ? Math.round(((totalAssets - noAcqDateCount) / totalAssets) * 100)
          : 0,
      };

      // ========== SITE RISK RANKING (semáforo por hotel) ==========
      const siteRiskMap = new Map<string, { siteID: number; name: string; total: number; obsolete: number; noWarranty: number; noUser: number }>();
      for (const asset of assets) {
        const siteName = (asset.SiteID ? siteMap.get(asset.SiteID) : null) || 'Sin sede';
        const siteID = asset.SiteID || 0;
        if (!siteRiskMap.has(siteName)) {
          siteRiskMap.set(siteName, { siteID, name: siteName, total: 0, obsolete: 0, noWarranty: 0, noUser: 0 });
        }
        const entry = siteRiskMap.get(siteName)!;
        entry.total++;
        const detail = detailMap.get(asset.AssetID);
        if (detail?.AssetACQDate && new Date(detail.AssetACQDate) < fourYearsAgo) entry.obsolete++;
        if (!detail?.WarrantyExpiryDate || new Date(detail.WarrantyExpiryDate) < now) entry.noWarranty++;
        if (!asset.UserID) entry.noUser++;
      }
      const siteRiskRanking = Array.from(siteRiskMap.values())
        .map((s) => {
          const riskScore = s.total > 0
            ? Math.round(((s.obsolete + s.noWarranty + s.noUser) / (s.total * 3)) * 100)
            : 0;
          const level: 'green' | 'yellow' | 'red' = riskScore <= 30 ? 'green' : riskScore <= 60 ? 'yellow' : 'red';
          return { ...s, riskScore, level };
        })
        .sort((a, b) => b.riskScore - a.riskScore);

      // ========== WARRANTY TIMELINE (next 3, 6, 12 months) ==========
      const threeMonths = new Date(); threeMonths.setMonth(threeMonths.getMonth() + 3);
      const sixMonths = new Date(); sixMonths.setMonth(sixMonths.getMonth() + 6);
      const twelveMonths = new Date(); twelveMonths.setMonth(twelveMonths.getMonth() + 12);

      let warranty3m = 0, warranty6m = 0, warranty12m = 0;
      for (const asset of assets) {
        const detail = detailMap.get(asset.AssetID);
        if (detail?.WarrantyExpiryDate) {
          const exp = new Date(detail.WarrantyExpiryDate);
          if (exp > now && exp <= threeMonths) warranty3m++;
          else if (exp > threeMonths && exp <= sixMonths) warranty6m++;
          else if (exp > sixMonths && exp <= twelveMonths) warranty12m++;
        }
      }
      const warrantyTimeline = [
        { period: '0-3 meses', count: warranty3m },
        { period: '3-6 meses', count: warranty6m },
        { period: '6-12 meses', count: warranty12m },
      ];

      // ========== FILTER OPTIONS (for frontend dropdowns) ==========
      const filterOptions = {
        sites: sites.map((s) => ({ siteID: s.SiteID, name: s.Name })),
        groups: [...new Set(productTypes.map((pt) => pt.Group))].filter(Boolean).sort(),
        states: assetStates.map((s) => ({ stateID: s.AssetStateID, name: s.Name })),
      };

      return {
        summary: {
          totalAssets,
          assignedAssets,
          inactiveAssets,
          obsoleteCount,
          warrantyExpiringCount,
          activeWarrantyCount,
          unassignedCount: totalAssets - assignedAssets,
          warrantyExpiringPercent,
        },
        kpis: {
          utilizationRate,
          inactiveRate,
          obsolescenceRate,
          warrantyCoverageRate,
          warrantyExpiringCount,
          avgAgeByType,
        },
        distributions: {
          bySite: distributionBySite,
          byState: distributionByState,
        },
        movementsByMonth,
        warrantyAlerts: warrantyAlertsList.slice(0, 10),
        recentMovements,
        assetsTable: [],
        filterOptions,
        dataCompleteness,
        siteRiskRanking,
        warrantyTimeline,
      };
    } catch (error:any) {
      throw new InternalServerErrorException({
        message: error.message || 'Error al obtener estadísticas del dashboard',
      });
    }
  }
}
