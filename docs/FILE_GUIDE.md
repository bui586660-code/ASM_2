# Chức năng từng file trong ASM

Kiểm kê cập nhật 21/10/2026. Mã đang chạy là `frontend/index.html` → `auth.js`, `payments.js`, `checkout.js`, `ttech.js`; CSS là `ttech.css` và `checkout.css`. Backend vào qua `Backend/server.cjs`, dữ liệu nghiệp vụ mặc định là `db.json`.

## Mã nguồn, dữ liệu, cấu hình và tài liệu

| File | Chức năng |
|---|---|
| `Backend/.env.example` | Mẫu cấu hình port, Origin, tài khoản MB và bật/tắt thanh toán; không chứa secret thật. |
| `Backend/db.json` | Nguồn dữ liệu hoạt động duy nhất: products, users, authSessions, orders, payments, paymentAudit và metadata. |
| `Backend/json-storage.cjs` | Hàng đợi ghi JSON, lock file, kiểm tra collection và ghi file tạm an toàn cho backend local. |
| `Backend/migrate-sqlite-to-json.cjs` | Công cụ nhập một lần dữ liệu SQLite cũ vào db.json, tạo backup và marker chống nhập lặp. |
| `Backend/db.json.pre-sqlite-96f4ea038021.bak` | Bản sao nguyên dữ liệu JSON trước migration; phục vụ đối chiếu/khôi phục, không phải file thừa. |
| `Backend/orders.cjs` | Tính giá và phí vận chuyển phía server, kiểm tra đơn/tồn kho, chống đặt trùng, lưu và đọc lịch sử đơn theo chủ tài khoản. |
| `Backend/promotions.cjs` | Kiểm tra mã giảm giá, điều kiện áp dụng, giới hạn lượt dùng và tính giảm tiền phía server. |
| `Backend/promotions.json` | Cấu hình ưu đãi do chủ website quản lý; danh sách đang trống, không bật ưu đãi thật. Khởi động lại backend sau khi sửa. |
| `Backend/payments.cjs` | Cấu hình MB, tạo thông tin VietQR, xác thực webhook SePay, đối soát tiền và xác nhận thủ công có audit cho admin. |
| `Backend/server.cjs` | Entry backend Node HTTP: API sản phẩm, đăng ký/đăng nhập/phiên/đăng xuất, quyền admin, CORS và tích hợp route đơn hàng/thanh toán. |
| `Backend/storage.cjs` | Adapter SQLite lịch sử, chỉ dùng bởi công cụ đối chiếu/migration cũ; server không nạp file này. |
| `Backend/ttech.sqlite` | Dữ liệu SQLite cũ để đối chiếu/khôi phục có kiểm soát; không phải database đang hoạt động. |
| `Backend/ttech.sqlite-shm` | Tệp SQLite lịch sử đi kèm, giữ nguyên để đối chiếu. |
| `Backend/ttech.sqlite-wal` | Tệp SQLite lịch sử đi kèm, giữ nguyên để đối chiếu. |
| `README.md` | Hướng dẫn tổng quan, cấu trúc và cách khởi chạy project. |
| `docs/AUTHENTICATION.md` | Tài liệu xác thực, tài khoản/quyền và kiểm thử trên db.json. |
| `docs/CHECKOUT.md` | Thiết kế và lịch sử triển khai checkout; tài liệu thanh toán mới nằm trong PAYMENTS.md. |
| `docs/FILE_GUIDE.md` | Bảng chức năng từng file và nhật ký dọn dẹp này. |
| `docs/PAYMENTS.md` | Hướng dẫn db.json, nhập dữ liệu SQLite cũ, MB/SePay, env, webhook, kiểm thử và giới hạn nghiệm thu Live. |
| `docs/PRODUCT_DATA_SOURCES.md` | Nguồn đối chiếu mã máy, thông số và ảnh sản phẩm. |
| `frontend/README.md` | Hướng dẫn frontend, giao diện, route, dữ liệu và kiểm thử. |
| `frontend/assets/css/checkout.css` | Style checkout, thông tin đơn hàng, chuyển khoản/QR và panel quản trị thanh toán. |
| `frontend/assets/css/ttech.css` | Design tokens, màu/font, layout, responsive và motion cho các thành phần cửa hàng. |
| `frontend/assets/js/auth.js` | API helper có cookie, validation, modal login/register, phiên đăng nhập, profile, quyền hiển thị và logout. |
| `frontend/assets/js/checkout.js` | Form nhận hàng, quote từ server, đặt đơn/chống gửi lặp, khôi phục request, lịch sử và chi tiết đơn. |
| `frontend/assets/js/payments.js` | Hiển thị QR/tài khoản MB, sao chép, polling trạng thái và giao diện đối soát admin; không tự xác nhận paid phía client. |
| `frontend/assets/js/ttech.js` | Logic cửa hàng: tải sản phẩm, render card, tìm kiếm/lọc/sort, hash routing, detail/gallery, giỏ hàng, yêu thích và slider. |
| `frontend/index.html` | Trang vào frontend: header/footer, các view trang chủ/danh sách/chi tiết, modal tài khoản/giỏ hàng, metadata và nạp CSS/JS. |
| `frontend/tests/auth-api.cjs` | Kiểm thử backend đăng ký, mật khẩu, cookie/session, quyền, CORS và lỗi. |
| `frontend/tests/auth-ui.cjs` | Kiểm thử modal tài khoản trên trình duyệt, đăng nhập/đăng xuất, phiên, validation và lỗi mạng. |
| `frontend/tests/checkout-ui.cjs` | Kiểm thử giỏ hàng → đặt đơn → lịch sử, reload, mất response và race giữa các tab. |
| `frontend/tests/motion.cjs` | Kiểm thử hover/motion, không dịch layout, reduced motion và cảm ứng. |
| `frontend/tests/orders-api.cjs` | Kiểm thử quote, tổng tiền, tồn kho, chống trùng và quyền sở hữu đơn. |
| `frontend/tests/payment-storage.cjs` | Kiểm thử hàng đợi/lock JSON, bảo toàn collection và mở lại dữ liệu JSON. |
| `frontend/tests/payments-api.cjs` | Kiểm thử HMAC/webhook, đối soát, giao dịch lặp/sai tiền, quyền admin, rollback và dữ liệu cũ. |
| `frontend/tests/payments-ui.cjs` | Kiểm thử MB/VietQR, ngân hàng gửi, copy, lỗi QR, trạng thái thanh toán và admin trên trình duyệt. |
| `frontend/tests/premium.cjs` | Kiểm thử slider tự chạy/dừng/swipe, bộ sưu tập, ưu đãi và responsive. |
| `frontend/tests/product-detail.cjs` | Kiểm thử route chi tiết, gallery/thumbnail, số lượng, yêu thích, mega menu và lỗi sản phẩm. |
| `frontend/tests/redesign.cjs` | Kiểm thử API sản phẩm, tìm kiếm/lọc/sort, giỏ hàng và bố cục responsive. |
| `frontend/tests/reference-ui.cjs` | Kiểm thử trang chủ theo reference, shelf/card dùng chung, ngữ nghĩa HTML, điều hướng và responsive. |

## Từng file ảnh

Các ảnh dưới đây phục vụ sản phẩm, logo và fallback. Đã kiểm tra cả mã nguồn, JSON, bản sao JSON và snapshot SQLite trước khi loại bỏ ảnh cũ.

| File trong `frontend/assets/images/` | Chức năng | Tham chiếu kiểm tra được |
|---|---|---|
| `acer-logo.jpg` | Logo ACER cho bộ chọn thương hiệu. | `frontend/index.html` |
| `apple-macbook-air-13-m4-10cpu-8gpu-16gb-256gb-2025.png` | Ảnh sản phẩm apple macbook air 13 m4 10cpu 8gpu 16gb 256gb 2025. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products` |
| `asus-logo.jpg` | Logo ASUS cho bộ chọn thương hiệu. | `frontend/index.html` |
| `dell-alienware-15-da15265-ryzen-5-220.jpg` | Ảnh sản phẩm dell alienware 15 da15265 ryzen 5 220. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products` |
| `dell-logo.jpg` | Logo DELL cho bộ chọn thương hiệu. | `frontend/index.html` |
| `hp-logo.jpg` | Logo HP cho bộ chọn thương hiệu. | `frontend/index.html` |
| `laptop-acer-gaming-aspire-7-a715-59g-59rd.png` | Ảnh sản phẩm laptop acer gaming aspire 7 a715 59g 59rd. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products`; `SQLite: orders` |
| `laptop-acer-gaming-nitro-v-15-propanel-anv15-52-50va.png` | Ảnh sản phẩm laptop acer gaming nitro v 15 propanel anv15 52 50va. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-acer-gaming-predator-helios-neo-16s-ai-phn16s-71-95ms.png` | Ảnh sản phẩm laptop acer gaming predator helios neo 16s ai phn16s 71 95ms. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-acer-predator-helios-neo-16s-phn16s-i51-98cx.png` | Ảnh sản phẩm laptop acer predator helios neo 16s phn16s i51 98cx. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-asus-rog-strix-g16-g614ph-s5101w.png` | Ảnh sản phẩm laptop asus rog strix g16 g614ph s5101w. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products` |
| `laptop-asus-rog-zephyrus-g14-gu405aw-sy029w.png` | Ảnh sản phẩm laptop asus rog zephyrus g14 gu405aw sy029w. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-asus-rog-zephyrus-g16-gu606aw-tb121w.png` | Ảnh sản phẩm laptop asus rog zephyrus g16 gu606aw tb121w. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-asus-tuf-gaming-a15-fa506ncg-hn329w.png` | Ảnh sản phẩm laptop asus tuf gaming a15 fa506ncg hn329w. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-asus-tuf-gaming-a15-fa506ncg-hn390w.png` | Ảnh sản phẩm laptop asus tuf gaming a15 fa506ncg hn390w. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-asus-tuf-gaming-f16-fx608jhi-tu209w.png` | Ảnh sản phẩm laptop asus tuf gaming f16 fx608jhi tu209w. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-hp-gaming-omen-16-am0176tx-bx9d3pa.png` | Ảnh sản phẩm laptop hp gaming omen 16 am0176tx bx9d3pa. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-hp-victus-15-fa2451tx-d17wppa.png` | Ảnh sản phẩm laptop hp victus 15 fa2451tx d17wppa. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-hp-victus-15-fa2731tx-b85lnpa.png` | Ảnh sản phẩm laptop hp victus 15 fa2731tx b85lnpa. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products` |
| `laptop-hp-victus-15-fb3116ax-bx8u4pa.png` | Ảnh sản phẩm laptop hp victus 15 fb3116ax bx8u4pa. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-hp-victus-16-r0376tx-ay8z2pa.png` | Ảnh sản phẩm laptop hp victus 16 r0376tx ay8z2pa. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-lenovo-legion-5-15ahp11-83q7001jvn.png` | Ảnh sản phẩm laptop lenovo legion 5 15ahp11 83q7001jvn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-lenovo-legion-5-15iax11-83vk00a2vn.png` | Ảnh sản phẩm laptop lenovo legion 5 15iax11 83vk00a2vn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-lenovo-legion-5-15iph11-83rw0023vn.png` | Ảnh sản phẩm laptop lenovo legion 5 15iph11 83rw0023vn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-lenovo-legion-7-16iax10-83ky001uvn.png` | Ảnh sản phẩm laptop lenovo legion 7 16iax10 83ky001uvn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products` |
| `laptop-lenovo-loq-15ahp11-83tn0040vn.png` | Ảnh sản phẩm laptop lenovo loq 15ahp11 83tn0040vn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-lenovo-loq-15arp10e-83s0007avn.png` | Ảnh sản phẩm laptop lenovo loq 15arp10e 83s0007avn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-lenovo-loq-15arp10e-83s000devn.png` | Ảnh sản phẩm laptop lenovo loq 15arp10e 83s000devn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products`; `SQLite: orders` |
| `laptop-lenovo-loq-15iph11-83sl000lvn.png` | Ảnh sản phẩm laptop lenovo loq 15iph11 83sl000lvn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-lenovo-loq-15irx9-83dv003cvn.png` | Ảnh sản phẩm laptop lenovo loq 15irx9 83dv003cvn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-lenovo-loq-essential-15arp10e-83s0000dvn.png` | Ảnh sản phẩm laptop lenovo loq essential 15arp10e 83s0000dvn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-msi-cyborg-15-a13uc-2082vn.png` | Ảnh sản phẩm laptop msi cyborg 15 a13uc 2082vn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-msi-cyborg-15-a13uc-2088vn.png` | Ảnh sản phẩm laptop msi cyborg 15 a13uc 2088vn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-msi-katana-15-b13vek-2440vn.png` | Ảnh sản phẩm laptop msi katana 15 b13vek 2440vn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products`; `SQLite: orders` |
| `laptop-msi-stealth-16-ai-b3wg-008vn.png` | Ảnh sản phẩm laptop msi stealth 16 ai b3wg 008vn. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `laptop-placeholder.svg` | Ảnh dự phòng khi ảnh sản phẩm thiếu hoặc tải lỗi. | `frontend/assets/js/checkout.js`; `frontend/tests/orders-api.cjs` |
| `lenovo-logo.jpg` | Logo LENOVO cho bộ chọn thương hiệu. | `frontend/index.html` |
| `macbook-air-13-inch-m5-10-cpu-8-gpu-16gb-512gb-2026-sac-70w.png` | Ảnh sản phẩm macbook air 13 inch m5 10 cpu 8 gpu 16gb 512gb 2026 sac 70w. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `SQLite: products` |
| `macbook-air-13-m5-10-cpu-8-gpu-16gb-512gb.png` | Ảnh sản phẩm macbook air 13 m5 10 cpu 8 gpu 16gb 512gb. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products` |
| `macbook-air-m2-2022-16gb-512gb.jpg` | Ảnh sản phẩm macbook air m2 2022 16gb 512gb. | `Backend/db.json`; `docs/PRODUCT_DATA_SOURCES.md`; `frontend/index.html`; `SQLite: products` |
| `msi-logo.jpg` | Logo MSI cho bộ chọn thương hiệu. | `frontend/index.html` |

## File đã xóa

Sáu file này không được index.html nạp, không được code hoạt động import/fetch và không được bộ test dùng. README cũ cũng xác nhận chúng chỉ là giao diện cũ giữ lại.

| File | Lý do |
|---|---|
| `frontend/assets/js/main.js` | Renderer sản phẩm cũ; đã được ttech.js thay thế. |
| `frontend/assets/js/cyber.js` | Menu/slider/dialog phiên bản cyberpunk cũ, không dùng với HTML hiện tại. |
| `frontend/assets/js/storefront.js` | Logic storefront cũ, không được entry hiện tại nạp. |
| `frontend/assets/css/style.css` | CSS nền tảng cũ, đã thay bằng ttech.css. |
| `frontend/assets/css/cyber.css` | Theme neon/cyberpunk cũ, không còn sử dụng. |
| `frontend/assets/css/storefront.css` | Theme storefront cũ, không còn sử dụng. |
| `frontend/assets/images/Acer-Nitro-V-15-ANV15-51-929M.jpg` | Ảnh laptop cũ không có reference trong mã nguồn/dữ liệu/đơn hàng/backup. |
| `frontend/assets/images/ASUS-TUF-Gaming-A15-FA507.jpg` | Ảnh laptop cũ không có reference trong mã nguồn/dữ liệu/đơn hàng/backup. |
| `frontend/assets/images/LOQ-15IRX9-2024.jpg` | Ảnh laptop cũ không có reference trong mã nguồn/dữ liệu/đơn hàng/backup. |
| `frontend/assets/images/msi-15.jpg` | Ảnh laptop cũ không có reference trong mã nguồn/dữ liệu/đơn hàng/backup. |
| `frontend/assets/images/msi-katana-15.jpg` | Ảnh laptop cũ không có reference trong mã nguồn/dữ liệu/đơn hàng/backup. |

## Không xóa

- Database SQLite, WAL/SHM và bản sao JSON: liên quan dữ liệu thật và khôi phục.
- `.env.example`: cần khi cấu hình máy khác; không phải dữ liệu mẫu thừa.
- Bộ test: kiểm tra hồi quy khi chỉnh sửa chức năng.
- Tài liệu nguồn sản phẩm và lịch sử triển khai: hỗ trợ đối chiếu/bảo trì.
- 41 ảnh còn lại: ảnh sản phẩm, logo và SVG dự phòng.

Không chỉnh sửa logic nghiệp vụ, dữ liệu sản phẩm/tài khoản/đơn hàng trong lần dọn dẹp này.
Tổng cộng đã xóa 11 file: 6 file code cũ và 5 ảnh không được tham chiếu.
