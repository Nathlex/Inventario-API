import { PaginationDto } from 'src/common/dto/pagination.dto';
import { IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAssetDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  companyID?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  siteID?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  departID?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  assetStateID?: number;
}