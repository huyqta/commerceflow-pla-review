import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProductListComponent,
  resolveViewState,
  type ProductItem,
} from '../../apps/web/src/features/catalog/ProductList.ts';

describe('CF-025: Product Management and Inventory Dashboard', () => {
  it('should accurately resolve view states (loading, error, empty, data)', () => {
    // 1. Loading state
    assert.equal(resolveViewState({ loading: true, error: null, items: [] }), 'loading');
    assert.equal(resolveViewState({ loading: true, error: 'any', items: [{}] }), 'loading');

    // 2. Error state
    assert.equal(resolveViewState({ loading: false, error: 'Network timeout', items: [] }), 'error');

    // 3. Empty state
    assert.equal(resolveViewState({ loading: false, error: null, items: [] }), 'empty');

    // 4. Data state
    assert.equal(resolveViewState({ loading: false, error: null, items: [{ id: 'p1' }] }), 'data');
  });

  it('should render loading state with accessibility attributes', () => {
    const component = new ProductListComponent();
    component.setLoading();

    const view = component.render();
    assert.equal(view.stateKind, 'loading');
    assert.equal(view.ariaLive, 'polite');
    assert.ok(view.html.includes('role="status"'));
    assert.ok(view.html.includes('aria-busy="true"'));
  });

  it('should render error state with alert role and retry action', () => {
    const component = new ProductListComponent();
    component.setError('Failed to fetch catalog: 503 Service Unavailable');

    const view = component.render();
    assert.equal(view.stateKind, 'error');
    assert.equal(view.ariaLive, 'assertive');
    assert.ok(view.html.includes('role="alert"'));
    assert.ok(view.html.includes('Failed to fetch catalog: 503 Service Unavailable'));
    assert.ok(view.html.includes('btn-retry'));
  });

  it('Independent Challenge: should design meaningful empty state with clear call to action', () => {
    const component = new ProductListComponent({ loading: false, error: null, items: [] });
    const view = component.render();

    assert.equal(view.stateKind, 'empty');
    assert.equal(view.title, 'Chưa có sản phẩm nào');
    assert.ok(view.html.includes('empty-state'));
    assert.ok(view.html.includes('Thêm sản phẩm đầu tiên'), 'Must have call to action button');
    assert.ok(view.html.includes('/products/new'), 'Must link to product creation form');
  });

  it('should render data state with product table and inventory badges', () => {
    const sampleProducts: ProductItem[] = [
      {
        id: 'prod-1',
        sku: 'BOOK-DDD',
        name: 'Domain-Driven Design Book',
        price: 350000,
        currency: 'VND',
        availableStock: 15,
        reservedStock: 2,
        status: 'ACTIVE',
      },
      {
        id: 'prod-2',
        sku: 'BOOK-CLEAN',
        name: 'Clean Architecture Book',
        price: 420000,
        currency: 'VND',
        availableStock: 0,
        reservedStock: 5,
        status: 'ACTIVE',
      },
    ];

    const component = new ProductListComponent();
    component.setData(sampleProducts);

    const view = component.render();
    assert.equal(view.stateKind, 'data');
    assert.ok(view.title.includes('2'));
    assert.ok(view.html.includes('BOOK-DDD'));
    assert.ok(view.html.includes('BOOK-CLEAN'));
    assert.ok(view.html.includes('badge-success'), 'In stock items have success badge');
    assert.ok(view.html.includes('Hết hàng'), 'Zero stock items have danger badge');
  });

  it('Trade-off & Negative Case: avoid stale server state caching by updating timestamp', () => {
    const component = new ProductListComponent();
    assert.equal(component.getState().lastFetchedAt, undefined);

    component.setData([]);
    const firstFetchTime = component.getState().lastFetchedAt;
    assert.notEqual(firstFetchTime, undefined);

    // Negative case: empty list should immediately trigger empty state rather than showing stale cached data
    const view = component.render();
    assert.equal(view.stateKind, 'empty');
  });
});

