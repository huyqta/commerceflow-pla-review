// apps/web/src/features/catalog/ProductList.tsx
// Product Management & Inventory Dashboard Component
// Phục vụ Milestone M5 (CF-025 — Product Management và Inventory Dashboard)
// Cài đặt 4 trạng thái UI: Loading, Error, Empty State, Data State
// Thiết kế có thể chạy trực tiếp trên Node.js hoặc React environment

export interface ProductItem {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly price: number;
  readonly currency: string;
  readonly availableStock: number;
  readonly reservedStock: number;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}

export type ViewStateKind = 'loading' | 'error' | 'empty' | 'data';

export interface ProductListState {
  readonly loading: boolean;
  readonly error: string | null;
  readonly items: readonly ProductItem[];
  readonly lastFetchedAt?: Date;
}

export interface RenderResult {
  readonly stateKind: ViewStateKind;
  readonly title: string;
  readonly ariaLive: 'polite' | 'assertive' | 'off';
  readonly html: string;
}

/**
 * Hàm phân loại view state theo tiêu chuẩn micro-lab và thực tế
 */
export function resolveViewState(state: {
  loading: boolean;
  error: string | null;
  items: readonly unknown[];
}): ViewStateKind {
  if (state.loading) return 'loading';
  if (state.error) return 'error';
  if (state.items.length > 0) return 'data';
  return 'empty';
}

/**
 * Controller/Component điều phối ProductList & Inventory Dashboard
 */
export class ProductListComponent {
  private state: ProductListState;

  constructor(initialState?: Partial<ProductListState>) {
    this.state = {
      loading: initialState?.loading ?? false,
      error: initialState?.error ?? null,
      items: initialState?.items ?? [],
      lastFetchedAt: initialState?.lastFetchedAt,
    };
  }

  public getState(): ProductListState {
    return this.state;
  }

  public setLoading(): void {
    this.state = {
      ...this.state,
      loading: true,
      error: null,
    };
  }

  public setError(errorMessage: string): void {
    this.state = {
      ...this.state,
      loading: false,
      error: errorMessage,
    };
  }

  public setData(products: ProductItem[]): void {
    this.state = {
      loading: false,
      error: null,
      items: Object.freeze([...products]),
      lastFetchedAt: new Date(),
    };
  }

  /**
   * Render view tương ứng với 4 trạng thái: Loading, Error, Empty, Data
   */
  public render(): RenderResult {
    const kind = resolveViewState(this.state);

    switch (kind) {
      case 'loading':
        return {
          stateKind: 'loading',
          title: 'Đang tải danh mục sản phẩm...',
          ariaLive: 'polite',
          html: `
<div class="product-list-state loading-state" role="status" aria-busy="true">
  <div class="spinner" aria-hidden="true"></div>
  <p>Đang tải dữ liệu sản phẩm và tồn kho từ Catalog Service...</p>
</div>`.trim(),
        };

      case 'error':
        return {
          stateKind: 'error',
          title: 'Lỗi tải dữ liệu',
          ariaLive: 'assertive',
          html: `
<div class="product-list-state error-state" role="alert">
  <h3>Không thể tải danh mục sản phẩm</h3>
  <p class="error-message">${this.state.error}</p>
  <button type="button" class="btn-retry" onclick="window.location.reload()">Thử lại</button>
</div>`.trim(),
        };

      case 'empty':
        return {
          stateKind: 'empty',
          title: 'Chưa có sản phẩm nào',
          ariaLive: 'polite',
          html: `
<div class="product-list-state empty-state" role="region" aria-label="Danh mục rỗng">
  <div class="empty-icon" aria-hidden="true">📦</div>
  <h3>Danh mục sản phẩm hiện đang rỗng</h3>
  <p>Chưa có sản phẩm nào được tạo trong hệ thống. Hãy thêm sản phẩm mới để bắt đầu kinh doanh.</p>
  <a href="/products/new" class="btn-primary">Thêm sản phẩm đầu tiên</a>
</div>`.trim(),
        };

      case 'data':
      default: {
        const rows = this.state.items
          .map(item => {
            const isOutOfStock = item.availableStock <= 0;
            const stockBadge = isOutOfStock
              ? `<span class="badge badge-danger">Hết hàng</span>`
              : `<span class="badge badge-success">${item.availableStock}</span>`;

            return `
    <tr class="product-row" data-id="${item.id}" data-sku="${item.sku}">
      <td><code>${item.sku}</code></td>
      <td><strong>${item.name}</strong></td>
      <td>${item.price.toLocaleString('vi-VN')} ${item.currency}</td>
      <td>${stockBadge}</td>
      <td>${item.reservedStock}</td>
      <td><span class="status-${item.status.toLowerCase()}">${item.status}</span></td>
    </tr>`.trim();
          })
          .join('\n');

        return {
          stateKind: 'data',
          title: `Danh sách sản phẩm (${this.state.items.length})`,
          ariaLive: 'polite',
          html: `
<div class="product-list-state data-state" role="region" aria-label="Danh sách sản phẩm và tồn kho">
  <table class="products-table">
    <thead>
      <tr>
        <th scope="col">Mã SKU</th>
        <th scope="col">Tên sản phẩm</th>
        <th scope="col">Đơn giá</th>
        <th scope="col">Tồn kho khả dụng</th>
        <th scope="col">Đang giữ (Reserved)</th>
        <th scope="col">Trạng thái</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>`.trim(),
        };
      }
    }
  }
}

export default ProductListComponent;

