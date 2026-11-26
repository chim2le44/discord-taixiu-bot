# Context Handoff — Discord Tài Xỉu Bot

Tài liệu này tóm tắt kiến trúc, luật chơi, quyết định kỹ thuật và các lỗi đã xử lý để lập trình viên hoặc AI có thể mở dự án và làm việc tiếp ngay lập tức.

## 1. Môi trường & Công cụ
- **Node.js:** `>=22.13.0` (trên Windows mặc định ở `%LOCALAPPDATA%\Programs\nodejs`; các file `.bat` tự bổ sung vào `PATH`).
- **Stack:** TypeScript 5 (`"type": "module"`, `"moduleResolution": "NodeNext"`), `discord.js` v14, built-in `node:sqlite` (không cần C++ Build Tools trên Windows), `@napi-rs/canvas`, `gifenc`, `vitest`.
- **Launcher cho người dùng:**
  - `1_dang_ky_lenh.bat`: Chạy `npm run deploy-commands` (chỉ cần chạy lại khi thêm/sửa tên/tham số Slash Command).
  - `2_chay_bot.bat`: Chạy `npm run dev` (`tsx watch src/index.ts`, tự reload khi sửa code).
- **Lệnh kiểm tra bắt buộc sau mỗi lần sửa:**
  ```bash
  npm run typecheck && npm test
  ```

## 2. Kiến trúc 4 module (tách lớp nghiêm ngặt)
1. **`src/engine/`** — Thuần TypeScript, **không import `discord.js`, `@napi-rs/canvas`, hay `node:sqlite`**:
   - `types.ts`: 26 cửa cược (`TAI`, `XIU`, `CHAN`, `LE`, `SO_1..6`, `TONG_3..18`), `GAME_CONFIG`, `UserSettlement`, `RoundTotals`.
   - `dice.ts`: `rollDice()` (`crypto.randomInt(1, 7)`), `classifyRoll()`, `getParity()`.
   - `betParser.ts`: Parse mệnh giá `500`, `10k`, `1.5m`, `50%`, `all`.
   - `settlement.ts`: `evaluateBetPayout()`, `settleRound()`.
   - `tableManager.ts`: Vòng đời bàn theo từng kênh (`BETTING` 35s -> `renderShaking` 1.8s -> `renderDieStep(1)` 1.2s -> `renderDieStep(2)` 1.2s -> `settleAndRenderResult` -> nghỉ 5s nối phiên, tự đóng sau 2 phiên trống).
   - `lixi.ts`, `quests.ts`: Logic lì xì ngẫu nhiên & nhiệm vụ ngày (reset 00:00 UTC+7).
2. **`src/graphics/`** — Render ảnh PNG/GIF, **không import `discord.js` hay `node:sqlite`**:
   - `tokens.ts`: Bảng màu Dark Mode Discord (`#1E1F22`, `#26272D`, vàng `#F5C542`, đỏ cho chấm 1 & 4).
   - `statsChart.ts`: `renderStatsChartPng()` — biểu đồ thống kê 20 phiên (tổng điểm 3–18 + 3 đường Xí Ngầu 1/2/3 + tỉ lệ % + cầu bệt).
   - `diceVisuals.ts`: `getBowlShakeGif()` (cache 1 lần trong RAM), `renderDiceRevealPng()`, `renderSoloComparisonPng()`.
3. **`src/db/`** — SQLite đồng bộ (`WAL` + `BEGIN IMMEDIATE`), **không import `discord.js`**:
   - `database.ts`: `openDatabase()`, `withTransaction()`, 7 bảng (`users`, `guild_settings`, `rounds`, `bets`, `daily_quests`, `lixi_packets`, `lixi_claims`).
   - `repository.ts`: Toàn bộ thao tác xu nằm trong `withTransaction()`, chặn cược 2 đầu (`TAI`+`XIU` và `CHAN`+`LE`), tự hoàn tiền các phiên `OPEN` (`refundOpenRounds()`) và hoàn lì xì quá hạn (`expireLixiPackets()`) khi bot khởi động lại.
4. **`src/discord/`** & Entrypoints (`src/index.ts`, `src/registerCommands.ts`):
   - `embeds.ts`: Bàn cược 3 thẻ xếp gọn (`buildBettingEmbeds`), 4 nút (`🔴 Tài`, `🔵 Xỉu`, `🔁 Cược lại`, `📊 Soi cầu` — đã bỏ nút Bão), 1 dropdown 4 lựa chọn (`Chẵn`, `Lẻ`, `Cược Số 1–6`, `Cược Tổng 3–18`), hộp thoại 2 ô (`buildNumberOrSumBetModal`) cho Số/Tổng, kết quả 3 thẻ tách rõ `🏆 THẮNG` / `💀 THUA` + số dư ví.
   - `interactions.ts`: Throttle edit message 1.5s khi đặt cược, xử lý Button/SelectMenu/Modal (`tx_modal` và `tx_modal_pick`).
   - `commands.ts`: 12 Slash Commands (`/taixiu`, `/cau`, `/daily`, `/cuutro`, `/nhiemvu`, `/lixi`, `/solo`, `/profile`, `/top`, `/chuyen`, `/admin-kenh`, `/admin-xu`).

## 3. Luật cược & Tỉ lệ hiện tại (`GAME_CONFIG`)
- **Tài (11–17) / Xỉu (4–10) / Chẵn / Lẻ:** `x1.9` (tính theo tổng 3 xúc xắc, kể cả bộ ba).
- **Cược Số (`1–6`):** xuất hiện 1/2/3 viên nhận `x1.9` / `x2.8` / `x3.6`.
- **Cược Tổng (`3–18`):** `9–12` ăn `x4.5`; `3 & 18` ăn `x10.8`; các tổng còn lại ăn `x6.2`.
- **Hũ Jackpot:** Trích `5%` tổng cược mỗi phiên thường vào Hũ. Khi về bộ ba, Hũ chia theo tỉ lệ cho các người thắng có cược hợp lệ từ `100 xu` trở lên.
- **Chuỗi thắng (Win Streak):** Tính khi tổng nhận trước thưởng chuỗi > tổng cược phiên; mốc 3/5/10 ván thưởng `+2,000` / `+5,000` / `+20,000 xu`.

## 4. Các lỗi đã xử lý (để không lặp lại)
1. **Modal `ExpectedConstraintError <= 45`:** Không được nhét số dư ví (`999,999,999,999 xu`) vào `TextInputBuilder.setLabel(...)`. Giữ `setLabel` cố định ngắn gọn (`"Số xu muốn cược"`), đưa số dư xuống `setPlaceholder(...)` và dùng `truncateText(..., 45)` cho Modal title.
2. **`gifenc` trong Node ESM + Vitest:** Import qua `createRequire(import.meta.url)` trong `src/graphics/diceVisuals.ts` thay vì default ESM import để chạy đồng nhất trên cả `vitest`, `tsx` và `node`.
3. **Edit message thay ảnh trên Discord:** Luôn truyền `attachments: []` cùng `files: [...]` (hoặc `files: [], attachments: []`) khi chuyển pha `BETTING` ↔ `SHAKING` ↔ `REVEAL` ↔ `RESULT` để không bị dính ảnh cũ.
