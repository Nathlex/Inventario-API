import { IsOptional, IsPositive, Min, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  //Bloque de página
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Min(1)
  page?: number = 1;

  //Bloque de límite
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  limit?: number = 20;

  //Bloque de búsqueda
  @IsOptional()
  @IsString()
  search?: string;
}