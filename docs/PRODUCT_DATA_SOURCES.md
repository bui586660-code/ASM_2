# Nguồn thông số và ảnh sản phẩm T-TECH

## Bổ sung trang chi tiết — 2026-10-10

- Đã đối chiếu lại các trang sản phẩm bên dưới và bổ sung thông số đầy đủ cho **36/39 bản ghi**. Mỗi máy có 10–29 dòng tùy dữ liệu nhà bán cung cấp; Lenovo LOQ 83S0007AVN có 27 dòng.
- Nguồn CellphoneS: `productData.specification.basic` và `full_by_group` của chính sản phẩm, loại bỏ dòng trùng khóa. Nguồn Dell DA15265: bảng thông số của trang TT Center đúng cấu hình Ryzen 5 220 / 16GB / 512GB / RTX 4050. Không suy diễn thông số thiếu, không sao chép nội dung quảng cáo thành thông số.
- Đã xem danh sách ảnh của từng mã và chọn **127 ảnh bổ sung**, gồm các góc máy, mặt lưng, bàn phím và cạnh kết nối. Bỏ các banner khuyến mãi. MacBook dùng ảnh bàn phím/cổng kết nối có trên trang đúng cấu hình; không khẳng định màu máy khi dữ liệu T-TECH chưa quy định màu.
- Manifest [PRODUCT_DETAIL_DATA.json](PRODUCT_DETAIL_DATA.json) ghi ID, tên nguồn, URL nguồn, thông số, đường dẫn từng ảnh, chỉ số ảnh trong gallery nguồn và SHA-256. ID 21/22 và 37/38 tiếp tục dùng chung ảnh.
- Database đang hoạt động là **`Backend/ttech.sqlite`**, API vẫn là `/products`. Chỉ thêm `specifications: [{label, value}]` và `images: [path]` vào sản phẩm. Các trường cũ (kể cả 5 thông số tóm tắt dùng cho card/filter), giá, tồn kho, ID, thứ tự và các collection khác giữ nguyên. `db.json` là nguồn migration cũ, không sửa trong đợt này.
- Snapshot sản phẩm trước cập nhật: `Backend/products.pre-detail-20261010.bak`. Đây chỉ là bản sao sản phẩm, không chứa tài khoản hay đơn hàng. Không dùng nó ghi đè toàn bộ database.
- ID **32, 33, 34** giữ nguyên do chưa có mã cấu hình/link TT Center đủ chính xác. Không lấy cấu hình Alienware khác để điền thay.
- Frontend đọc dữ liệu mới trong bảng/gallery hiện có. Giữ nguyên HTML trang, CSS, bố cục, khối tóm tắt mua hàng và ảnh chính. Gallery giữ ảnh bảng cấu hình ở cuối; máy chưa có dữ liệu mới vẫn hiển thị 5 dòng và gallery cũ.
- Kiểm tra: API trả 39 sản phẩm, 127 ảnh mới giải mã thành công và có chiều rộng ít nhất 500px; trang chi tiết có 27 dòng cho ID 3; không lỗi JavaScript và không tràn trang ở 1440/1024/768/390/360px. Hai test `product-detail.cjs` và `product-specifications.cjs` đạt, gồm gallery, bàn phím, reduced motion, giỏ hàng, yêu thích, tìm kiếm, fallback và escaping dữ liệu.

Phần bên dưới là nhật ký lần nhập dữ liệu ban đầu, không phải mô tả backend hiện tại.

Đối chiếu ngày 2026-09-29. Cập nhật 36/39 bản ghi, 34 ảnh sản phẩm (hai cặp bản ghi trùng mẫu dùng chung ảnh).

## Phạm vi

- Chỉ sửa `brand`, `cpu`, `gpu`, `ram`, `ssd`, `screen`, `image` của các mã đã đối chiếu. Giữ nguyên ID, tên, giá, giá giảm, category, hot, demo và thứ tự sản phẩm.
- Nguồn thông số: bảng kỹ thuật/structured data của trang đúng mã trên CellphoneS; Dell DA15265 dùng TTCenter. Không lấy giá của nhà bán để ghi đè giá T-TECH.
- Ảnh CellphoneS lấy từ ảnh catalog gắn với biến thể sản phẩm trên chính trang chi tiết; tải kích thước 800px từ CDN của website. Ảnh Dell lấy từ Product schema TTCenter. Không dùng ảnh kết quả tìm kiếm hay ảnh dòng máy gần giống.
- MacBook được đối chiếu theo tên đầy đủ, đời chip, kích thước, số nhân CPU/GPU, RAM, SSD và tùy chọn sạc. Database không quy định màu; ảnh giữ màu biến thể mặc định của trang nguồn, không khẳng định mã màu/SKU bán lẻ chưa được cung cấp.
- Thông số được rút gọn để phù hợp các trường hiện tại. Không tự bổ sung tần số quét MacBook khi nguồn chưa ghi.

## Các trường hợp cần chú ý

- ID 2 (83DV003CVN): nguồn khớp mã hiện tìm thấy là trang “Cũ Trầy Xước”. Chỉ tham chiếu cấu hình và ảnh catalog đúng mã; không suy luận hay đổi tình trạng sản phẩm T-TECH.
- ID 21/22 và 37/38 trùng tên/mẫu: giữ cả hai ID, dùng chung ảnh; không xóa bản ghi.
- ID 32, 33, 34: chưa có mã/cấu hình cụ thể nên giữ nguyên toàn bộ bản ghi, kể cả ảnh và thông số cũ. **Các thông số/brand cũ ở ba bản ghi này chưa được xác minh và không nên coi là thông số chính xác của Alienware.** Cần link TTCenter đúng cấu hình CPU/GPU/RAM/SSD trước khi cập nhật.

| ID chờ | Sản phẩm | Thông tin còn thiếu |
|---|---|---|
|32|Dell Alienware 16 Area-51 2025|Mã cấu hình hoặc link TTCenter cụ thể|
|33|Dell Alienware M16 R2 (2024)|Mã cấu hình hoặc link TTCenter cụ thể|
|34|Dell Alienware 16 Aurora (2025)|Mã cấu hình hoặc link TTCenter cụ thể|

## Đối chiếu từng bản ghi

### ID 1 — Laptop Lenovo LOQ 15ARP10E 83S000DEVN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-loq-15arp10e-83s000devn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_13__1_13.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-loq-15arp10e-83s000devn.png`
- CPU: AMD Ryzen 7 170; GPU: NVIDIA GeForce RTX 3050 6GB GDDR6; RAM: 16GB DDR5-4800; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 2 — Laptop Lenovo Gaming LOQ 15IRX9 - 83DV003CVN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-loq-15irx9-83dv003cvn-cu-tray-xuoc.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/l/a/laptop-lenovo-loq-15irx9-83dv003cvn.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-loq-15irx9-83dv003cvn.png`
- CPU: Intel Core i5-13450HX; GPU: NVIDIA GeForce RTX 3050 6GB; RAM: 16GB DDR5 4800; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · 144Hz.

### ID 3 — Laptop Lenovo LOQ 15ARP10E 83S0007AVN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-loq-15arp10e-83s0007avn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_13__9.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-loq-15arp10e-83s0007avn.png`
- CPU: AMD Ryzen 7 7735HS; GPU: NVIDIA GeForce RTX 3050 6GB GDDR6; RAM: 16GB DDR5-4800; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 4 — Laptop Lenovo LOQ Essential 15ARP10E 83S0000DVN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-loq-essential-15arp10e-83s0000dvn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/sssxs_13__3.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-loq-essential-15arp10e-83s0000dvn.png`
- CPU: AMD Ryzen 5 7535HS; GPU: NVIDIA GeForce RTX 3050 6GB GDDR6; RAM: 16GB DDR5-4800; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 5 — Laptop Lenovo LOQ 15AHP11 83TN0040VN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-loq-15ahp11-83tn0040vn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_2__1_105.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-loq-15ahp11-83tn0040vn.png`
- CPU: AMD Ryzen 7 250; GPU: NVIDIA GeForce RTX 5050 8GB GDDR7; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 15.3″ · 1920 x 1200 (WUXGA) · IPS · 165Hz.

### ID 6 — Laptop Lenovo LOQ 15IPH11 83SL000LVN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-loq-15iph11-83sl000lvn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_14__4.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-loq-15iph11-83sl000lvn.png`
- CPU: Intel Core Ultra 7 356H; GPU: NVIDIA GeForce RTX 5060 8GB GDDR7; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 15.3″ · 1920 x 1200 (WUXGA) · IPS · 165Hz.

### ID 7 — Laptop Lenovo Legion 7 16IAX10 83KY001UVN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-legion-7-16iax10-83ky001uvn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/t/e/text_ng_n_3__8_98.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-legion-7-16iax10-83ky001uvn.png`
- CPU: Intel Core Ultra 9 275HX; GPU: NVIDIA GeForce RTX 5060 8GB GDDR7; RAM: 32GB DDR5-5600; SSD: 1TB SSD.
- Màn hình: 16″ · 2560 x 1600 (WQXGA) · OLED · 240Hz.

### ID 8 — Laptop Lenovo Legion 5 15AHP11 83Q7001JVN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-legion-5-15ahp11-83q7001jvn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_2__1_118.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-legion-5-15ahp11-83q7001jvn.png`
- CPU: AMD Ryzen 7 250; GPU: NVIDIA GeForce RTX 5060 8GB GDDR7; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 15.1″ · 2560 x 1600 (WQXGA) · OLED · 165Hz.

### ID 9 — Laptop Lenovo Legion 5 15IPH11 83RW0023VN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-legion-5-15iph11-83rw0023vn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/sssxs_6__23.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-legion-5-15iph11-83rw0023vn.png`
- CPU: Intel Core Ultra 7 356H; GPU: NVIDIA GeForce RTX 5060 8GB GDDR7; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 15.3″ · 2560 x 1600 (WQXGA) · OLED · 165Hz.

### ID 10 — Laptop Lenovo Legion 5 15IAX11 83VK00A2VN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-lenovo-legion-5-15iax11-83vk00a2vn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_1__1_165.png)
- Ảnh local: `frontend/assets/images/laptop-lenovo-legion-5-15iax11-83vk00a2vn.png`
- CPU: Intel Core Ultra 7 251HX; GPU: NVIDIA GeForce RTX 5060 8GB GDDR7; RAM: 24GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 15.3″ · 2560 x 1600 (WQXGA) · OLED · 165Hz.

### ID 11 — Laptop ASUS ROG Strix G16 G614PH-S5101W

- [Trang sản phẩm](https://cellphones.com.vn/laptop-asus-rog-strix-g16-g614ph-s5101w.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_2__73.png)
- Ảnh local: `frontend/assets/images/laptop-asus-rog-strix-g16-g614ph-s5101w.png`
- CPU: AMD Ryzen 9 8940HX; GPU: NVIDIA GeForce RTX 5050 8GB GDDR7; RAM: 16GB DDR5-5200; SSD: 512GB SSD.
- Màn hình: 16″ · 2560 x 1600 (WQXGA) · IPS · 240Hz.

### ID 12 — Laptop ASUS ROG Zephyrus G16 GU606AW-TB121W

- [Trang sản phẩm](https://cellphones.com.vn/laptop-asus-rog-zephyrus-g16-gu606aw-tb121w.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_2_144.png)
- Ảnh local: `frontend/assets/images/laptop-asus-rog-zephyrus-g16-gu606aw-tb121w.png`
- CPU: Intel Core Ultra 9 386H; GPU: NVIDIA GeForce RTX 5080 16GB GDDR7; RAM: 32GB LPDDR5X 8533; SSD: 1TB SSD.
- Màn hình: 16″ · 2560 x 1600 (2.5K) · OLED · 240Hz.

### ID 13 — Laptop ASUS ROG Zephyrus G14 GU405AW-SY029W

- [Trang sản phẩm](https://cellphones.com.vn/laptop-asus-rog-zephyrus-g14-gu405aw-sy029w.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_3__36.png)
- Ảnh local: `frontend/assets/images/laptop-asus-rog-zephyrus-g14-gu405aw-sy029w.png`
- CPU: Intel Core Ultra 9 386H; GPU: NVIDIA GeForce RTX 5080 16GB GDDR7; RAM: 32GB LPDDR5X 8533; SSD: 1TB SSD.
- Màn hình: 14″ · 2880 x 1800 · OLED · 120Hz.

### ID 14 — Laptop ASUS TUF Gaming A15 FA506NCG-HN329W

- [Trang sản phẩm](https://cellphones.com.vn/laptop-asus-tuf-gaming-a15-fa506ncg-hn329w.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/sssxs_70.png)
- Ảnh local: `frontend/assets/images/laptop-asus-tuf-gaming-a15-fa506ncg-hn329w.png`
- CPU: AMD Ryzen 7 8845HS; GPU: NVIDIA GeForce RTX 3050 4GB GDDR6; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 15 — Laptop ASUS TUF Gaming A15 FA506NCG-HN390W

- [Trang sản phẩm](https://cellphones.com.vn/laptop-asus-tuf-gaming-a15-fa506ncg-hn390w.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_2_177.png)
- Ảnh local: `frontend/assets/images/laptop-asus-tuf-gaming-a15-fa506ncg-hn390w.png`
- CPU: AMD Ryzen 7 155; GPU: NVIDIA GeForce RTX 3050 4GB GDDR6; RAM: 16GB DDR5-4800; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 16 — Laptop ASUS TUF Gaming F16 FX608JHI-TU209W

- [Trang sản phẩm](https://cellphones.com.vn/laptop-asus-tuf-gaming-f16-fx608jhi-tu209w.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_1__1_127.png)
- Ảnh local: `frontend/assets/images/laptop-asus-tuf-gaming-f16-fx608jhi-tu209w.png`
- CPU: Intel Core i7 14650HX; GPU: NVIDIA GeForce RTX 5050 8GB GDDR7; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 16″ · 1920 x 1200 (WUXGA) · IPS · 144Hz.

### ID 17 — Laptop MSI Cyborg 15 A13UC-2082VN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-msi-cyborg-15-a13uc-2082vn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/t/e/text_ng_n_3__9_27.png)
- Ảnh local: `frontend/assets/images/laptop-msi-cyborg-15-a13uc-2082vn.png`
- CPU: Intel Core i7-13620H; GPU: NVIDIA GeForce RTX 3050 4GB; RAM: 16GB DDR5 5600; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 18 — Laptop MSI Katana 15 B13VEK-2440VN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-msi-katana-15-b13vek-2440vn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/sssxs_2.png)
- Ảnh local: `frontend/assets/images/laptop-msi-katana-15-b13vek-2440vn.png`
- CPU: Intel Core i7-13620H; GPU: NVIDIA GeForce RTX 4050 6GB GDDR6; RAM: 16GB DDR5 5200MHz; SSD: 1TB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 19 — Laptop MSI Stealth 16 AI+ B3WG-008VN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-msi-stealth-16-ai-b3wg-008vn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_2_140.png)
- Ảnh local: `frontend/assets/images/laptop-msi-stealth-16-ai-b3wg-008vn.png`
- CPU: Intel Core Ultra 9 386H; GPU: NVIDIA GeForce RTX 5070 8GB GDDR7; RAM: 32GB DDR5-7200; SSD: 1TB SSD.
- Màn hình: 16″ · 2560 x 1600 (QHD+) · OLED · 240Hz.

### ID 20 — Laptop MSI Cyborg 15 A13UC-2088VN

- [Trang sản phẩm](https://cellphones.com.vn/laptop-msi-cyborg-15-a13uc-2088vn.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_1_31.png)
- Ảnh local: `frontend/assets/images/laptop-msi-cyborg-15-a13uc-2088vn.png`
- CPU: Intel Core i5-13420H; GPU: NVIDIA GeForce RTX 3050 4GB; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 21 — Laptop Acer Gaming Nitro ProPanel ANV15-52-50VA

- [Trang sản phẩm](https://cellphones.com.vn/laptop-acer-gaming-nitro-v-15-propanel-anv15-52-50va.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_2_31.png)
- Ảnh local: `frontend/assets/images/laptop-acer-gaming-nitro-v-15-propanel-anv15-52-50va.png`
- CPU: Intel Core 5 210H; GPU: NVIDIA GeForce RTX 3050 6GB GDDR6; RAM: 16GB DDR5 5200; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 180Hz.

### ID 22 — Laptop Acer Gaming Nitro ProPanel ANV15-52-50VA

- [Trang sản phẩm](https://cellphones.com.vn/laptop-acer-gaming-nitro-v-15-propanel-anv15-52-50va.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_2_31.png)
- Ảnh local: `frontend/assets/images/laptop-acer-gaming-nitro-v-15-propanel-anv15-52-50va.png`
- CPU: Intel Core 5 210H; GPU: NVIDIA GeForce RTX 3050 6GB GDDR6; RAM: 16GB DDR5 5200; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 180Hz.

### ID 23 — Laptop Acer Gaming Aspire 7 A715-59G-59RD

- [Trang sản phẩm](https://cellphones.com.vn/laptop-acer-gaming-aspire-7-a715-59g-59rd.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_3__89.png)
- Ảnh local: `frontend/assets/images/laptop-acer-gaming-aspire-7-a715-59g-59rd.png`
- CPU: Intel Core 5 210H; GPU: NVIDIA GeForce RTX 3050 4GB GDDR6; RAM: 16GB DDR4 3200; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 24 — Laptop Acer Predator Helios Neo 16S PHN16S-I51-98CX

- [Trang sản phẩm](https://cellphones.com.vn/laptop-acer-predator-helios-neo-16s-phn16s-i51-98cx.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/_/x_m_2_39.png)
- Ảnh local: `frontend/assets/images/laptop-acer-predator-helios-neo-16s-phn16s-i51-98cx.png`
- CPU: Intel Core Ultra 9 386H; GPU: NVIDIA GeForce RTX 5060 8GB GDDR7; RAM: 16GB DDR5 6400; SSD: 512GB SSD.
- Màn hình: 16″ · 2560 x 1600 (2K) · OLED · 165Hz.

### ID 25 — Laptop Acer Gaming Predator Helios Neo 16S AI PHN16S-71-95MS

- [Trang sản phẩm](https://cellphones.com.vn/laptop-acer-gaming-predator-helios-neo-16s-ai-phn16s-71-95ms.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/t/e/text_ng_n_8__5_9.png)
- Ảnh local: `frontend/assets/images/laptop-acer-gaming-predator-helios-neo-16s-ai-phn16s-71-95ms.png`
- CPU: Intel Core Ultra 9 275HX; GPU: NVIDIA GeForce RTX 5070 Ti 12GB GDDR7; RAM: 64GB DDR5; SSD: 2TB SSD.
- Màn hình: 16″ · 2560 x 1600 (2K) · OLED · 240Hz.

### ID 26 — Laptop HP Victus 15-FA2731TX B85LNPA

- [Trang sản phẩm](https://cellphones.com.vn/laptop-hp-victus-15-fa2731tx-b85lnpa.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/t/e/text_ng_n_6__5_19.png)
- Ảnh local: `frontend/assets/images/laptop-hp-victus-15-fa2731tx-b85lnpa.png`
- CPU: Intel Core i5-13420H; GPU: NVIDIA GeForce RTX 3050 6GB GDDR6; RAM: 16GB DDR4 3200MHz; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 27 — Laptop HP Victus 15-FA2451TX D17WPPA

- [Trang sản phẩm](https://cellphones.com.vn/laptop-hp-victus-15-fa2451tx-d17wppa.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/s/s/ssss_2_117.png)
- Ảnh local: `frontend/assets/images/laptop-hp-victus-15-fa2451tx-d17wppa.png`
- CPU: Intel Core i5-13420H; GPU: NVIDIA GeForce RTX 4050 6GB GDDR6; RAM: 16GB DDR5 5200MHz; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 28 — Laptop HP Victus 15-FB3116AX BX8U4PA

- [Trang sản phẩm](https://cellphones.com.vn/laptop-hp-victus-15-fb3116ax-bx8u4pa.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/t/e/text_ng_n_2__10_28.png)
- Ảnh local: `frontend/assets/images/laptop-hp-victus-15-fb3116ax-bx8u4pa.png`
- CPU: AMD Ryzen 7 7445HS; GPU: NVIDIA GeForce RTX 3050 6GB GDDR6; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 15.6″ · 1920 x 1080 (FullHD) · IPS · 144Hz.

### ID 29 — Laptop HP Gaming OMEN 16-AM0176TX BX9D3PA

- [Trang sản phẩm](https://cellphones.com.vn/laptop-hp-gaming-omen-16-am0176tx-bx9d3pa.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/t/e/text_ng_n_10__5_213.png)
- Ảnh local: `frontend/assets/images/laptop-hp-gaming-omen-16-am0176tx-bx9d3pa.png`
- CPU: Intel Core Ultra 7 255H; GPU: NVIDIA GeForce RTX 5060 8GB GDDR7; RAM: 16GB DDR5-5600; SSD: 512GB SSD.
- Màn hình: 16″ · 1920 x 1200 (WUXGA) · IPS · 165Hz.

### ID 30 — Laptop HP Victus 16-R0376TX AY8Z2PA

- [Trang sản phẩm](https://cellphones.com.vn/laptop-hp-victus-16-r0376tx-ay8z2pa.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/t/e/text_ng_n_5__8_105.png)
- Ảnh local: `frontend/assets/images/laptop-hp-victus-16-r0376tx-ay8z2pa.png`
- CPU: Intel Core i7-13700HX; GPU: NVIDIA GeForce RTX 3050 6GB GDDR6; RAM: 16GB DDR5-4800; SSD: 512GB SSD.
- Màn hình: 16.1″ · 1920 x 1080 (FullHD) · IPS · 165Hz.

### ID 31 — Dell Alienware 15 DA15265 | Ryzen 5 220 16GB 512GB RTX 4050 15.3'' WUXGA

- [Trang sản phẩm](https://ttcenter.com.vn/dell-alienware-15-da15265-ryzen-5-220)
- [Ảnh nguồn](https://ttcenter.com.vn/uploads/product/0upkzlgm-3456-dell-alienware-15-da15265-ryzen-5-220-16gb-512gb-rtx-4050-15-3-wuxga-new.jpg)
- Ảnh local: `frontend/assets/images/dell-alienware-15-da15265-ryzen-5-220.jpg`
- CPU: AMD Ryzen 5 220; GPU: NVIDIA GeForce RTX 4050 6GB GDDR6; RAM: 16GB DDR5; SSD: 512GB SSD M.2 PCIe NVMe Gen 4.
- Màn hình: 15.3" WUXGA 1920 x 1200, 165Hz, 300 nits, 62.5% sRGB.

### ID 35 — MacBook Air M5 13 inch 2026 10CPU 8GPU 16GB 512GB

- [Trang sản phẩm](https://cellphones.com.vn/macbook-air-13-m5-10-cpu-8-gpu-16gb-512gb.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/x/a/xanh_5_10.png)
- Ảnh local: `frontend/assets/images/macbook-air-13-m5-10-cpu-8-gpu-16gb-512gb.png`
- CPU: Apple M5 · CPU 10 lõi; GPU: GPU 8 lõi; RAM: 16GB; SSD: 512GB SSD.
- Màn hình: 13.6″ · 2560 x 1664 · Liquid Retina.

### ID 36 — MacBook Air M4 13 inch 2025 10CPU 8GPU 16GB 256GB

- [Trang sản phẩm](https://cellphones.com.vn/apple-macbook-air-13-m4-10cpu-8gpu-16gb-256gb-2025.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/t/e/text_ng_n_15__7_163.png)
- Ảnh local: `frontend/assets/images/apple-macbook-air-13-m4-10cpu-8gpu-16gb-256gb-2025.png`
- CPU: Apple M4 · CPU 10 lõi; GPU: GPU 8 lõi; RAM: 16GB; SSD: 256GB SSD.
- Màn hình: 13.6″ · 2560 x 1664 · Liquid Retina.

### ID 37 — MacBook Air M5 13 inch 2026 10CPU 8GPU 16GB 512GB Sạc 70W

- [Trang sản phẩm](https://cellphones.com.vn/macbook-air-13-inch-m5-10-cpu-8-gpu-16gb-512gb-2026-sac-70w.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/_/n/_nh_sao_1__3.png)
- Ảnh local: `frontend/assets/images/macbook-air-13-inch-m5-10-cpu-8-gpu-16gb-512gb-2026-sac-70w.png`
- CPU: Apple M5 · CPU 10 lõi; GPU: GPU 8 lõi; RAM: 16GB; SSD: 512GB SSD.
- Màn hình: 13.6″ · 2560 x 1664 · Liquid Retina.

### ID 38 — MacBook Air M5 13 inch 2026 10CPU 8GPU 16GB 512GB Sạc 70W

- [Trang sản phẩm](https://cellphones.com.vn/macbook-air-13-inch-m5-10-cpu-8-gpu-16gb-512gb-2026-sac-70w.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/_/n/_nh_sao_1__3.png)
- Ảnh local: `frontend/assets/images/macbook-air-13-inch-m5-10-cpu-8-gpu-16gb-512gb-2026-sac-70w.png`
- CPU: Apple M5 · CPU 10 lõi; GPU: GPU 8 lõi; RAM: 16GB; SSD: 512GB SSD.
- Màn hình: 13.6″ · 2560 x 1664 · Liquid Retina.

### ID 39 — Apple MacBook Air M2 2024 8CPU 10GPU 16GB 512GB

- [Trang sản phẩm](https://cellphones.com.vn/macbook-air-m2-2022-16gb-512gb.html)
- [Ảnh nguồn](https://cdn2.cellphones.com.vn/800x/media/catalog/product/m/a/macbook_air_m2_1_1_1_4.jpg)
- Ảnh local: `frontend/assets/images/macbook-air-m2-2022-16gb-512gb.jpg`
- CPU: Apple M2 · CPU 8 lõi; GPU: GPU 10 lõi; RAM: 16GB; SSD: 512GB SSD.
- Màn hình: 13.6″ · 2560 x 1664 · Liquid Retina.

## Kiểm tra sau cập nhật

- JSON hợp lệ, giữ đủ 39 bản ghi và thứ tự ID.
- Đối chiếu snapshot: các trường ngoài phạm vi và toàn bộ ảnh có sẵn giữ nguyên; ID 32–34 không thay đổi.
- API http://localhost:3000/products trả dữ liệu mới; JSON Server chuẩn hóa ID số thành chuỗi trong response, frontend hiện tại đã hỗ trợ.
- Chromium: 39 card render, 34 ảnh mới tải thành công và giải mã được; không phát sinh lỗi JavaScript runtime trong luồng kiểm tra.
- Đã kiểm tra tìm kiếm mã 83S000DEVN, thông số Ryzen 7 170, chi tiết Dell DA15265, thêm giỏ và viewport mobile 390px không tràn ngang.
- Không thay đổi mã frontend/backend, endpoint hoặc logic giỏ hàng.
