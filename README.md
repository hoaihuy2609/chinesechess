# Kỳ Đài — Cờ Tướng & Voice Chat

Web game cờ tướng hai người, có phòng riêng, đồng bộ nước đi theo thời gian thực, đồng hồ 10 phút, chat và voice chat trực tiếp trong trình duyệt.

## Chạy trên máy

Yêu cầu Node.js 20 trở lên.

```powershell
npm start
```

Mở [http://localhost:4173](http://localhost:4173). Một người tạo bàn và gửi mã gồm 5 ký tự cho người còn lại. Có thể mở thêm một cửa sổ ẩn danh để thử hai người trên cùng máy.

## Có gì trong bản này

- Luật đi quân được kiểm tra tại server: Xe, Mã, Tượng qua sông, Sĩ/Tướng trong cung, Pháo, Tốt, lộ Tướng, chiếu và chiếu bí.
- Phòng riêng bằng mã ngắn, tự nhận quân Đỏ/Đen, khán giả có thể vào xem.
- Đồng hồ 10 phút mỗi bên; server là nguồn thời gian chính.
- Chat trong phòng, đề nghị hòa, xin thua và ván mới.
- Voice chat ngang hàng bằng WebRTC, có echo cancellation / noise suppression, bật tắt voice và mute mic.

## Đưa lên mạng

Game cần một tiến trình Node chạy liên tục vì server giữ phòng và chuyển tiếp tín hiệu WebRTC. Khi deploy, đặt biến `PORT` do nền tảng cung cấp và để reverse proxy chuyển WebSocket `/ws` đến tiến trình này.

Voice chat cần HTTPS (localhost được trình duyệt xem là ngoại lệ an toàn). Bản hiện tại dùng STUN công khai để thiết lập kết nối. Để voice ổn định trên 4G, Wi‑Fi công ty hoặc NAT khó, hãy triển khai một TURN server (ví dụ coturn) rồi thay địa chỉ trong `public/app.js` tại `iceServers` bằng STUN/TURN của bạn.

## Cấu trúc

```text
server.mjs          Server HTTP + WebSocket + luật cờ và trạng thái phòng
public/index.html   Giao diện
public/styles.css   Thiết kế responsive
public/app.js       Bàn cờ, kết nối realtime và WebRTC
```
