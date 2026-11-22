// apps/web/src/App.tsx
// ReactJS UI Shell, Responsive Navigation & Accessible Route Layout
// Deliverable chính cho Milestone M5 (CF-024 — ReactJS/Vite routing và UI shell)
// Thiết kế tách bạch Presentation vs Data Layer, hỗ trợ ARIA Accessible landmarks và 404 Not Found Page.

import { APP_ROUTES, matchRoute, getNavRoutes, type RouteItem } from './routes.ts';
import { defaultApiClient, type IApiClient } from './services/api-client.ts';

export interface UserSession {
  readonly username: string;
  readonly role: 'viewer' | 'staff' | 'admin';
  readonly token: string;
}

export interface AppProps {
  readonly initialPath?: string;
  readonly userSession?: UserSession;
  readonly apiClient?: IApiClient;
}

export interface AppState {
  currentPath: string;
  userSession?: UserSession;
}

export interface RenderedView {
  title: string;
  content: string;
  ariaRole: string;
  isNotFound: boolean;
}

/**
 * Shell Component chính của ứng dụng Web CommerceFlow
 * Cung cấp:
 * - Header & Navigation Bar với đầy đủ nhãn ngữ nghĩa (aria-label, role='navigation')
 * - Main Content landmark (role='main')
 * - Footer (role='contentinfo')
 * - Routing Switcher phân định các views: /products, /inventory, /orders và 404 Fallback
 */
export class AppShell {
  private state: AppState;
  private readonly apiClient: IApiClient;

  constructor(props: AppProps = {}) {
    this.state = {
      currentPath: props.initialPath || '/',
      userSession: props.userSession,
    };
    this.apiClient = props.apiClient || defaultApiClient;
  }

  public getCurrentPath(): string {
    return this.state.currentPath;
  }

  public navigate(path: string): void {
    this.state.currentPath = path;
  }

  public getUserSession(): UserSession | undefined {
    return this.state.userSession;
  }

  public setUserSession(session: UserSession | undefined): void {
    this.state.userSession = session;
  }

  /**
   * Render Navigation Menu có ARIA Accessible Landmarks
   */
  public renderNavigation(): {
    navAriaLabel: string;
    items: Array<{ path: string; label: string; isActive: boolean }>;
  } {
    const navRoutes = getNavRoutes();
    return {
      navAriaLabel: 'Main Navigation',
      items: navRoutes.map(r => ({
        path: r.path,
        label: r.label,
        isActive: this.state.currentPath === r.path,
      })),
    };
  }

  /**
   * Khớp và render view hiện tại theo đường dẫn
   */
  public renderCurrentView(): RenderedView {
    const match = matchRoute(this.state.currentPath);

    if (match.is404 || !match.route) {
      return {
        title: '404 - Không tìm thấy trang (Page Not Found)',
        content: `Đường dẫn "${match.path}" không tồn tại trên hệ thống CommerceFlow. Vui lòng kiểm tra lại URL hoặc quay về Dashboard.`,
        ariaRole: 'alert',
        isNotFound: true,
      };
    }

    switch (match.route.path) {
      case '/':
        return {
          title: 'CommerceFlow Management Dashboard',
          content: 'Chào mừng bạn đến với hệ sinh thái quản lý thương mại Cloud-Native CommerceFlow.',
          ariaRole: 'region',
          isNotFound: false,
        };
      case '/products':
        return {
          title: 'Catalog & Product Management',
          content: 'Quản lý danh mục sản phẩm, đơn giá niêm yết và thông tin SKU.',
          ariaRole: 'region',
          isNotFound: false,
        };
      case '/inventory':
        return {
          title: 'Inventory Real-time Dashboard',
          content: 'Theo dõi lượng tồn kho thực tế, tồn kho khả dụng và cảnh báo thiếu hụt.',
          ariaRole: 'region',
          isNotFound: false,
        };
      case '/orders':
        return {
          title: 'Order Management & Saga Tracking',
          content: 'Theo dõi quy trình đặt hàng phân tán, trạng thái Saga và bồi hoàn kho tự động.',
          ariaRole: 'region',
          isNotFound: false,
        };
      default:
        return {
          title: match.route.label,
          content: match.route.description,
          ariaRole: 'region',
          isNotFound: false,
        };
    }
  }

  /**
   * Sinh cấu trúc HTML ngữ nghĩa của toàn bộ UI Shell (cho Server-Side Render hoặc Testing)
   */
  public renderHtml(): string {
    const nav = this.renderNavigation();
    const view = this.renderCurrentView();
    const user = this.state.userSession;

    const navItemsHtml = nav.items
      .map(
        i =>
          `<li class="nav-item${i.isActive ? ' active' : ''}"><a href="${i.path}" aria-current="${
            i.isActive ? 'page' : 'false'
          }">${i.label}</a></li>`
      )
      .join('\n        ');

    const authSnippet = user
      ? `<div class="user-info" aria-label="Thông tin đăng nhập">Xin chào, <strong>${user.username}</strong> (${user.role})</div>`
      : `<div class="auth-actions"><a href="/login">Đăng nhập</a></div>`;

    return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${view.title} - CommerceFlow</title>
</head>
<body>
  <div id="app" class="commerceflow-app">
    <header class="app-header" role="banner">
      <div class="brand">
        <h1>CommerceFlow</h1>
      </div>
      <nav class="app-nav" role="navigation" aria-label="${nav.navAriaLabel}">
        <ul class="nav-list">
          ${navItemsHtml}
        </ul>
      </nav>
      <div class="user-session">
        ${authSnippet}
      </div>
    </header>

    <main class="app-main" role="main" aria-label="${view.title}">
      <div class="view-container" role="${view.ariaRole}">
        <h2>${view.title}</h2>
        <p class="view-content">${view.content}</p>
      </div>
    </main>

    <footer class="app-footer" role="contentinfo">
      <p>&copy; 2026 CommerceFlow Platform. All rights reserved.</p>
    </footer>
  </div>
</body>
</html>
`.trim();
  }
}

export default AppShell;
