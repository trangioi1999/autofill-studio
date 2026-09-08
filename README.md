# Autofill Studio

Extension Chrome (MV3) tự điền dữ liệu vào **bất kỳ form nào trên bất kỳ trang web nào**, bằng AI. Bên trong là một **locator engine kiểu Playwright** và một **overlay/inspector kiểu Chrome DevTools**.

Ba chế độ, chọn theo việc:

| | Dùng khi | Chi phí |
|---|---|---|
| **Điền form** | Một form, một màn hình | 1 lần gọi AI |
| **Agent** | Nhiều bước, nhiều trang — bấm, điều hướng, chờ, đọc, rồi điền | 1 lần gọi AI **mỗi lượt** |
| **Bộ nhớ** | Màn hình đã từng điền | 0 — không gọi AI |

<p align="center">
  <img src="docs/panel-agent.png" width="320" alt="Agent chạy tool" />
  <img src="docs/panel-memory.png" width="320" alt="Bộ nhớ theo màn hình" />
</p>

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
| **Local Bridge** | Không cần key | Gọi lại CLI bạn đã đăng nhập sẵn: Claude Code, Gemini CLI, Kiro CLI, Ollama |

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

**Về Kiro:** AWS đã đổi tên Amazon Q Developer CLI thành **Kiro CLI**, binary từ `q` sang `kiro`. Bridge dò lần lượt `kiro` → `kiro-cli` → `q` nên bản nào cũng chạy, và `model` nhận cả `kiro` lẫn `q`. Đăng nhập:

```bash
brew install --cask kiro-cli
kiro login          # chọn Free (AWS Builder ID) hoặc Pro (IAM Identity Center)
kiro whoami         # kiểm tra
```

`GET /health` trả về cả tên binary thật:

```json
{ "ok": true, "backends": ["claude", "kiro"], "bins": { "kiro": "q" } }
```

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

## Chế độ Agent

Giống cách Playwright MCP hay Claude điều khiển trình duyệt: model **không thấy DOM**, nó thấy một bản đồ phẳng của trang, mỗi dòng một element kèm ref.

```
e1   textbox   "Họ và tên" *
e2   textbox   "Email" * = "a@example.com"
e3   combobox  "Tỉnh / Thành phố" = "Đà Nẵng"
e4   checkbox  "Tôi đồng ý với điều khoản" *
e5   button    "Tiếp tục"
e6   link      "Điều khoản" -> /terms
```

Mỗi lượt model trả về một nhóm hành động, extension chạy, **chụp lại trang**, đưa bản đồ mới. Lặp đến khi xong.

**Công cụ:** `fill` `type` `select` `check` `radio` `upload` `click` `press` `scroll` `navigate` `back` `wait` `read`

**Bốn thứ giữ cho nó không chạy loạn:**

1. **Ref đánh số lại sau mỗi lần chụp.** Model không giữ được tham chiếu cũ qua lượt — không thể click nhầm thứ đã biến mất. Ref không có thật thì báo lỗi vào lịch sử chứ không crash.
2. **Hành động làm trang đổi thì cắt lượt ngay.** `click`/`navigate`/`back`/`press` thành công là dừng, chụp lại. Mọi hành động xếp sau trong cùng lượt bị bỏ — vì chúng được nghĩ ra dựa trên trang cũ.
3. **Trần số lượt** (mặc định 12, đổi trong Cài đặt) và **nút dừng** ăn ngay sau hành động đang chạy.
4. **Không tự bấm nút gây hậu quả** — thanh toán, đặt hàng, chuyển tiền, xoá vĩnh viễn, gửi đơn — trừ khi mục tiêu bạn viết ra nói rõ. Gặp captcha thì báo `blocked` chứ không tìm cách vượt.

Nút **Bản đồ** ở thanh dưới in ra đúng cái model sẽ đọc — tiện khi nó làm sai và bạn muốn biết vì sao.

---

## Bộ nhớ theo màn hình

Điền form bằng AI tốn một lần gọi model. Lần thứ hai vào đúng màn hình đó thì không cần nữa.

Sau mỗi lần autofill thành công, extension **chụp lại giá trị đang có trên form** và lưu vào `chrome.storage.local`. Lần sau mở lại trang, side panel hiện banner *"Màn hình này đã từng được điền"* → bấm **Điền ngay từ bộ nhớ** là xong, không có request nào đi ra ngoài.

**Nhận diện màn hình.** Khoá lưu là `host + path` đã chuẩn hoá: id số, UUID, hash dài bị thay bằng `:id`, query và hash bị bỏ. Nên `/apply/999?ref=fb` và `/apply/12345` là **cùng một màn hình**, còn `/checkout` thì không.

**Khớp lại field.** `afId` sinh mới mỗi lần load trang nên không dùng làm khoá được. Mỗi ô được lưu kèm một chữ ký bền (`name`/`formcontrolname`, `data-testid`, nhãn, section, selector, loại), lần sau chấm điểm để ghép:

| Trùng | Điểm |
|---|---|
| `name` / `formcontrolname` | +100 |
| `data-testid` | +90 |
| selector | +60 |
| nhãn | +45 |
| placeholder · section · loại | +25 · +15 · +15 |
| khác nhóm (text ↔ checkbox…) | −40 |

Ngưỡng ghép là 55. Nghĩa là bạn **đổi nhãn, đổi class, đảo thứ tự field** thì vẫn khớp; còn form thay hẳn thì nó ghép 0 ô chứ không điền bừa.

**Không bao giờ được lưu:** `type="password"`, và mọi ô có nhãn/tên dính OTP, CVV/CVC, số thẻ, secret, token, API key, PIN, captcha. Ô rỗng và checkbox chưa tick cũng bỏ qua cho gọn.

Tab **Bộ nhớ** trong side panel: lưu thủ công nhiều bản cho cùng một màn hình (ví dụ "Hồ sơ A" / "Hồ sơ B"), xem trước phần ghép được trước khi điền, đổi tên, xoá. Tắt tự lưu / tự gợi ý trong **Cài đặt**.

---

## Hai cách gửi event: DOM và CDP

**DOM** (mặc định) — nhanh, không hiện thanh cảnh báo. Đủ cho hầu hết trang.

**CDP** — bấm nút `DOM`/`CDP` ở góc side panel để đổi. Dùng `chrome.debugger` gửi event **trusted** (`isTrusted === true`), giống hệt người thật gõ phím. Cần khi trang kiểm tra `isTrusted` hoặc khi cần upload file thật từ đĩa. Đánh đổi: Chrome hiện thanh vàng "đang gỡ lỗi trình duyệt".

---

## DevTools panel

Mở DevTools → tab **Autofill Studio**. Đây là phần "giống Playwright Inspector":

- Bảng toàn bộ field đã quét, click một dòng để nhảy tới và nháy sáng element
- **Locator playground** — gõ `role=textbox|name=Email`, `label=Họ và tên`, `testid=submit`, `css=#email`, `//input[@id="email"]`, hoặc JSON. Trả về số kết quả khớp + trạng thái visible/enabled từng cái, y như `page.locator(...)`
- Chạy thử một action đơn lẻ để debug trước khi cho AI chạy cả plan
- **Element picker** — hover highlight + tooltip như DevTools Inspect, click để lấy locator gợi ý (ưu tiên `data-testid` → `role+name` → `label` → CSS)

---

## Luồng hoạt động

```
Chế độ Điền form — side panel: nhập yêu cầu
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

Chế độ Agent thì lặp:

```
mục tiêu
   ↓
┌─→ chụp bản đồ trang (mọi frame) → đánh số ref e1..eN
│      ↓
│  model chọn nhóm hành động
│      ↓
│  chạy — dừng ngay sau hành động làm trang đổi
│      ↓
└── chưa xong? lặp lại (tối đa N lượt)
       ↓
    done / blocked / hết lượt
```

Có bộ nhớ rồi thì đường đi ngắn hơn hẳn:

```
Side panel: bấm "Điền ngay từ bộ nhớ"
      ↓
Quét field → ghép chữ ký với bản lưu → điền.  Không có bước gọi AI.
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
               50-snapshot.js     bản đồ trang cho agent (ref + role + value)
               99-main.js         message bridge
  providers/   gemini · anthropic · openai · chromeai · bridge
  lib/         agent.js    vòng lặp agent: tool, prompt, ref map
               prompt.js   system prompt + schema
               storage.js  cài đặt
               screen.js   nhận diện màn hình + chấm điểm khớp field
               memory.js   kho bản lưu theo màn hình
  sidepanel/   panel.html/js/css
  devtools/    panel.html/js
  options/     options.html/js
bridge/server.mjs   Local Bridge (Node, không dependency)
testpage/           form thử: Material select, multi-select, shadow DOM, iframe, dropzone
```

## Trạng thái kiểm thử

**Action engine** — chạy qua Playwright trên `testpage/index.html`: **12/12 field điền đúng** — text, email, date (đổi đúng định dạng VN), textarea, mat-select đơn, mat-select multi (3 giá trị), native select, radio group, checkbox, file upload, và 2 field nằm trong shadow DOM.

**Bộ nhớ theo màn hình** — test lưu/ghép với `chrome.storage` giả lập: lọc đúng 4/8 ô (bỏ password, OTP, ô rỗng, checkbox chưa tick), gom `/apply/999` với `/apply/12345` về một khoá, ghép lại đủ 4 ô sau khi selector đổi và thứ tự đảo, checkbox trả về boolean, và ghép **0 ô** khi thả vào một form không liên quan.

**Bridge** — `/health` và `/v1/complete` chạy thật, xác nhận `kiro` và `q` cùng trỏ về một backend và báo lỗi rõ khi chưa cài CLI.

**Agent** — chạy `service-worker.js` thật trong Node với `chrome.*` giả lập và một "model" HTTP trả JSON theo kịch bản, trên một trang 2 bước: đi hết 2 bước và kết thúc `done`; dừng đúng sau `click` nên hành động xếp sau bị bỏ; ref không tồn tại báo lỗi chứ không crash; lượt 2 nhận bản đồ mới + lịch sử lượt 1; không tự bấm "Gửi hồ sơ". Nút dừng trả `stopped` giữa chừng, trần lượt trả `maxsteps`.

**Bản đồ trang** — `50-snapshot.js` chạy trên `testpage/index.html` thật: đọc đúng 18 element gồm cả shadow DOM, và sau khi hành động thì phản ánh đúng giá trị của mat-select, multi-select, native select, radio, checkbox — không nhầm placeholder (`-- Chọn --`, `Chọn...`) thành giá trị.
