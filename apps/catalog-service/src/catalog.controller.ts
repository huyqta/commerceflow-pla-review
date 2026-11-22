// apps/catalog-service/src/catalog.controller.ts
// Catalog REST API Controller, DTO Validation, HTTP Status Codes & Access Control
// Đáp ứng các kịch bản R-01 (Catalog sản phẩm), R-06 (Security RBAC) trong docs/requirements.md
// Thiết kế Clean DTO Transformation ngăn chặn rò rỉ thực thể nội bộ (Internal Entity Leaking).
// Hoàn toàn tương thích Node.js 24 LTS native type-stripping.

/**
 * -------------------------------------------------------------
 * 1. HTTP Exception Classes & Status Codes
 * -------------------------------------------------------------
 */
export class HttpException extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(statusCode: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpException';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export class BadRequestException extends HttpException {
  constructor(message: string, details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'UNAUTHORIZED: Yêu cầu cung cấp Authentication Token hợp lệ') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'FORBIDDEN: Bạn không có quyền thực hiện thao tác này (Yêu cầu vai trò Staff hoặc Admin)') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'NOT_FOUND: Tài nguyên không tồn tại') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'CONFLICT: Tài nguyên đã tồn tại hoặc xảy ra xung đột dữ liệu') {
    super(409, 'CONFLICT', message);
  }
}

/**
 * -------------------------------------------------------------
 * 2. Data Transfer Objects (DTO) & Contract Interfaces
 * -------------------------------------------------------------
 */
export interface CreateProductDto {
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly price: number;
  readonly currency?: string;
  readonly initialStock?: number;
}

export interface ProductResponseDto {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly price: number;
  readonly currency: string;
  readonly availableStock: number;
  readonly createdAt: string;
}

export interface ProductQueryDto {
  readonly search?: string;
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly page?: number;
  readonly limit?: number;
}

export interface PaginatedProductsResponse {
  readonly items: ProductResponseDto[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export interface HttpResponse<T> {
  readonly statusCode: number;
  readonly data: T;
  readonly timestamp: string;
}

/**
 * -------------------------------------------------------------
 * 3. Security & Auth Context (R-06 Security Scenarios)
 * -------------------------------------------------------------
 */
export type UserRole = 'admin' | 'staff' | 'viewer';

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly role: UserRole;
}

export interface RequestContext {
  readonly user?: AuthUser;
  readonly correlationId?: string;
}

/**
 * -------------------------------------------------------------
 * 4. Internal Domain/DB Entity (Mô phỏng dữ liệu nội bộ)
 * -------------------------------------------------------------
 * Trade-off: Internal Entity chứa thông tin nhạy cảm (internalCost, supplierNotes,
 * auditHistory, deletedAt). TUYỆT ĐỐI KHÔNG trả entity này trực tiếp ra REST API!
 */
export interface ProductEntity {
  id: string;
  sku: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  stock: number;
  // Các trường nội bộ nhạy cảm:
  internalCost: number;       // Giá vốn nhập hàng (Bí mật kinh doanh)
  supplierId: string;         // Nhà cung cấp nội bộ
  supplierNotes?: string;     // Ghi chú đàm phán giá
  isDeleted: boolean;         // Xóa mềm
  version: number;            // Phiên bản OCC
  createdAt: Date;
  updatedAt: Date;
}

export function toProductResponseDto(entity: ProductEntity): ProductResponseDto {
  return {
    id: entity.id,
    sku: entity.sku,
    name: entity.name,
    description: entity.description,
    price: entity.price,
    currency: entity.currency,
    availableStock: entity.stock,
    createdAt: entity.createdAt.toISOString(),
  };
}

/**
 * -------------------------------------------------------------
 * 5. Input Validation Logic (Fail-fast Validation & Negative Tests)
 * -------------------------------------------------------------
 */
export function validateCreateProductDto(input: unknown): CreateProductDto {
  if (!input || typeof input !== 'object') {
    throw new BadRequestException('PAYLOAD_REQUIRED: Body request không được để trống và phải là JSON object.');
  }

  const payload = input as Record<string, unknown>;
  const errors: string[] = [];

  // 1. Kiểm tra SKU (Mã sản phẩm duy nhất)
  const sku = typeof payload.sku === 'string' ? payload.sku.trim() : '';
  if (!sku) {
    errors.push('sku là bắt buộc và không được để trống.');
  } else if (!/^[A-Za-z0-9_-]{3,50}$/.test(sku)) {
    errors.push('sku không hợp lệ. Phải từ 3-50 ký tự chữ cái, số, gạch ngang (-) hoặc gạch dưới (_).');
  }

  // 2. Kiểm tra Name (Tên sản phẩm)
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    errors.push('name là bắt buộc và không được để trống.');
  } else if (name.length < 2 || name.length > 255) {
    errors.push('name phải có độ dài từ 2 đến 255 ký tự.');
  }

  // 3. Thử thách độc lập: Kiểm tra Giá (Price Validation - Negative Test)
  const price = payload.price;
  if (price === undefined || price === null || price === '') {
    errors.push('price là bắt buộc.');
  } else if (typeof price !== 'number' || !Number.isFinite(price)) {
    errors.push('price phải là số thực hữu hạn hợp lệ.');
  } else if (price < 0) {
    errors.push('INVALID_PRICE: Giá sản phẩm không được là số âm (price >= 0).');
  }

  // 4. Kiểm tra Tiền tệ (Currency)
  let currency = 'VND';
  if (payload.currency !== undefined && payload.currency !== null) {
    if (typeof payload.currency !== 'string' || !payload.currency.trim()) {
      errors.push('currency phải là chuỗi mã tiền tệ hợp lệ (ví dụ: VND, USD).');
    } else {
      currency = payload.currency.trim().toUpperCase();
    }
  }

  // 5. Kiểm tra Tồn kho ban đầu (Initial Stock)
  let initialStock = 0;
  if (payload.initialStock !== undefined && payload.initialStock !== null) {
    if (typeof payload.initialStock !== 'number' || !Number.isInteger(payload.initialStock)) {
      errors.push('initialStock phải là số nguyên.');
    } else if (payload.initialStock < 0) {
      errors.push('initialStock không được là số âm (initialStock >= 0).');
    } else {
      initialStock = payload.initialStock;
    }
  }

  if (errors.length > 0) {
    throw new BadRequestException(`VALIDATION_FAILED: ${errors.join(' ')}`, errors);
  }

  return {
    sku,
    name,
    description: typeof payload.description === 'string' ? payload.description.trim() : undefined,
    price: price as number,
    currency,
    initialStock,
  };
}

/**
 * -------------------------------------------------------------
 * 6. Catalog In-Memory Store & Repository
 * -------------------------------------------------------------
 */
export class InMemoryCatalogRepository {
  private readonly items = new Map<string, ProductEntity>();

  constructor(initialData: ProductEntity[] = []) {
    for (const item of initialData) {
      this.items.set(item.id, item);
    }
  }

  public async findAll(): Promise<ProductEntity[]> {
    return Array.from(this.items.values()).filter((p) => !p.isDeleted);
  }

  public async findById(id: string): Promise<ProductEntity | null> {
    const item = this.items.get(id);
    if (!item || item.isDeleted) return null;
    return item;
  }

  public async findBySku(sku: string): Promise<ProductEntity | null> {
    if (!sku || typeof sku !== 'string') return null;
    const target = sku.toLowerCase();
    for (const item of this.items.values()) {
      if (!item.isDeleted && item.sku && item.sku.toLowerCase() === target) {
        return item;
      }
    }
    return null;
  }

  public async save(entity: ProductEntity): Promise<ProductEntity> {
    this.items.set(entity.id, entity);
    return entity;
  }

  public async clear(): Promise<void> {
    this.items.clear();
  }
}

/**
 * -------------------------------------------------------------
 * 7. Catalog REST Controller
 * -------------------------------------------------------------
 * Cung cấp API GET/POST chuẩn RESTful:
 * - GET  /products        (200 OK)
 * - GET  /products/:id    (200 OK, 404 NOT FOUND)
 * - POST /products        (201 CREATED, 400 BAD REQUEST, 401 UNAUTHORIZED, 403 FORBIDDEN, 409 CONFLICT)
 */
export class CatalogController {
  private readonly repository: InMemoryCatalogRepository;

  constructor(repository: InMemoryCatalogRepository = new InMemoryCatalogRepository()) {
    this.repository = repository;
  }

  /**
   * Helper kiểm tra phân quyền (RBAC - kịch bản R-06)
   */
  private checkAuthorization(context?: RequestContext, allowedRoles: UserRole[] = ['admin', 'staff']): void {
    if (!context || !context.user) {
      throw new UnauthorizedException('UNAUTHORIZED: Yêu cầu cung cấp Authentication Token');
    }
    if (!allowedRoles.includes(context.user.role)) {
      throw new ForbiddenException(
        `FORBIDDEN: Người dùng vai trò '${context.user.role}' không được phép thực hiện thao tác ghi trên Catalog!`
      );
    }
  }

  /**
   * GET /api/v1/products
   * Lấy danh sách sản phẩm có hỗ trợ phân trang và tìm kiếm
   */
  public async getProducts(
    query: ProductQueryDto = {},
    _context?: RequestContext
  ): Promise<HttpResponse<PaginatedProductsResponse>> {
    const allProducts = await this.repository.findAll();

    let filtered = allProducts;

    // Tìm kiếm theo tên hoặc SKU
    if (query.search && query.search.trim()) {
      const term = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)
      );
    }

    // Lọc theo khoảng giá
    if (typeof query.minPrice === 'number') {
      filtered = filtered.filter((p) => p.price >= query.minPrice!);
    }
    if (typeof query.maxPrice === 'number') {
      filtered = filtered.filter((p) => p.price <= query.maxPrice!);
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 10));
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;

    const startIndex = (page - 1) * limit;
    const pagedItems = filtered.slice(startIndex, startIndex + limit);

    // Chuyển đổi sang Public DTO (không lộ trường nội bộ)
    const itemsDto = pagedItems.map(toProductResponseDto);

    return {
      statusCode: 200,
      timestamp: new Date().toISOString(),
      data: {
        items: itemsDto,
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * GET /api/v1/products/:id
   * Lấy thông tin chi tiết của một sản phẩm
   */
  public async getProductById(
    id: string,
    _context?: RequestContext
  ): Promise<HttpResponse<ProductResponseDto>> {
    if (!id || !id.trim()) {
      throw new BadRequestException('PRODUCT_ID_REQUIRED: Mã sản phẩm id không được để trống.');
    }

    const product = await this.repository.findById(id.trim());
    if (!product) {
      throw new NotFoundException(`NOT_FOUND: Không tìm thấy sản phẩm có mã id '${id}'`);
    }

    return {
      statusCode: 200,
      timestamp: new Date().toISOString(),
      data: toProductResponseDto(product),
    };
  }

  /**
   * POST /api/v1/products
   * Tạo mới sản phẩm trong Catalog (Yêu cầu quyền Staff hoặc Admin)
   */
  public async createProduct(
    body: unknown,
    context?: RequestContext
  ): Promise<HttpResponse<ProductResponseDto>> {
    // 1. Kiểm tra xác thực & phân quyền (R-06 Security Invariant)
    this.checkAuthorization(context, ['admin', 'staff']);

    // 2. Validate DTO (Fail-fast validation)
    const dto = validateCreateProductDto(body);

    // 3. Kiểm tra tính duy nhất của SKU (Chống trùng lặp sản phẩm)
    const existing = await this.repository.findBySku(dto.sku);
    if (existing) {
      throw new ConflictException(`SKU_ALREADY_EXISTS: Sản phẩm có SKU '${dto.sku}' đã tồn tại trong catalog.`);
    }

    // 4. Khởi tạo Entity nội bộ
    const newId = `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const entity: ProductEntity = {
      id: newId,
      sku: dto.sku,
      name: dto.name,
      description: dto.description,
      price: dto.price,
      currency: dto.currency || 'VND',
      stock: dto.initialStock ?? 0,
      // Dữ liệu nội bộ tuyệt đối không bị lộ ra DTO
      internalCost: Math.round(dto.price * 0.7), // Giả lập giá vốn nội bộ 70%
      supplierId: 'SUPPLIER-DEFAULT-VN',
      supplierNotes: 'Hợp đồng đại lý tiêu chuẩn',
      isDeleted: false,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.repository.save(entity);

    // 5. Trả về Response DTO với HTTP 201 Created
    return {
      statusCode: 201,
      timestamp: new Date().toISOString(),
      data: toProductResponseDto(entity),
    };
  }
}

