import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppShell } from '../../apps/web/src/App.ts';
import { APP_ROUTES, matchRoute, getNavRoutes } from '../../apps/web/src/routes.ts';
import { WebApiClient } from '../../apps/web/src/services/api-client.ts';

describe('CF-024: ReactJS/Vite Routing and Accessible UI Shell', () => {
  it('should define core navigation routes according to requirements (/products, /inventory, /orders)', () => {
    const navRoutes = getNavRoutes();
    const paths = navRoutes.map(r => r.path);

    assert.ok(paths.includes('/'), 'Should have dashboard root route');
    assert.ok(paths.includes('/products'), 'Should have /products route for Catalog Management');
    assert.ok(paths.includes('/inventory'), 'Should have /inventory route for Stock Dashboard');
    assert.ok(paths.includes('/orders'), 'Should have /orders route for Order Lifecycle & Saga');
  });

  it('should match known routes and render appropriate views with semantic ARIA roles', () => {
    const app = new AppShell({ initialPath: '/orders' });
    const view = app.renderCurrentView();

    assert.equal(view.isNotFound, false);
    assert.equal(view.title, 'Order Management & Saga Tracking');
    assert.equal(view.ariaRole, 'region');

    // Check HTML rendering contains main landmark and nav items
    const html = app.renderHtml();
    assert.ok(html.includes('role="banner"'), 'Must have header landmark');
    assert.ok(html.includes('role="navigation"'), 'Must have nav landmark');
    assert.ok(html.includes('role="main"'), 'Must have main content landmark');
    assert.ok(html.includes('role="contentinfo"'), 'Must have footer landmark');
    assert.ok(html.includes('aria-current="page"'), 'Must indicate active route with aria-current');
  });

  it('should update active state when navigating to different routes', () => {
    const app = new AppShell({ initialPath: '/' });
    assert.equal(app.getCurrentPath(), '/');

    app.navigate('/inventory');
    assert.equal(app.getCurrentPath(), '/inventory');

    const nav = app.renderNavigation();
    const inventoryItem = nav.items.find(i => i.path === '/inventory');
    const productsItem = nav.items.find(i => i.path === '/products');

    assert.equal(inventoryItem?.isActive, true);
    assert.equal(productsItem?.isActive, false);

    const view = app.renderCurrentView();
    assert.equal(view.title, 'Inventory Real-time Dashboard');
  });

  it('Independent Challenge: should route unknown paths to 404 Not Found Page', () => {
    const unknownPath = '/non-existent-page-xyz';
    const match = matchRoute(unknownPath);

    assert.equal(match.matched, false);
    assert.equal(match.is404, true);

    const app = new AppShell({ initialPath: unknownPath });
    const view = app.renderCurrentView();

    assert.equal(view.isNotFound, true);
    assert.ok(view.title.includes('404'), 'Title must indicate 404 Not Found');
    assert.equal(view.ariaRole, 'alert', '404 notification should have alert role for accessibility');
    assert.ok(view.content.includes(unknownPath), 'Content should display the missing path');

    const html = app.renderHtml();
    assert.ok(html.includes('404 - Không tìm thấy trang'));
  });

  it('Negative Case: should handle malformed or dirty URLs safely', () => {
    // URL with trailing query params, fragments or extra spaces
    const dirtyUrl = '  /PRODUCTS?sort=desc#section1  ';
    const match = matchRoute(dirtyUrl);

    assert.equal(match.matched, true);
    assert.equal(match.is404, false);
    assert.equal(match.route?.path, '/products');
  });

  it('Trade-off: should enforce Separation of Concerns between API Client and UI Presentation', () => {
    const apiClient = new WebApiClient('https://api.commerceflow.internal');
    const app = new AppShell({
      initialPath: '/products',
      apiClient,
      userSession: {
        username: 'staff_user',
        role: 'staff',
        token: 'fake-jwt-token',
      },
    });

    const user = app.getUserSession();
    assert.equal(user?.username, 'staff_user');
    assert.equal(user?.role, 'staff');

    const html = app.renderHtml();
    assert.ok(html.includes('staff_user'), 'Must display authenticated username');
    assert.ok(html.includes('(staff)'), 'Must display user role');
  });
});
