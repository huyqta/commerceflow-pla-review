// tests/e2e/order-flow.spec.ts
// End-to-End & Integration Test Suite for Web Auth, Order Flow & Accessibility (A11y)
// Phục vụ Milestone M5 (CF-027 — Auth integration, React tests và Playwright E2E)
// Chạy trực tiếp qua Node.js native test runner hoặc Playwright test harness

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppShell, type UserSession } from '../../apps/web/src/App.ts';
import { ProductListComponent } from '../../apps/web/src/features/catalog/ProductList.ts';
import { OrderPageComponent, type OrderStatus } from '../../apps/web/src/features/orders/OrderPage.ts';
import { generateJwt, verifyJwt, type JwtPayload } from '../../apps/api-gateway/src/main.ts';

describe('CF-027: Auth Integration, UI Component Tests and E2E Order Flow', () => {
  // -------------------------------------------------------------
  // 1. Auth Integration & Local Fake Identity (RBAC)
  // -------------------------------------------------------------
  it('should authenticate user with JWT, populate local session and pass micro-lab fixture assertion', () => {
    // Micro-lab assertion: const fixture={loggedIn:true,role:'viewer'}; assert.equal(fixture.role==='admin',false);
    const fixture = { loggedIn: true, role: 'viewer' as const };
    assert.equal(fixture.role === 'admin', false);

    // Tạo JWT token hợp lệ qua Auth Gateway (CF-016)
    const token = generateJwt({
      sub: 'user-viewer-01',
      username: 'alice_viewer',
      role: 'viewer',
    });

    const payload = verifyJwt(token);
    assert.equal(payload.role, 'viewer');
    assert.equal(payload.username, 'alice_viewer');

    const userSession: UserSession = {
      username: payload.username,
      role: payload.role,
      token,
    };

    const app = new AppShell({ initialPath: '/', userSession });
    assert.equal(app.getUserSession()?.role, 'viewer');
    assert.equal(app.getUserSession()?.username, 'alice_viewer');

    const html = app.renderHtml();
    assert.ok(html.includes('alice_viewer'));
    assert.ok(html.includes('(viewer)'));
  });

  // -------------------------------------------------------------
  // 2. Thử thách độc lập: Kiểm thử 403 Forbidden khi User thiếu quyền
  // -------------------------------------------------------------
  it('Independent Challenge: should enforce 403 Forbidden when Viewer attempts Staff action', () => {
    const viewerToken = generateJwt({
      sub: 'viewer-99',
      username: 'bob_viewer',
      role: 'viewer',
    });

    // Giả lập API Gateway Authorization Guard
    const checkRolePermission = (token: string, requiredRole: 'staff' | 'admin'): { allowed: boolean; statusCode: number } => {
      try {
        const payload = verifyJwt(token);
        if (payload.role !== requiredRole && payload.role !== 'admin') {
          return { allowed: false, statusCode: 403 };
        }
        return { allowed: true, statusCode: 200 };
      } catch {
        return { allowed: false, statusCode: 401 };
      }
    };

    // Viewer cố gắng gọi endpoint POST /products hoặc POST /orders
    const staffCheck = checkRolePermission(viewerToken, 'staff');
    assert.equal(staffCheck.allowed, false);
    assert.equal(staffCheck.statusCode, 403, 'Must return 403 Forbidden for insufficient permissions');

    // Nhân viên Staff thì được phép
    const staffToken = generateJwt({
      sub: 'staff-01',
      username: 'carol_staff',
      role: 'staff',
    });
    const staffAllowed = checkRolePermission(staffToken, 'staff');
    assert.equal(staffAllowed.allowed, true);
    assert.equal(staffAllowed.statusCode, 200);
  });

  // -------------------------------------------------------------
  // 3. E2E Order Flow: Happy Path & Order Failure với Retry View
  // -------------------------------------------------------------
  it('should complete E2E Happy Path Order submission through Saga polling', async () => {
    const orderPage = new OrderPageComponent();

    // 1. Submit order
    const order = orderPage.submitOrder('CUST-E2E-1', [
      { productId: 'prod-101', sku: 'SKU-SHIRT', quantity: 2, unitPrice: 250000 },
    ]);
    assert.equal(order.status, 'PENDING');
    assert.equal(order.totalAmount, 500000);

    // 2. Polling receives CONFIRMED status from distributed saga
    const pollResult = await orderPage.pollNextStatus(async () => 'CONFIRMED');
    assert.equal(pollResult.status, 'CONFIRMED');
    assert.equal(pollResult.completed, true);

    const view = orderPage.render();
    assert.equal(view.statusLabel, 'Đã xác nhận');
    assert.ok(view.html.includes('badge-success'));
  });

  it('should handle E2E Order Failure and render error retry view', async () => {
    const productList = new ProductListComponent();
    // Giả lập mạng bị lỗi khi tải dữ liệu
    productList.setError('503 Service Unavailable: Gateway unable to reach Catalog Cluster');

    const view = productList.render();
    assert.equal(view.stateKind, 'error');
    assert.ok(view.html.includes('role="alert"'), 'Must have alert role for screen reader');
    assert.ok(view.html.includes('btn-retry'), 'Must offer retry action to user');
    assert.ok(view.html.includes('503 Service Unavailable'));
  });

  // -------------------------------------------------------------
  // 4. Trade-off: Accessibility (A11y) Verification & Semantic Landmarks
  // -------------------------------------------------------------
  it('Trade-off: should satisfy W3C Accessibility requirements (ARIA roles & semantic landmarks)', () => {
    const app = new AppShell({ initialPath: '/orders' });
    const html = app.renderHtml();

    // 1. Semantic landmarks
    assert.ok(html.includes('role="banner"'), 'Missing Header landmark');
    assert.ok(html.includes('role="navigation"'), 'Missing Navigation landmark');
    assert.ok(html.includes('role="main"'), 'Missing Main landmark');
    assert.ok(html.includes('role="contentinfo"'), 'Missing Footer landmark');

    // 2. Navigation accessibility
    assert.ok(html.includes('aria-label="Main Navigation"'), 'Navigation must have descriptive aria-label');
    assert.ok(html.includes('aria-current="page"'), 'Active page must indicate aria-current="page"');

    // 3. Form & Status accessibility
    const orderPage = new OrderPageComponent();
    orderPage.submitOrder('CUST-A11Y', [{ productId: 'p1', sku: 's1', quantity: 1, unitPrice: 10 }]);
    const orderHtml = orderPage.render().html;
    assert.ok(orderHtml.includes('role="status"'), 'Status badge must have role="status"');
    assert.ok(orderHtml.includes('aria-label="Chi tiết đơn hàng"'), 'Container must have aria-label');
  });

  // -------------------------------------------------------------
  // 5. Negative Case: Expired/Tampered Token handling
  // -------------------------------------------------------------
  it('Negative Case: should reject tampered or invalid JWT in E2E auth flow', () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalidpayload.invalidsignature';
    assert.throws(() => {
      verifyJwt(fakeToken);
    });

    const app = new AppShell({ initialPath: '/' });
    app.setUserSession(undefined); // Unauthenticated
    const html = app.renderHtml();
    assert.ok(html.includes('Đăng nhập'), 'Must display login link when unauthenticated');
  });
});
