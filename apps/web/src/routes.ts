// apps/web/src/routes.ts
// Route definitions, navigation metadata & route matching engine cho UI Shell
// Phục vụ Milestone M5 (CF-024 — ReactJS/Vite routing và UI shell)

export interface RouteItem {
  readonly path: string;
  readonly label: string;
  readonly description: string;
  readonly icon?: string;
  readonly requiredRole?: 'viewer' | 'staff' | 'admin';
  readonly isNav: boolean;
}

export const APP_ROUTES: readonly RouteItem[] = [
  {
    path: '/',
    label: 'Dashboard',
    description: 'Tổng quan hoạt động kinh doanh CommerceFlow',
    icon: 'dashboard',
    isNav: true,
  },
  {
    path: '/products',
    label: 'Catalog & Products',
    description: 'Quản lý danh mục sản phẩm và giá bán',
    icon: 'box',
    isNav: true,
  },
  {
    path: '/inventory',
    label: 'Inventory Dashboard',
    description: 'Theo dõi tồn kho khả dụng và cảnh báo hết hàng',
    icon: 'archive',
    isNav: true,
  },
  {
    path: '/orders',
    label: 'Order Management',
    description: 'Đặt hàng, theo dõi trạng thái Saga và bồi hoàn',
    icon: 'shopping-cart',
    isNav: true,
  },
  {
    path: '/login',
    label: 'Đăng nhập',
    description: 'Xác thực tài khoản người dùng',
    isNav: false,
  },
] as const;

export interface MatchRouteResult {
  readonly matched: boolean;
  readonly route?: RouteItem;
  readonly is404: boolean;
  readonly path: string;
}

/**
 * Trình khớp route hỗ trợ exact match và fallback trang 404 (Thử thách độc lập CF-024)
 */
export function matchRoute(currentPath: string): MatchRouteResult {
  const normalizedPath = currentPath.trim().toLowerCase().split('?')[0].split('#')[0] || '/';
  const found = APP_ROUTES.find(r => r.path === normalizedPath);

  if (found) {
    return {
      matched: true,
      route: found,
      is404: false,
      path: normalizedPath,
    };
  }

  return {
    matched: false,
    is404: true,
    path: normalizedPath,
  };
}

/**
 * Lấy danh sách routes phục vụ cho thanh điều hướng chính (Navigation Bar)
 */
export function getNavRoutes(): RouteItem[] {
  return APP_ROUTES.filter(r => r.isNav);
}

