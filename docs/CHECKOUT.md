> **Cập nhật 09/10/2026:** Backend mặc định đã chuyển sang SQLite sau migration; `db.json` được giữ nguyên làm nguồn cũ. Chuyển khoản MB/VietQR và webhook SePay đã có code, nhưng mặc định tắt khi chưa cấu hình secret. Không chạy JSON Server. Đọc [hướng dẫn thanh toán, chạy server và migration](PAYMENTS.md) thay cho các mô tả thanh toán demo/lưu JSON trước đây bên dưới.

# T-TECH Checkout — thiết kế và kế hoạch triển khai

## Luồng mua hàng cập nhật 10/10/2026

Giữ nguyên giao diện, màu sắc, CSS và các route. Bổ sung ô chọn sản phẩm và cửa sổ mã khuyến mãi bằng các control/modal hiện có.

1. **Thêm vào giỏ** chọn sản phẩm vừa thêm. **Mua ngay** đăng nhập nếu cần, mở giỏ và chỉ chọn mẫu vừa bấm; các mẫu khác vẫn nằm trong giỏ.
2. Chọn từng sản phẩm hoặc **Chọn tất cả**, tăng/giảm/xóa như cũ. Chỉ những sản phẩm đã chọn đi vào checkout. Lựa chọn lưu cùng giỏ trên trình duyệt và tồn tại sau reload. Không chọn gì thì nút Thanh toán bị vô hiệu hóa.
3. **Nhập / chọn mã khuyến mãi** có ở giỏ và checkout. Cần đăng nhập để kiểm tra ưu đãi. Có thể nhập mã, chọn mã khả dụng hoặc bỏ mã. Mỗi đơn dùng tối đa một mã bổ sung; mã được lưu trong phiên tab theo tài khoản, không dùng lại cho tài khoản khác.
4. Backend tính tổng tiền gốc, giảm giá trực tiếp của sản phẩm, phí vận chuyển, giảm từ mã, tổng thanh toán và khoản tiết kiệm. `subtotal` vẫn là tiền hàng sau giảm trực tiếp; `discount` chỉ là giảm thêm từ mã, không trừ giảm giá sản phẩm hai lần.
5. Nhập thông tin giao hàng, chọn phương thức khả dụng và xác nhận thông tin. Khi giỏ/mã/giá đổi phải kiểm tra tổng tiền và xác nhận lại.
6. Backend kiểm tra mã lần nữa **trong transaction tạo đơn**, rồi lưu snapshot mã/điều kiện/số tiền giảm. Lượt dùng dựa trên đơn đã lưu, không dựa trên trình duyệt. Retry cùng request trả lại đơn cũ và không tính thêm lượt.
7. Đặt thành công chỉ trừ số lượng đã mua; sản phẩm chưa chọn vẫn trong giỏ. Xóa mã của lượt mua vừa hoàn tất. Lịch sử đơn thể hiện tổng tiền và mã đã áp dụng; dữ liệu đơn cũ vẫn hiển thị được.

### Cấu hình hiện tại

- `Backend/promotions.json` có `coupons: []`: **không có mã giảm giá thực tế nào được bật**. Mã TEST500/TEST100 chỉ nằm trong fixture kiểm thử, không dùng trên website đang chạy.
- Giao hàng tận nơi; chưa bật nhận tại cửa hàng vì chưa có địa chỉ và chính sách cửa hàng.
- Giữ phí 30.000đ, miễn phí từ 20.000.000đ tiền hàng sau giảm trực tiếp (trước mã bổ sung). Không sao chép ngưỡng miễn phí 300.000đ từ ảnh tham chiếu.
- COD đang bật; MB/VietQR vẫn phụ thuộc cấu hình backend. Không bổ sung lựa chọn MoMo/VNPAY/thẻ nếu chưa có tích hợp.
- Không thêm cam kết giao trong 2 giờ, thu cũ đổi mới, bảo hành mở rộng hoặc tự xuất hóa đơn từ ảnh mẫu.

### Khai báo ưu đãi khi đã có chính sách

Chỉnh `Backend/promotions.json`, sau đó khởi động lại backend. Đây là cấu hình của chủ website, không nhận quy tắc giảm giá từ client. Ví dụ **chưa bật**:

```json
{
  "coupons": [
    {
      "code": "LAPTOP5",
      "active": false,
      "type": "percent",
      "value": 5,
      "maxDiscount": 500000,
      "minSubtotal": 20000000,
      "maxUses": 100,
      "perUserLimit": 1
    }
  ]
}
```

- `type`: `percent` (1–100%, làm tròn xuống đồng), `fixed` (số tiền), hoặc `shipping` (giảm phí vận chuyển).
- `startsAt`, `expiresAt`: thời điểm ISO 8601 có múi giờ nếu cần giới hạn thời gian; `productIds`: danh sách ID dạng chuỗi nếu chỉ áp dụng cho một số sản phẩm.
- `minSubtotal`: tiền các sản phẩm đã chọn sau giảm trực tiếp; phần trăm/số tiền giảm bị giới hạn bởi tiền hàng đủ điều kiện và `maxDiscount` nếu có. Không tạo tổng âm.
- `maxUses`/`perUserLimit`: số đơn được sử dụng mã; đơn chờ thanh toán cũng chiếm lượt. Chưa tự hoàn lượt khi hủy/hoàn tiền. Bỏ trường nghĩa là không giới hạn; đặt 0 nghĩa là không còn lượt.
- Mã lưu bằng chữ in hoa, chữ số, `_` hoặc `-`, tối đa 40 ký tự. Client nhập không phân biệt hoa/thường.
- Mã hết hạn/không đủ điều kiện sau khi giỏ thay đổi được bỏ kèm thông báo và bắt xác nhận tổng mới. Mã nhập sai trong popup không thay thế mã hợp lệ đang dùng.

### Phạm vi code và kiểm thử mới

- `Backend/promotions.cjs`, `promotions.json`: quy tắc và cấu hình. `orders.cjs`, `server.cjs`: quote/lưu đơn và nạp cấu hình; giữ endpoint cũ, không đổi schema SQLite hay dữ liệu sản phẩm.
- `frontend/assets/js/ttech.js`: chọn sản phẩm và giữ giỏ chưa mua; `checkout.js`: mã khuyến mãi, tổng tiền, chống phản hồi cũ; `index.html`: control chọn và dialog.
- `orders-api.cjs`, `promotions.cjs`, `checkout-ui.cjs`: mã sai/hết hạn/giới hạn, chống dùng quá lượt đồng thời, tính tiền, chọn một phần giỏ, reload, bỏ/chọn lại mã và phản hồi cũ không xóa mã mới. Dữ liệu kiểm thử được cách ly khỏi database thực.

Nội dung bên dưới là nhật ký triển khai trước đây; mô tả JSON/thanh toán mô phỏng không thay thế trạng thái hiện tại ở phần đầu tài liệu và `PAYMENTS.md`.

## Khảo sát
HTML/vanilla JS/Tailwind CDN; index.html là entry, ttech.js quản lý products, cart modal, favorites, hash routes. Trước thay đổi, cart chỉ lưu id/qty trong cyber-core-db-cart-v1. auth.js quản lý cookie/session. Backend/server.cjs dùng cùng db.json, khóa ghi và xác thực user. Có 39 products, users/authSessions; chưa có orders, checkout, coupon, stock hoặc variant trong dữ liệu hiện tại.

## Thiết kế
Giữ header/footer và design tokens đỏ/trắng/charcoal; bổ sung commerce-view với #checkout, #orders, #order/<id>, #order-success/<id>. Form hai cột desktop, một cột mobile; summary dưới form. Địa chỉ nhập văn bản để không hard-code danh mục hành chính lỗi thời. Payment COD/bank/QR, bank/QR chỉ mô phỏng, không thu tiền hoặc tự đánh dấu paid.

Backend mở POST /api/orders/quote, POST /api/orders, GET /api/orders, GET /api/orders/:id, GET /api/orders/request/:key. Tất cả cần cookie session; user chỉ thấy đơn của mình. Giá tính tập trung tại backend theo sale_price hợp lệ hoặc price, số nguyên VND. Shipping 30.000đ, miễn từ 20.000.000đ; discount bổ sung 0 vì chưa có coupon. Kiểm tra optional stock và trừ stock trong transaction nếu trường tồn tại. Order lưu snapshot sản phẩm, trạng thái pending và paymentStatus unpaid; không gọi dịch vụ thanh toán.

Quote hash buộc xác nhận lại nếu giá đổi. Idempotency key chống double click/retry và lưu pending key theo userId trong sessionStorage để khôi phục phản hồi bị mất, không lưu địa chỉ/điện thoại tại đó. Cart vẫn localStorage; chỉ trừ số lượng đã mua sau khi server xác nhận lưu đơn, giữ sản phẩm thêm sau đó. Order history lưu backend, không tạo key localStorage orders trùng chức năng.

## Implementation plan
- [x] API: viết/run test RED cho quote/tổng tiền, validation, stock, price change, idempotency, quyền sở hữu; tạo Backend/orders.cjs, tích hợp server.cjs và collection orders; chạy GREEN.
- [x] UI: viết browser test RED; tạo checkout.js + checkout.css, tái sử dụng request auth, format tiền, toast, hash routing/cart adapters. Hoàn thiện form/review/payment/success/history và session/logout.
- [x] Kiểm tra 15 tình huống yêu cầu, retry phản hồi mất, thêm giỏ giữa lúc đặt, stale routes, stock; chạy auth và regression sản phẩm; kiểm tra desktop/mobile bằng ảnh.
- [x] Rà soát độc lập, xử lý lỗi quan trọng, cập nhật README và báo cáo.

## Review focus
Giá thay đổi sau quote; phản hồi POST mất sau khi đã ghi; logout/chuyển tài khoản khi request chờ; cart thay đổi tab khác; order truy cập bằng ID người khác. Không sửa database chính để chạy test: dùng fixture tạm.


## Kết quả và cách sử dụng

1. Chạy `npm.cmd start` tại root workspace hoặc `node Backend/server.cjs` từ ASM. Nếu backend cũ đang chạy, restart để nạp API orders.
2. Mở frontend bằng Live Server `http://127.0.0.1:5501/` (web root ASM/frontend), hoặc Python static server :8000 như README.
3. Thêm laptop vào giỏ → Thanh toán. Nếu chưa login, modal hiện có sẽ mở; login thành công tiếp tục đến #checkout.
4. Nhập địa chỉ, chọn COD/bank/QR, kiểm tra tổng tiền và tick xác nhận → ĐẶT HÀNG.
5. Đơn được ghi thật trong Backend/db.json → orders, trạng thái pending/Chờ xác nhận. Trang thành công có Xem đơn hàng / Tiếp tục mua sắm. Menu tài khoản có Lịch sử đơn hàng (#orders).

Không tạo đơn thử trong database chính. Các suite dùng bản sao dữ liệu trong thư mục tạm. Collection orders của project chính được khởi tạo rỗng, sản phẩm và users hiện có được bảo toàn.

## Tính tiền và an toàn dữ liệu

- Giá hợp lệ lấy từ sale_price, nếu không có giảm giá thì price. Mỗi item lưu snapshot name/image/variant (nếu có)/price/quantity/subtotal.
- Backend tính subtotal + shippingFee − discount, kiểm tra số nguyên an toàn và total không âm. Không tin price/total gửi từ DOM.
- 30.000₫ phí vận chuyển, miễn phí khi subtotal >= 20.000.000₫. Discount bổ sung = 0; ưu đãi có sẵn nằm trong đơn giá. Chưa có coupon trong project nên không tạo logic coupon giả.
- Không có trường stock trong 39 sản phẩm hiện tại. Nếu bổ sung stock nguyên không âm, giỏ chặn tăng vượt stock và backend kiểm tra/trừ stock trong cùng transaction tạo order. Không tự thêm stock giả.
- Mỗi request tạo order dùng idempotencyKey; POST trùng trả lại đúng đơn, không trừ tồn kho lần nữa. Cùng key nhưng payload khác bị chặn.
- QuoteHash bắt xác nhận lại nếu giá/thông tin sản phẩm đã đổi. Dữ liệu người nhận validate ở cả client và server.
- Lịch sử/chi tiết/recovery kiểm tra cookie và chủ đơn tại backend; biết ID không đủ quyền xem đơn của người khác.
- Dữ liệu người nhận chỉ lưu trong đơn ở backend, không ghi localStorage/sessionStorage. Pending key không chứa mật khẩu, điện thoại hoặc địa chỉ.
- Giữ nguyên key giỏ `cyber-core-db-cart-v1`; đọc tương thích mảng `{id,qty}` cũ. Khi ghi mới dùng `{items:[...],appliedOrders:[...]}` để lưu giỏ và mã đơn đã áp dụng trong **một lần ghi atomic**. appliedOrders chỉ là biên nhận đồng bộ, không sao chép lịch sử đơn hàng. Web Locks trên localhost giúp hai tab không cùng trừ giỏ một đơn; cần trình duyệt hiện đại hỗ trợ Web Locks.
- Sau response thành công, đọc lại giỏ mới nhất và chỉ trừ số lượng đã mua. Đơn commit nhưng mất response sẽ được tìm lại bằng pending key khi thử lại/reload. Nếu không thể ghi giỏ, thông báo đơn đã lưu nhưng giỏ chưa đồng bộ, giữ pending để thử lại.

## Files tạo / sửa

Tạo:
- Backend/orders.cjs: validation, giá/tổng tiền, quote, tạo đơn có idempotency, history/detail/recovery.
- frontend/assets/js/checkout.js: form, payment, review, success, lịch sử và async state.
- frontend/assets/css/checkout.css: layout hai cột/một cột, trạng thái form/order, dùng tokens hiện có.
- frontend/tests/orders-api.cjs, frontend/tests/checkout-ui.cjs.
- docs/CHECKOUT.md.

Sửa:
- Backend/server.cjs và db.json: tích hợp routes và bổ sung orders; giữ products/users/authSessions.
- frontend/index.html: nạp module/CSS mới, commerce view, menu lịch sử, nút Thanh toán và FAQ.
- frontend/assets/js/ttech.js: cart adapter, stock limit, biên nhận chống trừ lặp, hash route.
- frontend/assets/js/auth.js: dùng chung request helper, callback user, sự kiện đổi phiên; bỏ khóa toàn cục làm chặn route độc lập.
- frontend/tests/redesign.cjs: kiểm tra chuyển checkout thay thông báo demo cũ; auth-ui.cjs chờ sự kiện close xóa password để tránh test timing không ổn định.
- package.json và README/docs liên quan.

## Kiểm thử

Từ root workspace:

```powershell
npm.cmd run test:orders
npm.cmd run test:checkout-ui
npm.cmd run test:auth
npm.cmd run test:auth-ui
```

- 5 test API orders (nhiều case mỗi test): giá/discount/shipping, payload/tồn kho, cạnh tranh stock, idempotency/double submit, giá đổi, quyền sở hữu/history/recovery. Cùng 11 test auth: tổng 16/16 đạt.
- Browser: COD một sản phẩm; nhiều sản phẩm/tổng tiền; tăng/giảm/xóa/reload cart; giỏ trống; thiếu tên/sai phone; thiếu payment/xác nhận; double click chỉ một order; reload success/history; bank/QR mô phỏng; responsive 320/390/768/1440px; không có lỗi JS runtime.
- Mô phỏng mất response sau commit; sản phẩm mới thêm trong lúc POST; tab nhân bản cùng khôi phục đơn; chuyển checkout → history trong lúc quote chậm; POST cũ hoàn tất không mở khóa POST mới; logout khi history response còn chờ không làm lộ dữ liệu.
- Rà soát độc lập phát hiện 3 lỗi bất đồng bộ nêu trên. Mỗi lỗi đã có kiểm thử RED → GREEN trước khi chốt bản sửa.
- Regression hiện có: redesign, product-detail, motion, premium, reference-ui. Ảnh checkout nằm tại docs/ui-reference/ttech-checkout-desktop.png và ttech-checkout-mobile.png của workspace.

## Giới hạn triển khai thật

Đặt hàng và lịch sử đã dùng backend thật của project, nhưng **chưa thu tiền thật**. Bank/QR dùng nhãn mô phỏng, không dùng số tài khoản/QR có thể giao dịch. COD ghi nhận lựa chọn thanh toán khi nhận hàng. Tất cả đơn mới paymentStatus=unpaid; không tự báo đã thanh toán.

Để triển khai production cần cổng thanh toán và webhook xác thực, HTTPS, kho hàng/vận chuyển thực, chính sách vận hành đơn và lưu trữ phù hợp tải thực tế. Chưa có UI admin chuyển trạng thái hoặc hủy đơn; không thêm hệ thống admin ngoài phạm vi. Database JSON và khóa ghi phục vụ bài ASM/local; không chạy JSON Server công khai trên file chứa users/orders.
