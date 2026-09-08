# AI Autofill Studio

Extension Chrome (MV3) tự điền dữ liệu vào **bất kỳ form nào trên bất kỳ trang web nào**, bằng AI. Bên trong là một **locator engine kiểu Playwright** và một **overlay/inspector kiểu Chrome DevTools**.

---

## Cài trong 2 phút

1. Mở `chrome://extensions` → bật **Developer mode**
2. **Load unpacked** → chọn thư mục `ai-autofill/`
3. Bấm icon extension → mở **Side panel**
4. Vào ⚙ **Cài đặt** → chọn provider → dán API key → **Test kết nối**
5. Mở `testpage/index.html` để thử ngay

Phím tắt: `Alt+Shift+F` chạy autofill · `Alt+Shift+P` bật element picker.

---

## Kết nối AI — 5 đường

| Provider | Cách xác thực | Ghi chú |
|---|---|---|
| **Google Gemini** | API key hoặc **OAuth chính chủ** | OAuth đi qua Vertex AI, cần Client ID + Project ID |
| **Anthropic Claude** | API key | Gửi kèm header `anthropic-dangerous-direct-browser-access` |
| **OpenAI-compatible** | API key | OpenAI, OpenRouter, DeepSeek, Groq, LM Studio, vLLM, gateway nội bộ |
| **Chrome Built-in AI** | Không cần gì | Gemini Nano chạy **offline** trên máy, miễn phí, Chrome 138+ |
| **Local Bridge** | Không cần key | Gọi lại CLI bạn đã đăng nhập sẵn: Claude Code, Gemini CLI, Kiro/Amazon Q, Ollama |

### Vì sao không dùng lại cookie của claude.ai / gemini.google.com

Bạn có hỏi về hướng này. Nó vi phạm ToS của cả hai bên, có thể làm khoá tài khoản, và sẽ vỡ mỗi lần họ đổi endpoint nội bộ — nên tôi không viết. Hai đường thay thế đạt đúng mục tiêu "không tốn thêm tiền" mà vẫn hợp lệ:

- **Chrome Built-in AI** — model chạy ngay trên máy, không gửi nội dung trang ra ngoài, không tốn đồng nào.
- **Local Bridge** — extension gọi `http://127.0.0.1:8765`, server Node đó gọi lại `claude` / `gemini` / `q` CLI mà **bạn đã đăng nhập bằng tài khoản của chính bạn**. Cùng một subscription, đúng kênh chính thức.

### Chạy Local Bridge

```bash
node bridge/server.mjs
# hoặc: AF_PORT=8765 AF_TOKEN=bimat node bridge/server.mjs
```

Server tự dò backend có sẵn. Trong Cài đặt, ô **Backend** nhận: `claude`, `gemini`, `kiro`, `ollama:qwen2.5:7b`, hoặc `default` (tự chọn). Muốn lệnh riêng: `AF_CMD="lệnh của bạn" node bridge/server.mjs`.

### OAuth Google (nếu muốn)

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID** → loại *Web application*
2. Redirect URI: lấy chuỗi hiện trong trang Cài đặt (dạng `https://<extension-id>.chromiumapp.org/oauth2`)
3. Bật **Vertex AI API** cho project
4. Điền Client ID + Project ID → **Đăng nhập Google**

---

## Các ca khó đã xử lý

Đây là phần bạn hỏi kỹ nhất, nên liệt kê cụ thể:

**Angular mới nhất (signals, zoneless), MFE, Nx**
`setNativeValue` dùng prototype setter nên Angular không ghi đè ngược; chuỗi event đầy đủ `beforeinput → input → change → blur → focusout` để reactive forms cập nhật cả `value` lẫn `touched`. Nhiều app Angular trên cùng trang (module federation) đều được quét vì scanner đi qua **mọi shadow root và mọi iframe cùng origin**, mỗi frame chạy content script riêng và service worker gộp kết quả lại.

**Dropdown custom** — `mat-select`, `p-dropdown`, `nz-select`, `ng-select`, `MuiAutocomplete`, hoặc bất cứ thứ gì có `role="combobox"`. Engine click mở panel, chờ overlay xuất hiện (`.cdk-overlay-container`, `.ant-select-dropdown`, …), đọc option, khớp mờ có bỏ dấu tiếng Việt ("ha noi" khớp "Hà Nội"), click chọn, rồi Escape đóng lại. Nếu panel có ô tìm kiếm thì gõ để lọc trước — xử lý được virtual scroll.

**Multi-select** — chọn lần lượt, tự mở lại panel nếu nó đóng sau mỗi lần click, đóng hẳn khi xong.

**Upload file** — dựng `File` thật bằng `DataTransfer` rồi gán vào `input.files`. Không có input thì bắn `dragenter/dragover/drop` vào dropzone (react-dropzone, ngx-dropzone). Chế độ CDP còn dùng được `DOM.setFileInputFiles` để nạp **file thật từ ổ đĩa**.

**Rich text** — Quill, ProseMirror, Draft, CKEditor inline: dùng `execCommand('insertText')` để editor nhận đúng `beforeinput`.

**Khác** — checkbox/toggle custom, radio group, date input (tự đổi `12/03/1995` → `1995-03-12` theo chuẩn Việt Nam), input có mask (gõ từng ký tự).

---

## Hai chế độ chạy

**DOM** (mặc định) — nhanh, không hiện thanh cảnh báo. Đủ cho hầu hết trang.

**CDP** — bấm nút `DOM`/`CDP` ở góc side panel để đổi. Dùng `chrome.debugger` gửi event **trusted** (`isTrusted === true`), giống hệt người thật gõ phím. Cần khi trang kiểm tra `isTrusted` hoặc khi cần upload file thật từ đĩa. Đánh đổi: Chrome hiện thanh vàng "đang gỡ lỗi trình duyệt".

---

## DevTools panel

Mở DevTools → tab **AI Autofill**. Đây là phần "giống Playwright Inspector":

- Bảng toàn bộ field đã quét, click một dòng để nhảy tới và nháy sáng element
- **Locator playground** — gõ `role=textbox|name=Email`, `label=Họ và tên`, `testid=submit`, `css=#email`, `//input[@id="email"]`, hoặc JSON. Trả về số kết quả khớp + trạng thái visible/enabled từng cái, y như `page.locator(...)`
- Chạy thử một action đơn lẻ để debug trước khi cho AI chạy cả plan
- **Element picker** — hover highlight + tooltip như DevTools Inspect, click để lấy locator gợi ý (ưu tiên `data-testid` → `role+name` → `label` → CSS)

---

## Luồng hoạt động

```
Side panel: nhập yêu cầu
      ↓
Service worker: liệt kê mọi frame → inject content script → quét field
      ↓  (deep scan: mở từng dropdown custom để đọc option thật)
Provider AI: system prompt + FIELDS + ngữ cảnh trang → JSON schema ép output
      ↓
Plan hiện ra: sửa được từng giá trị trước khi chạy
      ↓
Action engine: DOM hoặc CDP, auto-wait + actionability check từng bước
      ↓
Kết quả: xanh/đỏ từng field, log chi tiết
```

Plan **không tự chạy mù** — bạn xem, sửa giá trị, bỏ bước không muốn, chạy lại từng bước riêng lẻ. Copy JSON plan ra để tái sử dụng.

---

## Giới hạn có thật

- **Closed shadow DOM** không đọc được — đây là giới hạn của trình duyệt, không có cách vòng.
- **Iframe khác origin** cần content script chạy trong đó; `all_frames: true` phủ được nếu extension có quyền trên domain đó.
- **Captcha, OTP, mật khẩu, thẻ tín dụng** bị chặn ở tầng prompt — cố tình không hỗ trợ.
- **Chrome Built-in AI** không nhận JSON schema, chất lượng thấp hơn model cloud với form phức tạp.
- Nội dung trang (label field + trích đoạn text) được gửi tới provider bạn chọn. Dùng Chrome Built-in AI hoặc Ollama qua Bridge nếu dữ liệu nhạy cảm.

---

## Cấu trúc

```
manifest.json
src/
  background/  service-worker.js  điều phối, đa frame
               cdp.js             driver chrome.debugger
  content/     00-util.js         shadow DOM walk, waitFor, hit-test
               10-locator.js      locator engine + accessible name
               20-scanner.js      nhận diện field
               30-actions.js      fill/select/check/upload/click
               40-picker.js       overlay + element picker
               99-main.js         message bridge
  providers/   gemini · anthropic · openai · chromeai · bridge
  lib/         prompt.js (system prompt + schema) · storage.js
  sidepanel/   panel.html/js/css
  devtools/    panel.html/js
  options/     options.html/js
bridge/server.mjs   Local Bridge (Node, không dependency)
testpage/           form thử: Material select, multi-select, shadow DOM, iframe, dropzone
```

## Trạng thái kiểm thử

Chạy qua Playwright trên `testpage/index.html`: **12/12 field điền đúng** — text, email, date (đổi đúng định dạng VN), textarea, mat-select đơn, mat-select multi (3 giá trị), native select, radio group, checkbox, file upload, và 2 field nằm trong shadow DOM.
