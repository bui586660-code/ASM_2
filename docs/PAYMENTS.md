# Thanh toán T-TECH

## Lưu trữ hiện tại

Từ 21/10/2026, backend Node chỉ dùng `Backend/db.json`. Các collection nghiệp vụ là `products`, `users`, `authSessions`, `orders`, `payments`, `paymentAudit` và `metadata`.

`Backend/ttech.sqlite`, `ttech.sqlite-wal` và `ttech.sqlite-shm` là dữ liệu cũ, chỉ giữ để đối chiếu. `server.cjs` không mở, không đọc và không ghi các file này. Không chạy `json-server` đồng thời với `node Backend/server.cjs`, vì server Node là API duy nhất trên cổng 3000.

Kho JSON dùng hàng đợi trong tiến trình, file lock `db.json.lock` và ghi file tạm rồi đổi tên. Cách này phù hợp bài ASM/local, không phải database cho nhiều tiến trình hoặc tải giao dịch cao. Sao lưu `db.json` trước khi chỉnh thủ công và dùng database transactional khi triển khai thật.

## Chuyển dữ liệu SQLite cũ

Sau khi dừng backend cũ, chạy từ `D:\JS-NANGCAO`:

```powershell
npm.cmd run migrate:sqlite-to-json
```

Lệnh đọc SQLite ở chế độ chỉ đọc, sao lưu `db.json` thành `db.json.pre-sqlite-to-json-*.bak`, gộp dữ liệu theo ID và ghi marker `sqlite-to-json-v1` trong `metadata`. Chạy lại lệnh sẽ báo `alreadyMigrated` và không ghi đè các đơn JSON tạo sau lần chuyển đổi đầu tiên.

## Luồng thanh toán

- `POST /api/orders/quote`: tính giá, phí vận chuyển, mã giảm giá và các phương thức được bật từ dữ liệu sản phẩm trong `db.json`.
- `POST /api/orders`: xác thực người dùng, kiểm tra quote, tạo snapshot đơn hàng và ghi đơn vào `orders`.
- `GET /api/orders*`: chỉ trả đơn của chủ đơn.
- `POST /api/webhooks/sepay`: chỉ ghi receipt vào `payments` và audit vào `paymentAudit` khi chữ ký HMAC, tài khoản nhận, số tiền và mã đối soát hợp lệ.
- `POST /api/admin/payments/:id/confirm`: admin xác nhận giao dịch review với lý do; mọi dữ liệu vẫn ghi vào `db.json`.

Client không thể tự gửi trạng thái `paid`; backend kiểm tra trạng thái đơn và giao dịch trước khi ghi. COD vẫn tạo đơn `unpaid` để cửa hàng xử lý thủ công.

## Cấu hình

Sao chép `Backend/.env.example` thành `Backend/.env` và chỉ chỉnh trên máy local:

```env
PORT=3000
HOST=127.0.0.1
FRONTEND_ORIGINS=http://127.0.0.1:5501,http://localhost:5501
BANK_PAYMENTS_ENABLED=false
COD_ENABLED=true
```

Khi bật bank/QR, `SEPAY_WEBHOOK_SECRET` phải là HMAC secret thực tối thiểu 32 ký tự. Không đặt secret hoặc dữ liệu ngân hàng nhạy cảm trong frontend, `db.json` public hay source control.

## Chạy và kiểm tra

```powershell
npm.cmd start
npm.cmd run test:auth
npm.cmd run test:orders
npm.cmd run test:payments
```

Sau khi tạo đơn, mở `Backend/db.json`, tìm collection `orders`; đơn mới phải xuất hiện tại đây. `payments` và `paymentAudit` chỉ có dữ liệu sau khi webhook hoặc admin đối soát. Không có test nào trong project thực hiện giao dịch tiền thật.
