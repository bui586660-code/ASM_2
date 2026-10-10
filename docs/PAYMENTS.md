# T-TECH payment implementation plan

## Audit and design
Current CommonJS HTTP server serves products, cookie authentication and orders. JSON writes use an in-process queue, exclusive lock file and atomic rename, but have no durable transaction journal, database uniqueness, recovery from abandoned locks or relational constraints. This is inadequate for real-money reconciliation.

Node 24.21 provides node:sqlite. Laragon supplies a MySQL executable, but this project has no configured MySQL database/driver or deployment service. Choose SQLite WAL + synchronous FULL on local disk for this single-host application. Do not use it on a network share or horizontally scaled deployment; use a managed transactional database for that deployment. Preserve existing read/update module interface, using synchronous transaction callbacks and SQL constraints. JSON remains an immutable migration source after cutover; never run two independent stores in parallel.

Keep current UI, auth cookies, product API and canonical quote calculation. New orders snapshot receiver, reference and product identifiers. Bank/QR require explicit enabled configuration and SQLite; no secret means disabled, not simulated success. Existing COD flow remains available, configurable by operator, and never marks payment received. Historic bank/QR demo orders are not converted to payable orders automatically.

Webhook uses official SePay HMAC SHA256(timestamp + '.' + raw bytes), five-minute timestamp tolerance; no cookie or Origin required only on this authenticated endpoint. All browser mutation routes retain Origin checks. Validate incoming account, bank, reference, amount, order state and transaction ID. Persist receipt and order transition atomically. Exceptions enter admin review. Duplicates never credit again. Admin resolution requires verified receipt, reason, role checked server-side and durable audit.

## Implementation checklist
- [x] Storage: failing migration/rollback/uniqueness tests, SQLite adapter and idempotent backup/import/verification command.
- [x] Payment: failing endpoint tests, configuration, backend reference/QR, HMAC webhook and reconciliation/admin audit.
- [x] UI: checkout payment availability, sender-bank selector, QR/copy/status polling, existing admin extension, browser tests.
- [x] Migration: compare all records including orders/items/users, leave db.json unchanged, verify restart.
- [x] Verification: old auth/orders/browser suites and new concurrency/security tests; independent review.
- [x] Handover: environment, tunnel, SePay dashboard, production/rollback and evidence levels.

## Review focus
Duplicate IDs with changed payloads; stale UI after logout/navigation; old demo orders paid accidentally; database failure after bank event; amount mismatch later followed by exact payment. Tests must protect these boundaries. Public webhook and real transfer require owner setup and are separate from internal fixtures.

## Sources (checked 2026-10-09)
- https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc
- https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhooks
- https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code
- https://developer.sepay.vn/vi/sepay-webhooks/tao-webhook
- https://developer.sepay.vn/vi/sepay-webhooks/tai-khoan-ngan-hang
- https://developer.sepay.vn/vi/sepay-webhooks/test-mode/bat-dau-nhanh
- https://nodejs.org/api/sqlite.html


## Kết quả triển khai ngày 09/10/2026

**Đã triển khai và kiểm thử nội bộ; chưa nghiệm thu thanh toán Live.** Không tạo giao dịch thật, không chuyển tiền, không tự tạo secret SePay hay đánh dấu hai đơn cũ đã thanh toán.

### File mới

- `Backend/storage.cjs`: SQLite, transaction, migration và đối chiếu dữ liệu.
- `Backend/payments.cjs`: cấu hình MB, mã đối soát/QR, HMAC, tiếp nhận và đối soát webhook, API quản trị.
- `Backend/.env.example`: cấu hình mẫu, không có secret.
- `frontend/assets/js/payments.js`: trạng thái đơn, QR, copy, polling và quản trị trong modal hiện có.
- `frontend/tests/payment-storage.cjs`, `payments-api.cjs`, `payments-ui.cjs`: kiểm thử bằng database tạm.
- `.gitignore` tại workspace: bỏ qua secrets/database/backup khỏi version control.
- `Backend/ttech.sqlite`: dữ liệu hoạt động mới; các file WAL/SHM do SQLite quản lý.
- `Backend/db.json.pre-sqlite-96f4ea038021.bak`: bản sao nguyên byte trước migration.

### File chỉnh sửa

- `Backend/server.cjs`: lựa chọn storage, đọc .env, route webhook riêng và tích hợp payment/admin; giữ kiểm tra Origin trên browser mutations.
- `Backend/orders.cjs`: snapshot payment, senderBank, danh sách phương thức khả dụng trong quote; giá/tồn kho/idempotency vẫn từ backend.
- `frontend/assets/js/checkout.js`: thay nội dung mô phỏng, chọn ngân hàng gửi, hiển thị payment panel.
- `frontend/assets/js/auth.js`: thông báo lỗi payment/admin; API cùng origin khi chạy domain thật.
- `frontend/assets/js/ttech.js`: giữ API local, dùng cùng origin khi triển khai domain HTTPS.
- `frontend/assets/css/checkout.css`, `frontend/index.html`: panel MB, quản trị, accessibility/responsive; giữ giao diện hiện có.
- `frontend/tests/checkout-ui.cjs`: chạy fixture SQLite, thay assertion nội dung demo đã bị loại bỏ; giữ các test race/cart/retry cũ.
- `package.json`: lệnh migration/test. README và tài liệu auth/checkout được bổ sung hướng dẫn mới.
- Ảnh kiểm tra ở workspace `docs/ui-reference/ttech-bank-desktop.png`, `ttech-bank-mobile.png`. Ảnh chụp kịch bản QR không tải được để kiểm tra fallback, không phải biên nhận thanh toán.

## Database đang sử dụng

Mặc định server dùng `Backend/ttech.sqlite`. `db.json` giữ nguyên, không còn là nguồn ghi của server mặc định. Không chạy `json-server db.json` song song. Sửa dữ liệu bằng JSON sau cutover sẽ không cập nhật database SQLite.

Các bảng: products, users (email unique), authSessions, orders (unique user/request key, payment reference, paid transaction), order_items (FK order), payments (SePay ID primary key), paymentAudit, metadata. Payload JSON giữ nguyên trường dữ liệu cũ; cột SQL generated và bảng item bổ sung ràng buộc/index. Mỗi cập nhật đọc snapshot trong BEGIN IMMEDIATE rồi ghi/commit đồng bộ, không await mạng khi giữ transaction. WAL và synchronous FULL; khóa ngoại bật. Mã giao dịch, trạng thái paid và audit được ghi trong một transaction.

Snapshot adapter phù hợp project nhỏ, một máy và ổ đĩa local. Chưa benchmark tải production; chưa thiết kế nhiều máy ghi hoặc network filesystem. Không sử dụng SQLite file trên ổ chia sẻ mạng. Với triển khai nhiều instance, chuyển repository sang MySQL/PostgreSQL có vận hành/backup phù hợp.

Migration đã kiểm tra nguyên dữ liệu users/password hash, sản phẩm, phiên, orders/items và trạng thái. Kết quả: products 39, users 1, authSessions 1, orders 2, payments 0. Cả hai đơn vẫn pending/unpaid. SHA256 file nguồn: `96f4ea038021e48e3fa32c3046f8645c2f1eddfd53e00ed77c4dfdcd7efe98f1`.

Chạy từ `D:/JS-NANGCAO` khi backend đã dừng:

```powershell
npm.cmd run migrate:payments
npm.cmd start
```

Migration chạy lại không nhân đôi và không ghi đè database đã hoạt động. Nếu source JSON khác checksum migration cũ, lệnh từ chối thay vì nhập đè. Không xóa file SQLite để ép nhập lại khi đã có dữ liệu mới.

Nếu migration thất bại: file JSON gốc vẫn nguyên. Giữ lại SQLite để kiểm tra; có thể tạm chạy chế độ JSON bằng `$env:TTECH_DB_PATH='D:/JS-NANGCAO/ASM/Backend/db.json'` và `BANK_PAYMENTS_ENABLED=false`, không đặt TTECH_SQLITE_PATH. **Chỉ rollback về nguồn cũ nếu chưa có thay đổi mới trong SQLite.** Nếu đã có đơn/tài khoản/giao dịch mới, dừng ghi, sao lưu bằng SQLite backup API và xuất toàn bộ snapshot ra một file mới để đối chiếu trước; không ghi đè JSON cũ hoặc xóa WAL. Backup file gốc không chứa dữ liệu phát sinh sau cutover.

## Cấu hình và chạy

Node 24.21 đã được kiểm tra; dùng module chuẩn `node:sqlite`, không thêm thư viện runtime. Playwright là dependency test đã có.

1. Sao chép `Backend/.env.example` thành `Backend/.env` nếu chưa có file này; chỉnh trên máy, không gửi secret qua chat.
2. `PORT=3000`, `HOST=127.0.0.1` giữ mặc định. `FRONTEND_ORIGINS` chỉ chứa origin frontend được phép.
3. `BANK_PAYMENTS_ENABLED=false` mặc định. Muốn bật, cần secret HMAC thực từ cấu hình webhook, SQLite đã migration và tài khoản đã liên kết. `SEPAY_WEBHOOK_SECRET` phải ít nhất 32 ký tự. Không dùng key API Access thay secret HMAC.
4. `MB_ACCOUNT_NUMBER=0911236639`, `MB_ACCOUNT_NAME=BUI NGUYEN PHAT TAI`. Ngân hàng nhận luôn MBBank; lựa chọn ngân hàng của khách chỉ là ghi nhận ứng dụng gửi.
5. `COD_ENABLED=true` giữ flow COD hiện có: đơn chưa thu tiền, cửa hàng xác nhận/giao hàng thủ công. Đặt false nếu chưa có khả năng vận hành COD. Không tích hợp hãng vận chuyển hoặc xác nhận đã thu tiền giả.
6. `npm.cmd start`; frontend Live Server web root `ASM/frontend`, `http://127.0.0.1:5501/`. Chỉ phục vụ frontend, không phục vụ Backend/.env/database/backup qua static server.

Không có tài khoản admin/mật khẩu mặc định. Đăng ký tài khoản thật, dừng backend rồi từ ASM chạy `node Backend/server.cjs --promote email-da-dang-ky` để cấp quyền; CLI dùng cùng SQLite. Restart, đăng nhập lại → Tài khoản → Quản trị → Tải/Làm mới giao dịch.

## API và đối soát

- `POST /api/orders/quote`: thêm paymentMethods; tổng tiền vẫn canonical từ product data.
- `POST /api/orders`: bank/qr chỉ khả dụng khi backend cho phép. Lưu payment.reference, transferContent, productIds, receiver, QR và senderBank. Không tin amount/paid từ client.
- `GET /api/orders`, `/api/orders/:id`, `/api/orders/request/:key`: chỉ chủ đơn. Payment có available theo cấu hình hiện tại; UI không mời chuyển tiền khi tắt phương thức.
- `GET /api/payments/config`: phương thức được bật, không có secret.
- `POST /api/webhooks/sepay`: HMAC, JSON tối đa 16 KiB, chỉ ACK 200 `{"success":true}` sau commit. Lỗi storage trả 500 để provider retry. Không có bypass xác thực.
- `GET /api/admin/payments?filter=...`: admin-only; filter matched/review/amount_mismatch/unknown_order/duplicate; UI thêm danh sách đơn unpaid.
- `POST /api/admin/payments/:id/confirm`: admin-only + Origin + evidence checkbox/lý do; chỉ giao dịch tiền vào đúng tài khoản, đúng tổng tiền, chưa dùng cho đơn khác. Tạo audit actor/time/reason. Không tự bù thiếu tiền, gộp giao dịch, hoàn tiền hoặc ghi paid tùy ý.

Mã TT + 24 ký tự hex đứng đầu nội dung, được lưu unique và map với order ID + toàn bộ product IDs. Khi đủ chỗ, nối tất cả mã sản phẩm. Giới hạn nội bộ 60 ASCII ký tự; nếu danh sách dài/ID không phù hợp, dùng mã đối soát ngắn và giữ đầy đủ mapping ở backend. Đây là giới hạn bảo thủ của ứng dụng, không phải cam kết giới hạn mọi ngân hàng. Cần kiểm tra nội dung sau khi quét bằng app ngân hàng thật khi nghiệm thu.

Đơn cũ không có snapshot payment giữ nguyên và yêu cầu liên hệ cửa hàng; không tự gắn QR cho đơn demo cũ. Sai tiền, sai account, outgoing, nhiều mã, không tìm thấy đơn, đã hủy/đã paid đều không tự ghi paid. Sai tiền đưa đơn review; khoản đúng đến sau vẫn phải kiểm tra để tránh bỏ sót tiền trước đó. Lặp ID tăng bộ đếm; lặp ID nhưng khác payload được gắn cờ, không áp dụng lần hai. Cùng mã tham chiếu ngân hàng bị giữ để kiểm tra.

UI polling 10 giây, tạm ngưng khi tab ẩn, dừng khi đổi route/tài khoản. Nút “Kiểm tra trạng thái” chỉ GET server; không có endpoint khách hàng xác nhận đã thanh toán. QR lỗi vẫn có số tài khoản/nội dung/tổng tiền và thông báo fallback. Clipboard có phản hồi thành công/thất bại.

## SePay và HTTPS — bước chủ tài khoản cần thực hiện

Theo [tài liệu liên kết ngân hàng](https://developer.sepay.vn/vi/sepay-webhooks/tai-khoan-ngan-hang), vào Dashboard SePay → Tài khoản ngân hàng → thêm/liên kết MBBank 0911236639 theo quy trình chính thức. Chủ tài khoản thao tác trong SePay, không cung cấp mật khẩu ngân hàng cho project.

Theo [tạo webhook](https://developer.sepay.vn/vi/sepay-webhooks/tao-webhook): chọn tài khoản MB cụ thể/tài khoản chính, tiền vào, application/json, bật gửi lại khi lỗi. Không bật bỏ qua giao dịch không có mã nếu muốn thấy các khoản cần đối soát. URL là `https://TEN-MIEN-CUA-BAN/api/webhooks/sepay`.

Chọn **HMAC-SHA256**, cấu hình secret giống biến môi trường. Backend kiểm tra X-SePay-Timestamp, X-SePay-Signature và HMAC timestamp.raw_body, dung sai 5 phút; đồng bộ giờ server. Xem [xác thực SePay](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc).

Local: ngrok đã có trong máy. Đăng nhập/cấu hình authtoken trong ngrok theo [hướng dẫn chính thức](https://ngrok.com/docs/start), sau đó chạy:

```powershell
ngrok http 3000
```

Lấy HTTPS URL được cấp, thêm `/api/webhooks/sepay` vào Dashboard. Giữ terminal Node và ngrok chạy. Tunnel đổi URL thì cập nhật webhook; không hardcode URL tunnel vào frontend. Không public Live Server chứa toàn workspace. Chưa tạo tunnel trong phiên này vì chưa có cấu hình SePay/secret của chủ tài khoản; chưa xác minh webhook từ Internet.

[Test mode của SePay](https://developer.sepay.vn/vi/sepay-webhooks/test-mode/bat-dau-nhanh) là chế độ trên Dashboard. Phải dùng database, secret và backend riêng với dữ liệu test; không trỏ webhook test vào database Live hoặc dùng QR ngân hàng thật để thử chuyển. Không có biến tự chế SEPAY_ENV=sandbox làm thay đổi dịch vụ. Internal tests dùng fixture tạm và secret ngẫu nhiên, không phải bằng chứng SePay Live. Gửi thử id=0 có thể bị backend từ chối vì không phải giao dịch thật; dùng giao dịch mô phỏng có ID hợp lệ trên môi trường test cách ly.

Kiểm tra Dashboard lịch sử webhook và mục đối soát admin. Nếu mất thông báo, dùng chức năng phát lại sau khi khôi phục server; không sửa database thành paid thủ công. [Tài liệu xử lý lỗi](https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi) mô tả retry hữu hạn, vì vậy cần giám sát/replay và đối chiếu sao kê.

Production: domain HTTPS ổn định, reverse proxy `/api/*` và `/products*` đến Node localhost:3000, static root chỉ frontend, `NODE_ENV=production`, `FRONTEND_ORIGINS=https://ten-mien-thuc`. Frontend dùng API cùng origin ngoài localhost. Secret đặt tại host, quản lý backup SQLite đúng API/WAL, giám sát dung lượng/đồng hồ/log/độ trễ, thử phục hồi. Chưa triển khai production. Chỉ chủ tài khoản thực hiện giao dịch thật có kiểm soát sau khi cấu hình được xác minh; không tự tạo đơn giá thấp hoặc chuyển tiền trong phiên làm việc này.

## Kiểm thử và mức nghiệm thu

```powershell
node --test ASM/frontend/tests/auth-api.cjs ASM/frontend/tests/orders-api.cjs ASM/frontend/tests/payment-storage.cjs ASM/frontend/tests/payments-api.cjs
npm.cmd run test:auth-ui
npm.cmd run test:checkout-ui
npm.cmd run test:payments-ui
```

Kết quả cuối: 37/37 test API/storage đạt; 3 suite browser auth/checkout/payments và 5 suite regression giao diện đạt. Không có lỗi JS runtime trong các luồng bình thường đã kiểm tra.

Test API gồm canonical totals, stock/idempotency, HMAC invalid/expired/malformed, under/overpayment, wrong receiver/outgoing/unknown/ambiguous, paid/cancelled, duplicate/changed payload, concurrent webhook/admin, rollback khi storage lỗi, restart, legacy orders, config fail-closed và mapping nhiều sản phẩm. Browser gồm auth/cart/history/reload, QR outage/copy, signed receipt, admin, responsive 320–1440px, không lỗi JS runtime. Regression sản phẩm/detail/motion/premium/reference cũng đã chạy. Một lượt chạy đồng thời gặp connection refused từ static Python server; chạy lại riêng suite redesign đạt.

| Mức | Trạng thái |
|---|---|
| Code/storage/checkout/webhook/admin | Đã triển khai |
| Migration dữ liệu project | Đã đối chiếu toàn bộ, JSON gốc nguyên vẹn |
| Unit/integration/browser local | Đã kiểm thử với fixture cách ly |
| URL HTTPS công khai nhận SePay | Chưa xác minh, cần cấu hình của chủ tài khoản |
| Ảnh QR quét trên app ngân hàng thực | Chưa xác minh; test kiểm tra tham số backend và fallback |
| MB Live / tiền thật | Chưa thực hiện, không tuyên bố sẵn sàng nhận tiền |

Giới hạn: chưa có tự động hoàn tiền/partial payment, hãng vận chuyển, đối soát API chủ động khi webhook mất, hoặc benchmark/HA production. Admin xử lý khoản ngoại lệ bằng kiểm tra sao kê và quy trình cửa hàng; không tự hoàn tiền từ UI.
