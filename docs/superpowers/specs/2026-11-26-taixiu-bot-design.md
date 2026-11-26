# Design Doc: Bot Tài Xỉu Discord (Lightweight & Full-Featured)

## 1. Mục tiêu, Không làm & Cấm kỵ
- **Mục tiêu:** Xây dựng 1 bot Discord Tài Xỉu gọn nhẹ (1 process Node.js, dùng SQLite tích hợp qua `node:sqlite`), đầy đủ tính năng giải trí cho cộng đồng, tách 3 lớp rõ ràng để AI và dev dễ đọc, test và mở rộng.
- **Không làm (Non-goals):** Không tiền thật/nạp rút, không web dashboard, không sharding đa máy chủ, không gộp mini-game khác trong v1.
- **Cấm kỵ (Anti-goals):**
  - Không để xảy ra lỗi nhân đôi tiền / race condition khi nhiều người bấm cùng lúc.
  - Không làm mất xu người chơi nếu bot bị restart giữa phiên.
  - Không spam kênh chat khi vắng người hoặc edit message vượt rate limit của Discord.

## 2. Luồng chơi & Luật (Thông số mặc định)
- **Vòng đời bàn chơi (`/taixiu`):**
  - Mỗi kênh chỉ có tối đa 1 bàn đang chạy.
  - **35 giây** nhận cược (dùng Discord timestamp `<t:...:R>` để đếm ngược phía client).
  - Hết giờ -> khóa nút -> **2.5 giây** hiệu ứng lắc/mở 3 viên xúc xắc bằng `crypto.randomInt(1, 7)` -> chốt kết quả -> nghỉ **5 giây** rồi tự nối phiên mới.
  - Tự đóng bàn sau **2 phiên liên tiếp không có ai đặt cược**.
- **Luật cược & Hũ Jackpot:**
  - `Tài` (tổng 11–17, không phải bộ ba) & `Xỉu` (tổng 4–10, không phải bộ ba): ăn **1:1** (nhận `2 × tiền cược`, trích **2%** tổng tiền nhận thắng Tài/Xỉu — tức `Math.floor(w * 0.02)` — vào Hũ Jackpot).
  - `Bão` (3 mặt giống nhau: 1-1-1 … 6-6-6): ăn **x24** (nhận `25 × tiền cược`).
  - **Khi nổ Bão:**
    - Có người đặt `Bão`: toàn bộ tiền cược Tài/Xỉu của phiên đó + toàn bộ **Hũ Jackpot** hiện tại được chia cho những người thắng Bão theo tỷ lệ tiền cược Bão (`Math.floor(pool * userBao / totalBao)`). Phần dư chia nguyên giữ lại trong Hũ.
    - Không ai đặt `Bão`: **hoàn 100%** tiền cược Tài/Xỉu (giữ nguyên chuỗi thắng), Hũ giữ nguyên.
- **Quy tắc đặt cược:**
  - Tối thiểu `100 xu`/lần; hỗ trợ nhập `500`, `10k`, `2.5m`, `50%`, `all`.
  - Cho phép đặt cộng dồn nhiều lần cùng cửa và đặt `Bão` kèm `Tài` hoặc `Xỉu`.
  - **Cấm đặt cả `Tài` lẫn `Xỉu` trong cùng 1 phiên** (chống farm chuỗi thắng).
  - Nút **`🔁 Cược lại`**: đặt lại toàn bộ cửa & số xu của phiên gần nhất đã chốt của người chơi đó.
- **Kinh tế & Giải trí (tách riêng theo từng Server):**
  - Vốn khởi đầu: `10,000 xu` khi tương tác lần đầu.
  - `/daily`: `+5,000 xu`, cooldown 24 giờ.
  - `/cuutro`: `+1,500 xu` khi `số dư = 0` và không có cược đang treo ở phiên `OPEN`, cooldown 30 phút.
  - `/chuyen @user <số_xu>`: tối thiểu `100 xu`, thuế `5%` (đổ vào Hũ Jackpot).
  - **Win Streak:** Thắng liên tiếp **3 ván** (`+2,000 xu`), **5 ván** (`+5,000 xu`), **10 ván** (`+20,000 xu`).
  - `/top`: Top 10 giàu nhất & Top 10 chuỗi thắng dài nhất server.
  - `/profile [@user]`: Số dư, tổng ván, tỉ lệ thắng, chuỗi hiện tại/cao nhất, lời/lỗ ròng.
  - **Soi cầu:** Lịch sử 15 phiên gần nhất (`🔴` Tài / `🔵` Xỉu / `🟡` Bão) hiển thị trên bàn cược.
  - **Admin (`ManageGuild`):** `/admin-kenh [kenh]` (khóa kênh chơi hoặc mở lại mọi kênh), `/admin-xu <@user> <so_xu>` (cộng/trừ xu, chặn âm dưới 0).

## 3. Kiến trúc & Lựa chọn kỹ thuật
- **3 lớp tách biệt:**
  1. `src/engine/`: Luật game thuần TypeScript, không import `discord.js` hay DB.
  2. `src/db/`: SQLite dùng `node:sqlite` tích hợp sẵn trong Node.js >= 22.13 (WAL mode, `BEGIN IMMEDIATE` transaction đồng bộ -> không cần compile native C++ addon trên Windows, triệt tiêu race condition).
  3. `src/discord/`: Adapter cho `discord.js` v14 (Slash Commands, Buttons, Modals, Embeds, throttle edit message 1.5s).
- **Chống mất tiền khi restart:** Tiền bị trừ ngay khi đặt cược (`rounds.status = 'OPEN'`). Khi bot khởi động lại, `refundOpenRounds()` tự động hoàn tiền toàn bộ cược của các phiên `OPEN` và chuyển trạng thái thành `CANCELLED`.
- **4 bảng SQLite:** `users`, `guild_settings`, `rounds`, `bets` (khóa theo `guild_id`).
