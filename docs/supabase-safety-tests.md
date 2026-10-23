# GPA Tracker：剩餘資料庫安全測試

## 本次執行紀錄（2026-10-23）

- T1–T4：使用者已確認，本輪不重測；報告列為 NOT RUN 並保留此原因。
- 已實際執行：JavaScript／PowerShell 語法檢查、127 個離線自動化測試。
- 已測：缺設定／連線錯誤的新報告、錯誤後繼續、失敗回滾、角色檢查、空快照拒絕、正式目標拒絕、T10 清理失敗與中斷控制。測試使用假的連線，並非 Supabase 通過證據。
- 真正 T5–T9、T10：尚未執行；本機沒有測試庫連線設定。沒有連接正式或測試 Supabase。
- HTTP/PostgREST JWT 簽章、網關設定仍未驗證；SQL authenticated 角色＋claims 測試驗證的是資料庫 RLS/RPC。

## 你現在只需做一件事

在此分支根目錄的 PowerShell 執行：

    .\scripts\run-db-tests.ps1

啟動器會依序：
1. 先建立本次 NOT RUN 報告，避免安裝失敗或取消輸入時留下舊 PASS。
2. 如缺依賴，自動 npm ci（需 Node.js 20+）。
3. 首次詢問 **gpa-tracker-test** project reference（重輸一次確認）及 Connect → Session pooler 主機。固定使用 5432，禁止 transaction pooler 6543。
4. 在本機隱藏輸入測試庫的 database password，僅放入此次子程序環境，結束後還原；不將新輸入密碼寫入設定檔、不需要 Service Role Key。
5. 執行 T5–T9，逐項顯示 PASS / FAIL / NOT RUN，產生 JSON 與 Markdown。

設定存放在 gitignored 的 db-test.local.json。舊設定缺 confirmTestProjectRef 時會詢問補上；自行設定者可從 supabase/tests/db-test.example.json 複製，並使用本機 GPA_TEST_PASSWORD 或 password 欄位。不要把設定或密碼貼到聊天。

回傳 db-test-report.local.json 或 .md 即可。報告不包含密碼、完整連線字串、SQL payload 或原始驅動錯誤訊息。

## 已設定者的指令

    npm run test:db

僅執行唯讀前置檢查與 T5、T6、T7、T8、T9。**不讀取 Migration，不執行 Migration、GRANT、REVOKE 或其他 DDL**。SQL 執行邊界也會拒絕這些操作。T1–T4 不重測。

- T5：兩位新建專用使用者，在四張表各有真實資料；測雙向跨使用者 SELECT／INSERT／UPDATE／DELETE、擁有人變更及自身正向操作。
- T6：在 authenticated 身分下測三張表 INSERT／UPDATE trigger；驗證 caller 的舊時間被 transaction_timestamp() 覆蓋。
- T7：RPC 寫入三個非空陣列；檢查筆數、使用者、UID、名稱及父子 local ID；偽造 user_id 不能影響 B；無身分呼叫必須失敗。
- T8：無 state／已有 state 兩種情況，null／省略 revision 都必須失敗，所有資料與 revision 不變。
- T9：新版本成功、舊版本衝突；在已刪除／插入部分資料後刻意造成 assessment NOT NULL 錯誤，證明完整快照與 revision 回復，B 的非空資料不變。

每項使用新連線，BEGIN / finally ROLLBACK。只有斷言和回滾都完成才 PASS。獨立錯誤不阻止後續測試；回滾失敗或中斷後，其餘項目為 NOT RUN。

admin 只用於 fixture 建立及獨立前後比較；RLS/RPC 測試先 SET LOCAL ROLE authenticated，確認 current_user、auth.uid()、沒有 superuser/BYPASSRLS，且 authenticated 不是表擁有人。不會以 admin 的查詢冒充 RLS 成功。

## T10 另行處理

最簡單仍是同一啟動器：

    .\scripts\run-db-tests.ps1 -Concurrency

已有本機密碼設定／環境變數者亦可：

    npm run test:db:concurrency

兩條寫入連線＋觀察連線，固定 READ COMMITTED；要求兩個不同 backend PID 並實際觀察 B 被 A 阻塞。A 提交前觀察舊的完整快照；提交後 B 必須 conflict，三張表都保留 A 的勝出內容。分別測已有 state 和首次初始化。

連線逾時 10 秒，資料庫 statement timeout 15 秒、client query timeout 18 秒、idle transaction timeout 25 秒；鎖等待觀察最多約 5 秒。Ctrl+C／SIGTERM 會要求停止、回滾及清理。強制終止或網路斷線仍可能中斷清理，因此在任何 committed fixture 前先以排他方式寫恢復檔，絕不覆蓋既有未清理 ID。

T10 無法全部包在單一 ROLLBACK：證明提交可見性需要真的 COMMIT。只使用隨機專用帳號，finally 以精確 UUID＋專用 email 清理並驗證 auth.users 及四張表都無該使用者資料。清理失敗則 FAIL，保留 db-test-recovery.local.json；新測試會拒絕啟動。

中斷後執行：

    .\scripts\run-db-tests.ps1 -Cleanup

或已設定密碼時：

    npm run test:db:cleanup

不得先刪恢復檔。清理會先核對 project reference，只刪精確記錄的專用 UUID／email。

## 報告與安全限制

- 預設：db-test-report.local.json / .md
- 並發：db-test-concurrency-report.local.json / .md
- 清理：db-test-cleanup-report.local.json / .md
- 每次啟動有新 runId／時間，先覆寫舊報告，再檢查設定與連線。三類流程互不覆蓋報告。不要同時啟動同一類流程兩次。
- PASS 僅表示本次已執行斷言及回滾／清理成功；FAIL 表示已嘗試但失敗；NOT RUN 表示未選取、先前已由使用者確認、缺設定或受阻。
- 測試設定必須名稱 gpa-tracker-test、host/user/ref 相符並明確二次確認 ref；另拒絕 public/config.js 中已知正式專案 ref，TLS 驗證不關閉。程式無法替你確認 Dashboard 的顯示名稱，請務必只輸入測試專案資料。
- 現有使用者自身可直接改 revision，以及缺 parent foreign keys 的設計限制仍存在，本批不修改 schema／ACL。
- 此流程不要求重跑 001 或 001a，也不會修改 Migration。PR 保持 Draft；不 merge、不部署。
