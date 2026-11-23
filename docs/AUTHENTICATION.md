> **Cập nhật 21/10/2026:** Tài khoản và phiên được đọc/ghi trong `Backend/db.json`. `ttech.sqlite` chỉ là bản dữ liệu cũ; xem [PAYMENTS.md](PAYMENTS.md) để biết cách nhập một lần và giới hạn JSON.

# T-TECH authentication

## Cập nhật 19/10/2026: kết nối backend và chỉnh sửa hồ sơ

Lỗi đăng ký thực tế do cổng 3000 đang chạy JSON Server (`json-server db.json`), không phải `Backend/server.cjs`. `/products` vẫn trả 200 nhưng `/api/auth/session` và các route authentication không tồn tại. Preflight của JSON Server trả `Access-Control-Allow-Origin: *` mà không cho credentials, nên request cookie của trình duyệt bị chặn. Đã dừng đúng tiến trình JSON Server và chạy backend T-TECH hiện có; không migration hoặc ghi đè dữ liệu.

Chạy từ `D:\JS-NANGCAO`: `npm.cmd start`. Hoặc từ `ASM`: `node Backend/server.cjs`. Chỉ chạy một backend trên cổng 3000. Frontend dùng Live Server, web root `ASM/frontend`, tại `http://127.0.0.1:5501/`. `/api/health` phải trả `service: "ttech-auth"` và `ok: true`. Không dùng JSON Server thay thế backend này.

Workspace `.vscode/settings.json` đã sửa `liveServer.settings.root` từ `/` thành `/ASM/frontend`. Cần Stop/Start Live Server để áp dụng; không phục vụ toàn bộ workspace vì có file backend/database. Khi kiểm tra, phiên Live Server cũ vẫn dùng root workspace: trang `/ASM/frontend/index.html` gọi session có cookie và products thành công, không có lỗi JavaScript. URL `/` của cấu hình mới cần kiểm tra lại sau khi khởi động lại extension.

Backend mặc định dùng `Backend/db.json`. Không cần biến môi trường mới cho hồ sơ; giữ nguyên cấu hình `PORT`, `HOST`, `TTECH_DB_PATH`, origin và payment hiện tại. Không thay đổi cấu hình thanh toán để kiểm tra authentication.

### API và dữ liệu

- Giữ nguyên POST `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, GET `/api/auth/session`, `/api/auth/me` và API sản phẩm/đơn hàng/thanh toán.
- Thêm PATCH `/api/auth/me`: chỉ nhận `name`, `phone`, `birthday`, `gender`, `address`; chỉ sửa người dùng sở hữu session. Mọi trường khác (email, ID, role, isAdmin, status, emailVerified, password...) đều bị từ chối. Session và trạng thái tài khoản được kiểm tra lại trong transaction ghi.
- `name`: bắt buộc, chuẩn hóa khoảng trắng, tối đa 80 ký tự. `phone`: tùy chọn, `0` + 9 chữ số hoặc `+84` + 9 chữ số. `birthday`: tùy chọn, ngày hợp lệ từ năm 1900 đến ngày hiện tại ở Việt Nam. `gender`: chuỗi rỗng, `male`, `female`, `other`. `address`: tùy chọn, tối đa 500 ký tự. Trường tùy chọn có thể xóa bằng chuỗi rỗng.
- Response vẫn `{ user }` (PATCH có thêm `message`); bổ sung các trường hồ sơ và `emailVerified` từ dữ liệu backend. Không có xác minh email giả: tài khoản không có cờ xác minh hiển thị “Chưa xác minh”.
- Giữ password hash scrypt có salt, session cookie HttpOnly/SameSite=Strict, token hash trong database. Không lưu mật khẩu/session token vào localStorage hoặc sessionStorage. Các trường hồ sơ được lưu trong payload người dùng hiện có, không thêm database hay migration.

### Sử dụng và kiểm thử

Đăng nhập → tên tài khoản → Tài khoản của tôi → Chỉnh sửa → Lưu. Hủy chỉnh sửa khôi phục thông tin đã lưu. Request lỗi giữ bản nháp và bật lại nút lưu. Chống gửi lặp; đóng modal hoặc đổi phiên không cho response cũ ghi đè hồ sơ. Phiên hết hạn yêu cầu đăng nhập lại rồi tiếp tục mở hồ sơ.

Các test API kiểm tra validation đăng ký/hồ sơ, trùng email, session/role, chặn sửa người khác, lỗi database, JSON restart, hồi quy đơn hàng và thanh toán. Test dùng database và tài khoản ngẫu nhiên trong thư mục tạm; không cung cấp mật khẩu test cố định hoặc tạo đơn thật.

Lệnh chạy từ root workspace: `npm.cmd run test:auth`, `npm.cmd run test:auth-ui`, `npm.cmd run test:orders`, `npm.cmd run test:payments`. Các test UI checkout/payment tạo screenshot, nên chạy trong thư mục tạm nếu muốn giữ ảnh tài liệu hiện có.

Chưa triển khai gửi email xác minh, đổi email, quên/đổi mật khẩu. Trước production cần HTTPS, cấu hình origin theo tên miền thật, quản lý bí mật và sao lưu/kiểm soát truy cập database. Không dùng kết quả test webhook giả lập làm bằng chứng giao dịch ngân hàng thật.

## Khảo sát và quyết định

Workspace gồm project ASM đang hoạt động, ba bản sao ASM, bài học/lab và tài liệu. Chỉ sửa ASM cùng cấu hình chạy ở root; không chuyển framework hoặc database. Entry là `frontend/index.html`, CSS `ttech.css`, JS `ttech.js`; các file main/cyber/storefront cũ không được entry nạp. Package root chỉ có Playwright. `Backend/db.json` hiện có 39 sản phẩm; không có users, server xác thực hoặc dashboard.

Trước khi tích hợp, modal dùng `#auth-modal`, form chung `#auth-form`, hai tab login/register; validation và thông báo demo nằm trong `ttech.js`. Sản phẩm dùng GET `http://localhost:3000/products`; cart/favorites dùng localStorage. Live Server dùng port 5501.

Kiến trúc chọn: một server Node.js dùng module chuẩn `http`, `crypto`, `fs`; đọc/ghi cùng db.json. Không cần Express hoặc thư viện mới cho số route nhỏ. Server thay lệnh JSON Server trên port 3000, giữ GET `/products` và `/products/:id`. Không chạy JSON Server trực tiếp trên database chứa tài khoản vì nó sẽ công khai collection users.

Session opaque 32 byte, cookie HttpOnly/SameSite=Strict, 7 ngày; chỉ hash token ở database. Mật khẩu scrypt có salt riêng, N=32768/r=8/p=3, không lưu password/token trong localStorage. API kiểm tra user/status/role mỗi request. Origin allowlist và JSON-only POST bảo vệ request từ trình duyệt. Email normalize và duplicate-check được thực hiện trong transaction ghi tuần tự. File được thay thế atomic sau khi ghi hoàn tất. Khóa `db.json.lock` độc quyền bảo vệ cả process CLI; nếu đang có writer khác, request trả 503 thay vì ghi đè dữ liệu.

Hai file chạy mới: `Backend/server.cjs`, `frontend/assets/js/auth.js`. Auth module dùng lại dialog và callback open/close/notify của giao diện; không nhân đôi modal. Cart/favorites khách được giữ; Buy Now, Checkout và Account xác minh phiên trước khi tiếp tục. Checkout đã được bổ sung API đơn hàng, xem [CHECKOUT.md](CHECKOUT.md); chưa tích hợp thu tiền trực tuyến.

## Kế hoạch thực hiện

- [x] Test API bằng database tạm: register/validation/duplicate race/hash/login/session/restart/logout/expiry/status/admin/origin/rate-limit/products.
- [x] Server auth và collection users/authSessions, bảo vệ database khỏi public static server.
- [x] Nối modal hiện có: field errors, pending request, password visibility, account menu/profile/logout và tiếp tục protected action.
- [x] Kiểm thử browser với backend thật và dữ liệu tạm: 15 tình huống yêu cầu, offline/timeout/invalid response, mobile, storage.
- [x] Chạy lại các bộ kiểm thử sản phẩm/chi tiết/cart/layout, cập nhật lệnh chạy và báo cáo giới hạn.

## API hiện tại

Base URL frontend: `http://127.0.0.1:3000/api` khi mở trang bằng 127.0.0.1; dùng `localhost` tương ứng nếu mở trang bằng localhost. Cookie cần cùng hostname giữa frontend và auth API.

| Method | Route | Quyền / kết quả |
| --- | --- | --- |
| GET | `/products` | Public, toàn bộ sản phẩm hiện có |
| GET | `/products/:id` | Public, sản phẩm theo ID |
| GET | `/api/health` | Kiểm tra server |
| POST | `/api/auth/register` | `{name,email,password,confirm}` → 201, user công khai; chưa đăng nhập |
| POST | `/api/auth/login` | `{email,password}` → 200, user công khai + cookie phiên |
| GET | `/api/auth/session` | 200, user hiện tại hoặc `null` khi là khách/hết phiên |
| GET | `/api/auth/me` | User đăng nhập; 401 nếu phiên không hợp lệ |
| POST | `/api/auth/logout` | Body `{}`, thu hồi phiên + xóa cookie |
| GET | `/api/admin/summary` | Admin: số sản phẩm/số tài khoản; khách 401, user 403 |

Các request auth dùng `credentials: 'include'`. POST phải là JSON, Origin trong allowlist. Mặc định hỗ trợ localhost/127.0.0.1 tại cổng 5501 và 8000. Có thể cấu hình `FRONTEND_ORIGINS` bằng danh sách origin phân cách dấu phẩy. Không dùng `*` với cookie.

Không công khai `/users`, `/authSessions`, `/db.json` hoặc thư mục Backend. Server chỉ giữ các API sản phẩm mà frontend hiện tại sử dụng (GET); không mở JSON Server CRUD tùy ý hoặc chức năng quản trị sản phẩm chưa có.

## Database

`Backend/db.json` giữ nguyên toàn bộ 39 sản phẩm. Chỉ bổ sung hai collection rỗng lúc khởi tạo; đăng ký/đăng nhập sẽ ghi dữ liệu thật vào đây:

- `users`: `id` UUID, `name` đã trim, `email` lowercase, `passwordHash` (scrypt + salt), `role` (`user` mặc định hoặc `admin`), `status` (`active` mặc định), `createdAt` ISO. Trường `phone` tùy chọn được hiển thị nếu đã có; form đăng ký hiện tại không thu thập số điện thoại.
- `authSessions`: `tokenHash` SHA-256, `userId`, `createdAt`, `expiresAt`. Cookie chứa token ngẫu nhiên; database chỉ giữ hash. Tối đa 10 phiên/tài khoản; phiên hết hạn được dọn khi login/logout.
- Response user chỉ gồm ID, tên, email, role, status, createdAt và phone nếu có; không trả passwordHash hoặc token.

Email trùng được chặn trong transaction ghi tuần tự, kể cả hai request đồng thời. Mỗi lần ghi đọc lại database và giữ mọi collection khác. Ưu tiên chỉ chạy **một process backend**, dừng backend trước khi cấp quyền admin và không sửa db.json bằng editor trong lúc server đang ghi. Khóa ghi được tự xóa khi transaction kết thúc. Nếu process bị tắt cưỡng bức và còn `Backend/db.json.lock`, dừng tất cả process đang dùng database, kiểm tra không còn writer, rồi xóa riêng file lock này và khởi động lại; không xóa db.json.

## Chạy và dùng thử

Từ `D:\JS-NANGCAO`:

```powershell
npm.cmd start
```

Hoặc từ `ASM`: `node Backend/server.cjs`. Node 22+ được khuyến nghị; đã chạy kiểm thử trên Node 24.21.0. Không cần thêm package runtime.

Restart Live Server và mở `http://127.0.0.1:5501/`. `.vscode/settings.json` tại workspace đặt root `/ASM/frontend`; nếu mở riêng thư mục ASM trong VS Code, chọn `frontend` làm web root. Không phục vụ toàn bộ ASM bằng static server vì chứa database tài khoản. Có thể thay Live Server bằng:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory ASM/frontend
```

1. Bấm tài khoản → Đăng ký, nhập tên/email/mật khẩu/nhập lại mật khẩu.
2. Đăng ký thành công chuyển sang Login và điền sẵn email; mật khẩu được xóa khỏi form.
3. Đăng nhập → tên hiện trên header; mở menu để xem tài khoản hoặc đăng xuất.
4. Reload vẫn đăng nhập. Đăng xuất thu hồi phiên trên server và cập nhật các tab cùng origin, kể cả khi phản hồi phiên cũ đang bị trễ.
5. Khi là khách, bấm Mua ngay hoặc Thanh toán → modal login; sau đăng nhập tiếp tục đúng thao tác. Hủy modal sẽ hủy hành động chờ.

### Tài khoản thử và admin

Không cài tài khoản hoặc mật khẩu mặc định trong database chính. Hãy đăng ký bằng email của bạn trong modal. Suite tự động dùng `tester@example.com` và mật khẩu ngẫu nhiên **chỉ trong database tạm**, tự xóa sau kiểm thử; tài khoản đó không dùng để đăng nhập website chính.

Muốn kiểm tra admin: đăng ký tài khoản của bạn trước, dừng backend, rồi từ `ASM` chạy:

```powershell
node Backend/server.cjs --promote email-ban-vua-dang-ky@example.com
node Backend/server.cjs
```

Thay email bằng tài khoản thực đã đăng ký. Reload website, menu có Tổng quan quản trị. Việc cấp quyền là thao tác CLI của người sở hữu project; frontend không thể tự gửi role=admin. Project trước đó chưa có dashboard; phần mới chỉ là tổng quan số sản phẩm/tài khoản, không tạo thêm hệ thống quản trị sản phẩm.

## Kiểm thử và kết quả

```powershell
npm.cmd run test:auth
npm.cmd run test:auth-ui
```

Hai suite tự chạy backend, dùng database tạm và xác nhận database chính không đổi. Suite API đạt **11/11**, kiểm tra khóa ghi liên process, lỗi dữ liệu/định dạng request, hash, phiên qua restart, logout/expiry/rotation, status, role, nguồn truy cập, rate limit, duplicate đồng thời và API sản phẩm. Suite browser gửi request tới backend thật, chỉ mô phỏng phản hồi lỗi trong các ca offline/timeout/404/500/invalid response.

| Yêu cầu kiểm thử | Kết quả |
| --- | --- |
| 1. Đăng ký mới | Đạt; ghi user thật, password hash |
| 2. Email trùng | Đạt; không phân biệt hoa/thường, kể cả đồng thời |
| 3. Email sai format | Đạt, lỗi tại field + backend validation |
| 4. Mật khẩu dưới 8 ký tự | Đạt |
| 5. Confirm khác password | Đạt |
| 6. Login đúng | Đạt; cookie HttpOnly và header user |
| 7. Sai password | Đạt; thông báo chung |
| 8. Email không tồn tại | Đạt; cùng thông báo với sai password |
| 9. Reload sau login | Đạt; phiên được kiểm tra lại ở backend |
| 10. Logout | Đạt; token bị thu hồi, nhiều tab về trạng thái khách |
| 11. Protected action khi chưa login | Đạt; Buy Now mở login, chưa thêm giỏ |
| 12. Login rồi protected action | Đạt; hành động Buy Now tiếp tục đúng một lần |
| 13. Admin/user | Đạt; server trả 401/403 phù hợp và admin được xem summary |
| 14. Backend/network lỗi | Đạt; không báo thành công giả, có timeout/loading và thông báo thân thiện |
| 15. Responsive mobile | Đạt; 320, 390, 768, 1440px không tràn ngang |

Đã kiểm tra thêm đóng modal khi login đang chờ: hủy hành động mua, xóa password khỏi form và không báo thành công giả.

Các bộ `redesign.cjs`, `product-detail.cjs`, `motion.cjs`, `premium.cjs`, `reference-ui.cjs` đã chạy lại: sản phẩm, chi tiết, giỏ, wishlist, search/filter/sort, gallery, mega menu, motion, responsive và error/retry. Hai suite product có fixture phiên để tách kiểm tra UI mua hàng khỏi auth; auth thật được kiểm tra ở suite riêng. Khi chạy song song từng gặp lỗi mạng `ERR_CONNECTION_REFUSED`; chạy lại tuần tự đều đạt, không có lỗi runtime và không có console error trong hoạt động bình thường.

Đã kiểm tra thêm cùng origin `http://127.0.0.1:5501` bằng static server trỏ đúng frontend: CSS/JS trả 200, đường dẫn Backend/db.json trả 404, không có console/runtime error. Live Server cần restart để nhận web root mới.

Ảnh kiểm tra modal: `D:\JS-NANGCAO\docs\ui-reference\ttech-auth-desktop.png` và `ttech-auth-mobile.png`.

## Files đã kiểm tra / thay đổi

Đã khảo sát cấu trúc workspace, `.agent`, package/config, Backend/db.json, entry frontend, các CSS/JS hiện có (kể cả main/cyber/storefront không nạp), asset references, docs và năm suite giao diện cũ. Các bản sao ASM và bài học/lab không thuộc phạm vi chỉnh sửa.

Tạo mới:
- `Backend/server.cjs`
- `frontend/assets/js/auth.js`
- `frontend/tests/auth-api.cjs`, `frontend/tests/auth-ui.cjs`
- `docs/AUTHENTICATION.md`

Chỉnh sửa:
- `Backend/db.json`: thêm users/authSessions; giữ nguyên products.
- `frontend/index.html`: nạp auth.js, bổ sung field errors/confirm visibility, user menu và profile tối thiểu; bỏ thông báo auth demo.
- `frontend/assets/js/ttech.js`: bỏ handler auth demo, tích hợp auth module và protected purchase.
- `frontend/assets/css/ttech.css`: trạng thái validation/loading, account menu/profile; giữ design system.
- `frontend/tests/redesign.cjs`, `product-detail.cjs`, `reference-ui.cjs`: cập nhật giả định auth trong regression tests.
- `frontend/README.md`, `README.md`: lệnh chạy và phạm vi mới.
- Workspace `package.json`: script chạy/test; `.vscode/settings.json`: static web root.

Không xóa file, không thêm dependency, không thay sản phẩm/ảnh/API products/filter/sort/route/cart storage. Các ảnh regression trong `docs/ui-reference` của workspace được cập nhật bởi bộ test.

## Phạm vi còn lại

Authentication hoạt động thật cho bài ASM/local development. Checkout đã lưu đơn thật vào backend (xem CHECKOUT.md); chưa có cổng thu tiền, email verification hoặc quên mật khẩu. Cart/wishlist vẫn lưu trên trình duyệt, chưa đồng bộ theo tài khoản. Không tuyên bố đây là backend production: JSON là single-process storage, rate limit nằm trong bộ nhớ; khi triển khai công khai cần HTTPS (cookie Secure bật với NODE_ENV=production), cấu hình origin/domain, vận hành và lưu trữ phù hợp.

## Nguồn kỹ thuật

- [Node.js crypto.scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
