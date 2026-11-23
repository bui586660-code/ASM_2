> **Cập nhật 21/10/2026:** Backend dùng `../Backend/db.json` làm nguồn dữ liệu nghiệp vụ duy nhất. Không chạy JSON Server đồng thời với `node Backend/server.cjs`; server Node hiện là API duy nhất trên cổng 3000.

# T-TECH Frontend

Cửa hàng laptop dùng HTML5, CSS thuần, Tailwind qua CDN và JavaScript thuần. Giao diện hiện tại dựa trên ảnh cửa hàng điện tử được cung cấp: nền nội dung sáng, màu nhấn đỏ, header/footer charcoal, banner ngang và các cụm sản phẩm gọn.

Nền website phủ toàn bộ chiều ngang màn hình, không có khung ngoài hoặc nền gradient phía sau. Nội dung header, trang và footer dùng chung container căn giữa, rộng tối đa 1370px như ảnh tham chiếu; ở màn hình 1920px, mỗi lề rộng 275px. Khoảng cách tối thiểu trái/phải `--store-inset`: desktop 64px, màn hình dưới 1280px 32px, dưới 1024px 24px và mobile dưới 768px 16px.

## Chạy project

Từ root workspace `D:\JS-NANGCAO`, chạy backend Node.js (Node 22+; đã kiểm tra Node 24):

```powershell
npm.cmd start
```

Hoặc từ `ASM`: `node Backend/server.cjs`. Dừng JSON Server cũ nếu đang chiếm cổng 3000. Backend giữ API sản phẩm và xác thực; dữ liệu hoạt động nằm trong `Backend/db.json`.

Khởi động lại Live Server sau khi đổi cấu hình `.vscode/settings.json`, mở **http://127.0.0.1:5501/**. Web root phải là `ASM/frontend`, không phải thư mục chứa database. Phương án khác:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory ASM/frontend
```

Mở **http://127.0.0.1:8000/**. Giữ hai server hoạt động; không cần mở tab API. Cần Internet cho Tailwind CDN, Google Fonts và các ảnh ngoài còn tồn tại trong dữ liệu.

Không chạy JSON Server trực tiếp với database đã chứa tài khoản: collection `users`/phiên phải được giữ riêng tư. Xem [authentication](../docs/AUTHENTICATION.md) để biết API, cách thử và phân quyền.

## Mã nguồn và cấu trúc trang

- `index.html`: các landmark HTML5, Heroicons SVG sprite, ba view, metadata/FAQ và dialog hiện có.
- `assets/css/ttech.css`: tokens, component dùng chung, motion, catalog/detail và phần `Reference storefront` dành cho layout mới.
- `assets/js/ttech.js`: tải và chuẩn hóa API, state bộ lọc, card dùng chung, các cụm sản phẩm trang chủ, hash views, cart, favorites, gallery và các điểm tích hợp authentication.
- `assets/js/checkout.js` và `assets/css/checkout.css`: checkout, trang thành công, chi tiết và lịch sử đơn; tái sử dụng cart/auth/design tokens.
- `assets/js/auth.js`: request xác thực, phiên cookie, validation, modal tài khoản, profile và đăng xuất.
- `assets/images/`: ảnh sản phẩm và logo hiện có; không thay đổi file ảnh gốc.
- `tests/`: các kiểm thử Playwright, chạy bằng dependency đã có ở root workspace.

Sáu file giao diện cũ không còn được nạp đã được xóa ngày 10/10/2026. Xem [chức năng từng file và nhật ký dọn dẹp](../docs/FILE_GUIDE.md).

Trang chủ (`/` hoặc `#home`): utility bar → header/tìm kiếm/mega menu → navigation → carousel → thương hiệu → laptop nổi bật → hai banner → cụm khám phá bất đối xứng → banner MacBook → ưu đãi → bài tư vấn → dịch vụ → newsletter → footer.

Danh sách đầy đủ ở `#products`; tìm kiếm ở `#catalog-results`; chi tiết ở `#product/<id>`. Các hash hỗ trợ, liên hệ, thương hiệu và bài tư vấn dẫn tới nội dung có thật. Back/Forward và deep link hoạt động. Các danh sách sản phẩm ở view không hiện được bỏ khỏi DOM; dữ liệu và state vẫn dùng chung.

## Design system và ngữ nghĩa

- Font **Saira** theo CSS hiện tại của [Corsair](https://www.corsair.com/us/en), tải qua Google Fonts với hỗ trợ tiếng Việt; fallback Arial/sans-serif. Tiêu đề chính dùng trục width 125% (Expanded), nội dung và form dùng width mặc định. Giữ nguyên màu sắc, kích thước chữ và khoảng lề.
- **Heroicons 2.1.5**: SVG chính thức nhúng trong `index.html`, dùng `<use>`; giấy phép MIT đầy đủ nằm cạnh sprite. Không thêm thư viện icon JavaScript.
- Primary `#E31E24`, hover `#B91C1C`, light `#FEF2F2`; surface trắng, nền nội dung xám sáng và header/footer tối. Các vùng màu banner lấy cảm hứng từ ảnh tham chiếu.
- Trang chủ: 6 cột desktop, 3 cột tablet, 2 cột mobile. Cụm khám phá desktop có 8 card nhỏ và một card lớn. Nội dung và ảnh vẫn là laptop T-TECH; không tạo sản phẩm điện thoại, doanh số hoặc đánh giá giả để sao chép ảnh mẫu.
- Catalog: 4/3/2 cột; dưới 360px giữ 1 cột của giao diện danh sách trước. Drawer mobile dùng lại một DOM bộ lọc.
- Motion tokens 120/180/220/280ms; card nâng 3px trong 220ms, ảnh zoom 1.04; hover chuyển động chỉ áp dụng với con trỏ chính xác. `prefers-reduced-motion` tắt chuyển động và autoplay.
- Một H1 hiển thị cho mỗi view, landmark `header/nav/main/section/article/footer`, ảnh trong `figure`, thông số `dl`/`table`, label cho input và tên truy cập cho nút icon. Banner có phím điều hướng, pause và slide không hoạt động dùng `inert`.
- Meta description, Open Graph và FAQPage JSON-LD khớp nội dung FAQ hiển thị. Chưa khai báo canonical/domain thật, giá Offer hoặc đánh giá cấu trúc cho bản demo. Metadata không đảm bảo thứ hạng hay rich result.

## Dữ liệu và chức năng giữ nguyên

API: `http://localhost:3000/products`, đọc từ `Backend/db.json` (39 sản phẩm). Giữ nguyên mảng products, schema sản phẩm, thông số, giá, endpoint và file ảnh; database bổ sung users/authSessions/orders/payments. Ảnh lỗi dùng SVG dự phòng. Ánh xạ đường dẫn ảnh cũ `../Images/` sang `./assets/images/` vẫn được giữ.

- Lọc thương hiệu, khoảng giá, tên/brand; sort theo thứ tự dữ liệu hoặc giá tăng/giảm.
- Gaming/Văn phòng dùng cách phân loại GPU đã có; Khuyến mãi dùng giá giảm hợp lệ. Các nhóm filter cấu hình chưa được hỗ trợ vẫn ghi rõ giới hạn.
- `renderProductCard` dùng chung cho catalog, yêu thích, sản phẩm liên quan và biến thể compact trang chủ. Các shelf là lựa chọn từ dữ liệu API, không sao chép database. Không tuyên bố tồn kho hoặc doanh số khi không có dữ liệu.
- Cart giữ key `cyber-core-db-cart-v1`, số lượng 1–99, lưu trình duyệt và đồng bộ tab. Favorites giữ `ttech-favorites-v1`. Thêm vào giỏ không yêu cầu tài khoản; Mua ngay/Thanh toán yêu cầu đăng nhập rồi tiếp tục hành động đang làm. Gallery, thumbnail và sản phẩm liên quan giữ nguyên.
- Gallery gồm ảnh máy từ database và thumbnail bảng cấu hình SVG, không phải ảnh chụp góc khác.
- Banner có ba ảnh local, tự chuyển sau 6,5 giây; dừng khi hover/focus, ra ngoài viewport, tab ẩn hoặc reduced motion. Hỗ trợ arrows/dots/phím/swipe ngang.
- API loading/error/retry có thông báo thân thiện, không đưa localhost/JSON Server ra giao diện.
- Tài khoản xác thực thật; checkout tạo đơn vào backend, có trang thành công và lịch sử riêng theo user. Chuyển khoản/QR đang mô phỏng, chưa thu tiền trực tuyến. Xem [checkout](../docs/CHECKOUT.md). Newsletter xác thực email và thông báo chưa mở dịch vụ; không gửi hoặc lưu email. Bài tư vấn mở trực tiếp bằng `details`, không dẫn tới route trống.

## Kiểm tra

Các suite auth/checkout tự khởi động backend thật với database tạm, không tạo tài khoản thử trong database chính:

```powershell
npm.cmd run test:auth
npm.cmd run test:auth-ui
npm.cmd run test:orders
npm.cmd run test:checkout-ui
```

Với frontend :8000 và backend :3000 đang chạy:

```powershell
node ASM/frontend/tests/redesign.cjs
node ASM/frontend/tests/motion.cjs
node ASM/frontend/tests/product-detail.cjs
node ASM/frontend/tests/premium.cjs
node ASM/frontend/tests/reference-ui.cjs
```

Bốn suite đầu kiểm tra tích hợp API thật, search/filter/sort, cart/favorites, chi tiết/deep links, gallery, mega menu, responsive, motion và error/retry. Hai suite sản phẩm có fixture phiên để kiểm tra UI mua hàng; xác thực thật được kiểm tra riêng bởi `auth-ui.cjs`. `reference-ui.cjs` dùng fixture database qua Playwright interception, không cần API đang chạy; kiểm tra trang chủ, các luồng điều hướng, DOM gọn, heading/ảnh/icon/FAQ, newsletter và 320–1440px.

Ảnh kiểm tra nằm ở `docs/ui-reference/` tại root workspace: `reference-home-desktop.png`, `reference-home-mobile.png`, cùng ảnh catalog và detail từ các suite tương ứng. Spec Stitch cũ vẫn được giữ làm tài liệu lịch sử.
