# ColorNote 匯入工具

將 ColorNote 嘅加密 `.backup` 檔案轉換成 Finsen Notes 可以還原嘅 JSON。

## 背景

ColorNote 冇官方匯出功能，backup 檔案係私有格式加密。呢度用 [olejorgenb/ColorNote-backup-decryptor](https://github.com/olejorgenb/ColorNote-backup-decryptor) 解密，再自行寫 parser 轉格式。

## 步驟

### 1. 落載解密工具

呢啲 binary 冇 commit 入 repo（體積大 + 第三方檔案），自己落載：

```bash
curl -sL -o colornote-decrypt.jar https://raw.githubusercontent.com/olejorgenb/ColorNote-backup-decryptor/master/colornote-decrypt.jar
mkdir -p lib bin
curl -sL -o lib/bcprov-jdk15on-154.jar https://raw.githubusercontent.com/olejorgenb/ColorNote-backup-decryptor/master/lib/bcprov-jdk15on-154.jar
curl -sL -o lib/bcpkix-jdk15on-154.jar https://raw.githubusercontent.com/olejorgenb/ColorNote-backup-decryptor/master/lib/bcpkix-jdk15on-154.jar
curl -sL -o bin/ColorNoteBackupDecrypt.class https://raw.githubusercontent.com/olejorgenb/ColorNote-backup-decryptor/master/bin/ColorNoteBackupDecrypt.class
```

### 2. 解密

唔好用 `java -jar`：Oracle JRE 會拒絕未簽名嘅 JCE provider（`JCE cannot authenticate the provider BC`），一定要行 classpath 版本。

```bash
java -cp "lib/bcprov-jdk15on-154.jar;lib/bcpkix-jdk15on-154.jar;bin" ColorNoteBackupDecrypt 0000 28 < your-file.backup > raw-v2.dat
```

- `0000` 係 default backup 密碼，有自設就換返
- `28` 係 v2 格式嘅 magic offset。如果報 `IllegalBlockSizeException: last block incomplete`，即係檔案係 v1 格式，改用冇 offset 嘅 `... ColorNoteBackupDecrypt 0000 < ...`

### 3. 轉換

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File convert2.ps1
```

出 `imported-notes.json`，喺 app 入面「設定 → 還原」匯入。

## 點解唔用官方嘅 fixup 腳本

官方 `fixup-v2` 用二進位分隔符 regex 切開每筆記錄，但呢個偵測唔夠穩陣：實測 1451 筆記錄有 43 筆長文（最長 15 萬字）會黐埋一齊解析失敗，靜靜雞漏咗 88 則筆記。

`convert2.ps1` 改為喺解密後嘅全文度搵 `{"_id":` 開頭，然後**逐個字元配對大括號**（識得跳過字串內容同 escape 字元）搵出每個 object 嘅真正結尾。實測 1451/1451 全部解析成功，零失敗。

## 欄位對應

| ColorNote | Finsen Notes | 備註 |
|---|---|---|
| `title` / `note` | `title` / `content` | 完整保留 |
| `created_date` / `modified_date` | `createdAt` / `updatedAt` | 都係 unix ms |
| `color_index` (0-9) | `color` | 見下面警告 |
| `uuid` | `id` | 冇就自動生成 |
| `folder_id == 256` | — | 垃圾桶，跳過 |
| `type == 16` | — | 系統記錄，跳過 |

**顏色對應未經證實**：ColorNote 個 `color_index` 冇公開文檔，`convert2.ps1` 用緊彩虹排序（紅橙黃綠青藍紫粉灰）估，未必同 app 入面睇到嘅一致。如果有落差，改 `$colorMap` 嗰行就得。

## 安全提示

解密出嚟嘅 `raw-v2.dat` 第一行係同步用嘅 metadata，**含有帳號 email 同 OAuth access token 明文**。用完即刻刪，唔好 commit（`.gitignore` 已經擋咗 `*.dat`）。
