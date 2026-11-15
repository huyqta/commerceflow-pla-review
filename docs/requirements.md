# Yêu cầu CommerceFlow

## Vai trò
- Nhân viên: quản lý catalog, tạo đơn và xem trạng thái.
- Quản trị: xem vận hành và nhật ký, được quản lý quyền.

## BDD (Behavior-Driven Development — phát triển dựa trên hành vi) scenarios

### R-01 Đơn hàng thành công
Given sản phẩm A có stock=5 và giá 100; When nhân viên đặt 2; Then đơn chuyển PENDING→CONFIRMED và tồn khả dụng giảm 2 sau reserve.

### R-02 Hết hàng
Given stock=1; When đặt 2; Then request bị từ chối, tồn kho không âm, không tạo payment.

### R-03 Thanh toán lỗi
Given đã reserve 2; When payment simulator trả failed; Then order CANCELLED, inventory release 2, không double compensation.

### R-04 Duplicate delivery
Given OrderCreated có eventId=e1; When broker gửi hai lần; Then consumer chỉ tạo một reservation/payment side effect.

### R-05 Frontend eventual consistency
Given request đã nhận, Saga còn PENDING; When UI polling; Then hiển thị trạng thái pending, không báo confirmed giả.

### R-06 Security
Given user viewer; When gọi write endpoint; Then 403. Given request không có token; Then 401.

## Nonfunctional lab targets (mục tiêu học, chưa phải SLO được đo)
- Tất cả transitions idempotent; các invariant có unit tests và concurrent integration tests.
- 100% service-to-service auth tại cloud boundary; giả lập failure retry.
- Mỗi order request có correlationId để truy vết ít nhất 3 services.
- Ngân sách học dự kiến $50 USD/tháng; không phải hard cap cloud billing.

## Out of scope
Payment gateway thật, dữ liệu khách thật, full e-commerce shipping/tax/refund, high-availability production SLO.
