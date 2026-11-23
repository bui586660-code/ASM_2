> **Cập nhật 21/10/2026:** Backend dùng `Backend/db.json` làm nguồn dữ liệu nghiệp vụ duy nhất. `ttech.sqlite` và các file WAL chỉ là dữ liệu cũ để đối chiếu, không được server nạp hoặc ghi. Chuyển khoản MB/VietQR và webhook SePay vẫn mặc định tắt khi chưa cấu hình secret.

# T-TECH

Website thương mại điện tử laptop với danh sách/chi tiết sản phẩm, tìm kiếm, lọc, sắp xếp, giỏ hàng, yêu thích và đăng ký/đăng nhập thực tế. Giữ dữ liệu sản phẩm trong JSON hiện có.

## Cấu trúc

```text
ASM/
├── Backend/
│   ├── db.json          # products, users, sessions, orders, payments, audit
│   ├── server.cjs       # API sản phẩm + authentication
│   ├── json-storage.cjs # JSON read/write queue and file lock
│   ├── migrate-sqlite-to-json.cjs # one-time legacy data import
│   └── orders.cjs       # Quote, tạo đơn, lịch sử
├── frontend/
│   ├── index.html
│   ├── assets/
│   │   ├── css/         # ttech.css, checkout.css
│   │   ├── js/          # ttech.js, auth.js, checkout.js, payments.js
│   │   └── images/
│   ├── tests/
│   └── README.md
├── docs/
│   └── AUTHENTICATION.md
└── README.md
```

## Chạy project

Từ thư mục `ASM` (Node 22+, đã kiểm tra Node 24):

```powershell
node Backend/server.cjs
```

Từ root workspace `D:\JS-NANGCAO` cũng có thể chạy `npm.cmd start`. Backend ở cổng 3000, API sản phẩm giữ nguyên `http://localhost:3000/products`.

Khởi động lại Live Server, web root `ASM/frontend`, port 5501; mở **http://127.0.0.1:5501/**. Cấu hình workspace đã đặt web root để database không được phục vụ như file tĩnh.

Hoặc từ `ASM`, ở terminal khác:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory frontend
```

Mở **http://127.0.0.1:8000/**. Giữ hai server chạy. Dừng JSON Server cũ trước khi chạy backend mới; không chạy JSON Server trực tiếp trên database có tài khoản.

Nếu đây là lần đầu chuyển từ bản SQLite trước đó, chạy một lần khi backend cũ đã dừng:

```powershell
npm.cmd run migrate:sqlite-to-json
```

Lệnh tạo bản sao lưu `db.json.pre-sqlite-to-json-*.bak`, gộp dữ liệu SQLite chưa có vào `db.json`, rồi ghi marker để không nhập lặp.

## Công nghệ

HTML5, Tailwind CDN, CSS, JavaScript thuần; Node.js với module chuẩn HTTP/crypto/fs. Không thêm dependency runtime. Playwright và Node test runner dùng cho kiểm thử. Frontend cần Internet để tải CSS/font từ CDN.

Đăng ký bằng modal hiện có; sau đó đăng nhập bằng tài khoản vừa tạo. Mật khẩu được hash bằng scrypt, phiên lưu cookie HttpOnly. Không có tài khoản/mật khẩu mặc định. Checkout đã tạo đơn thật và lưu lịch sử theo tài khoản; COD/chuyển khoản/QR chưa thu tiền trực tuyến. Xem [hướng dẫn checkout](docs/CHECKOUT.md).

Xem [hướng dẫn frontend](frontend/README.md) và [API, bảo mật, tài khoản thử, kiểm thử authentication](docs/AUTHENTICATION.md).

Xem [chức năng từng file và danh sách file đã dọn](docs/FILE_GUIDE.md).
