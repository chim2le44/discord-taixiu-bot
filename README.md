# Bot Tài Xỉu Discord

Bot Tài Xỉu viết bằng TypeScript + `discord.js` v14 + SQLite tích hợp (`node:sqlite`) + `@napi-rs/canvas`, có biểu đồ thống kê 20 phiên, animation lắc bát & mở từng viên xúc xắc, chống race condition bằng SQLite transaction đồng bộ và tự hoàn tiền nếu bot tắt giữa phiên.

## Yêu cầu môi trường
- **Node.js >= 22.13.0** (khuyên dùng bản LTS mới nhất tại https://nodejs.org) — không cần cài C++ Build Tools trên Windows.

## Hướng dẫn cài đặt & chạy (cho người mới)

### 1. Tạo Bot trên Discord Developer Portal
1. Vào https://discord.com/developers/applications → **New Application** → đặt tên bot.
2. Vào mục **Bot** bên trái:
   - Bấm **Reset Token** để lấy `DISCORD_TOKEN` (giữ bí mật tuyệt đối, không chia sẻ cho ai).
   - Cuộn xuống **Privileged Gateway Intents** → bật **MESSAGE CONTENT INTENT** → bấm **Save Changes**.
3. Vào mục **OAuth2 → URL Generator**:
   - Tích chọn `bot` và `applications.commands`.
   - Ở phần quyền bot chọn tối thiểu: `Send Messages`, `Embed Links`, `Attach Files`, `Manage Messages`, `Read Message History`.
   - Copy link mời bot vào server Discord của bạn.

### 2. Cài đặt dự án & cấu hình `.env`
1. Tải mã nguồn về máy, mở Terminal tại thư mục dự án và chạy:
   ```bash
   npm install
   ```
2. Tạo file `.env` từ file mẫu `.env.example`:
   ```env
   DISCORD_TOKEN=dan_token_bot_cua_ban_vao_day
   CLIENT_ID=dan_application_id_cua_ban_vao_day
   DB_PATH=./data/taixiu.sqlite
   ```
   > **Cảnh báo bảo mật:** Không bao giờ đưa file `.env` hay thư mục `data/` lên GitHub (đã được chặn sẵn trong `.gitignore`).

### 3. Đăng ký lệnh Admin & Chạy bot
1. Nhấp đúp chạy `1_dang_ky_lenh.bat` (hoặc `npm run deploy-commands`) để đăng ký 2 lệnh Admin (`/admin-kenh`, `/admin-xu`).
2. Nhấp đúp chạy `2_chay_bot.bat` (hoặc `npm run dev`) để bật bot. Chờ hiện `Ready! Logged in as ...` là chơi được.

## Kiểm tra code (dành cho dev)
```bash
npm run typecheck
npm test
```

## Danh sách lệnh

### Lệnh người chơi (gõ dấu `.` trực tiếp trong kênh)
- `.tx` *(hoặc `.taixiu`)* — Mở bàn Tài Xỉu (35s đặt cược, úp tô lắc, mở từng viên 1–2–3, tự xóa khung cược cũ khi sang phiên mới, giữ lại kết quả).
- `.cau` — Xem biểu đồ thống kê 20 phiên gần nhất.
- `.tanthu` — Nhận quà tân thủ **50,000,000 xu** (mỗi người 1 lần duy nhất).
- `.daily` *(hoặc `.dd`)* — Điểm danh nhận **5,000 xu** mỗi 24h.
- `.cuutro` *(hoặc `.ct`)* — Nhận cứu trợ **1,500 xu** khi số dư về `0 xu` (cooldown 30 phút).
- `.nv` *(hoặc `.nhiemvu`)* — Xem tiến độ và nhận thưởng nhiệm vụ ngày.
- `.vi` *(hoặc `.xu`, `.profile`)* — Xem số dư, tỉ lệ thắng, chuỗi thắng và kỷ lục Thánh Đen (`.vi @tên`).
- `.top` *(hoặc `.bxh`)* — Bảng xếp hạng Top 10 Đại gia, Chuỗi thắng và Thánh Đen.
- `.chuyen @tên <xu>` *(hoặc `.ck`)* — Chuyển xu (thuế 5% góp vào Hũ Jackpot).
- `.lixi <tổng_xu> <số_suất>` — Thả bao lì xì trong kênh cho mọi người giật ngẫu nhiên.
- `.solo @tên <xu>` — Thách đấu tung 3 xúc xắc 1v1 so tổng điểm.
- `.help` *(hoặc `.hd`)* — Xem nhanh danh sách lệnh trong Discord.

### Lệnh Admin (dùng `/` — yêu cầu quyền Manage Server)
- `/admin-kenh [kenh]` — Khóa kênh chơi Tài Xỉu hoặc bỏ trống để mở mọi kênh.
- `/admin-xu <@nguoi_choi> <so_xu>` — Cộng hoặc trừ xu của thành viên.

### Cơ chế nổi bật
- **Phiên Giờ Vàng (15%):** Cửa Tài/Xỉu & Chẵn/Lẻ ăn **x2.1**, góp Hũ **x2 (10%)**.
- **Thánh Đen (chuỗi thua):** Thua 3 ván gắn `🤡x3`, 5 ván gắn `💀x5` + hoàn **15%** tổng xu lỗ (tối đa 15,000 xu), 8 ván gắn `☠️x8` + hoàn **25%** (tối đa 30,000 xu).

---

## Treo bot 24/24 trên VPS hoặc Hosting

Khi chạy trên máy tính cá nhân, tắt máy là bot tắt. Để bot hoạt động 24/24, hãy đưa lên VPS hoặc Hosting đáp ứng **2 điều kiện**:
1. Có **Node.js >= 22.13.0** (vì bot dùng `node:sqlite` tích hợp sẵn).
2. Có **ổ đĩa lưu file cố định** để giữ `data/taixiu.sqlite` (tránh các gói web miễn phí kiểu Render Free vì tự tắt khi không có truy cập web và xóa sạch file SQLite khi khởi động lại).

### Cách 1: Treo trên VPS Linux (Ubuntu / Debian)
1. **Cài Node.js 22 và PM2** *(trình giữ bot chạy ngầm và tự bật lại nếu gặp lỗi)*:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   sudo npm install -g pm2
   ```
2. **Tải mã nguồn & cài thư viện:**
   ```bash
   git clone https://github.com/chim2le44/discord-taixiu-bot.git
   cd discord-taixiu-bot
   npm install
   ```
3. **Tạo file `.env` trên VPS:**
   ```bash
   cp .env.example .env
   nano .env
   ```
   Điền `DISCORD_TOKEN` và `CLIENT_ID` của bạn → bấm `Ctrl + O`, `Enter`, rồi `Ctrl + X` để lưu.
   *(Nếu muốn giữ lại số dư xu đang chơi trên máy cũ, copy file `data/taixiu.sqlite` từ máy bạn vào thư mục `data/` trên VPS.)*
4. **Build, đăng ký lệnh Admin & bật chạy 24/24:**
   ```bash
   npm run build
   npm run deploy-commands
   pm2 start dist/index.js --name taixiu
   pm2 save
   pm2 startup
   ```
   *(Lệnh `pm2 startup` sẽ in ra 1 dòng lệnh bắt đầu bằng `sudo env ...` — copy và chạy dòng đó để VPS tự bật bot lại nếu máy chủ bị khởi động lại.)*
5. **Các lệnh quản lý hay dùng trên VPS:**
   - Xem log bot: `pm2 logs taixiu`
   - Cập nhật code mới từ GitHub: `git pull && npm install && npm run build && pm2 restart taixiu`

### Cách 2: Treo trên Railway hoặc Discord Bot Hosting
1. **Kết nối repo GitHub** (hoặc upload mã nguồn lên host, nhớ chọn runtime **Node.js 22**).
2. **Gắn ổ đĩa lưu bền (Volume)** nếu dùng Railway/PaaS:
   - Mount Volume vào đường dẫn `/app/data`.
3. **Điền biến môi trường (Environment Variables):**
   - `DISCORD_TOKEN`: token bot của bạn
   - `CLIENT_ID`: Application ID của bot
   - `DB_PATH`: `/app/data/taixiu.sqlite` *(với Bot Hosting thông thường giữ `./data/taixiu.sqlite`)*
4. **Cấu hình lệnh Build & Start:**
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start` *(hoặc `node dist/index.js`)*
5. Chạy `npm run deploy-commands` 1 lần ở máy bạn hoặc trên console của host để đăng ký 2 lệnh Admin (`/admin-kenh`, `/admin-xu`).

> **Mẹo bảo vệ dữ liệu:** Thỉnh thoảng sao lưu (tải về) file `data/taixiu.sqlite` để đề phòng sự cố ổ cứng trên server. Không bao giờ đưa `.env` hay `data/` lên GitHub.

