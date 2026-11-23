export interface PaginationMeta {
  total: number;       // Total general de registros encontrados
  page: number;        // Página actual
  limit: number;       // Registros por página
  totalPages: number;  // Total de páginas calculadas
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}