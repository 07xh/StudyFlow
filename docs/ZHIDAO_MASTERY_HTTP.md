# 知到 AI 课程掌握度：纯 HTTP 接入（`secretStr` 已还原）

日期：2026-11-21　样本：`appcomm-user.zhihuishu.com_2026_11_21_22_51_12.har`（31 条业务帧 + 3 条 OPTIONS 预检）

## 0. 结论先行

1. **掌握度 = 知识点练习卷，也就是课后习题。** 抓包给出三重证据：分部名 `"知识点练习默认部分"`、`examType: 5`、`limitTime: 0`。
   **但它有 `submit`。** 抓包里没有 `exam/user/submit` 帧，是因为这次采集在 `saveAnswer` 之后就被截断了——不是这条链路没有提交。
   课件端的实现（`zhs/ai/homework.py`）明确写着："AI 课程的'考试'实际上是作业，统一命名为 homework"，并且作业的收尾动作就是 `submit`。
2. **`submit` 才是计分动作。** `saveAnswer` 只回 `{"code":0,"data":true}`，不含任何判分；不提交，掌握度不变。
3. **判分只能回读。** `submit` 没有返回体；提交后重新 `getExamQuestionInfo`，`userAnswerVo[].isCorrect` 与 `optionVos[].isCorrect` 才被填上。这是唯一的正确性来源。
4. **答案在线上是字符串，不是数组。** 选择题/判断题用 `#@#` 连接选项 id，填空题用 `/` 连接各空。
5. `secretStr` 不是签名，是 **AES-128-CBC 加密的请求体**，密钥由服务端下发、固定 IV、PKCS#7 填充。算法已完整还原，5 条真实密文 100% 复现。
6. **读掌握度有只读接口**：`POST {kgRunStu}/mastery-statistics/get-knowledge-mastery-stat`，`{courseId, knowledgeId, dateFormate}` → `data.mastery`。
   所以"打开界面看一眼掌握度"不必新建试卷——这是相对早期设计的实质改进。
7. 三份 JS 都不含 `secretStr` 实现，真正缺的第四份是 **`https://base2.zhihuishu.com/js/2.js`**（165 KB，`yxyz` / `labc` / `aesUtil` / `rsaUtil` / CryptoJS / JSEncrypt 全在里面）。

## 1. 掌握度 = 课后习题，对实现的六条约束

| 事实 | 来源 | 实现结论 |
|---|---|---|
| `examType: 5`、`limitTime: 0`、`duration: 0` | HAR `getExamTestUserInfo` | 无时限。不做倒计时、不做"考试安排"、不做防作弊 |
| 分部名 `"知识点练习默认部分"`，`partSheetVos` 只有一个 | HAR `getExamSheetInfo` | 题目平铺，不用处理多部分/大题小题 |
| `saveAnswer` 回 `data: true`，无判分字段 | HAR | 保存 ≠ 计分。计分必须 `submit` |
| `submit` 无返回体，`code` 由 HTTP 200 表示 | 打包运行时 `homework.py::_submit` | 成功判定看 HTTP 状态，不看 body |
| 提交后 `userAnswerVo[].isCorrect` 才非空 | 打包运行时 `homework.py` 的判分回读 | 判分=重取题，不猜、不算本地分 |
| `questions-paper` 每调一次返回新 `examTestId`/`paperId` | HAR + 运行时代码 | "再练一轮"= 重新建卷，天然不覆盖历史 |

因此产品定位是**知识点掌握度练习**，不是考试系统。底层 URL 里的 `exam` 只是智慧树服务端的命名习惯
（`studentexamtest`、`getExamSheetInfo`…），不能据此加考试功能。

## 2. 三份 JS 的实际作用

| 文件 | 大小 | `secretStr` | 结论 |
|---|---|---|---|
| `ai-smart-course-student-pro.zhihuishu.com/assets/index-BjYCgkx4.js` | 11.6 MB | 25 处 | AI 课程外壳。含 axios 拦截器、`getAIK=useKeyStore().getKey`、`examURLList` 白名单。**不含 `yxyz` 定义**；但含掌握度接口的全部 URL |
| `studentexamcomh5.zhihuishu.com/js/app.01a6c4f0.js` | 162 KB | 4 处 | 作业考试 H5（作为微前端被外壳加载）。4 处均为 `secretStr: yxyz(data, key)` 调用 |
| `studentexamcomh5.zhihuishu.com/js/chunk-vendors.5862f77a.js` | 1.2 MB | 0 处 | 纯第三方依赖，与协议无关 |
| **`base2.zhihuishu.com/js/2.js`** | 165 KB | — | **实现本体**：`function yxyz`、`labc`、`aesUtil`、`rsaUtil` |

外壳里决定密钥类型的原文（`index-BjYCgkx4.js`）：

```js
let ys = gs.url.includes("//hike-teaching-api.zhihuishu.com") ? await getAIK(14) : await getAIK(6);
if (gs.url.includes("//studentexamtest.zhihuishu.com")) ys = await getAIK(3);
if (gs.url.includes("//studyservice-api") || gs.url.includes("//kgshare") || gs.url.includes("//aistudy"))
    ys = await getAIK(11);
```

> `studentexamtest.zhihuishu.com` 在自动加密的黑名单里被显式排除，所以考试接口是在各自的 API 方法里手工加密的：
> `openExam`、`getExamSheetInfo`、`getExamQuestionInfo`、`saveAnswer`、`submit` 都带 `secretStr`。

## 3. `secretStr` 生成链路

```
① GET  https://appcomm-user.zhihuishu.com/app-commserv-user/c/has
        ?uid = base64(RSA_PKCS1v15({"uid": <module>}, 固定公钥))
        → {"rt": {"sl": "<base64>"}}

② payload = RSA_公钥开(sl)            # 服务端用私钥"签"过，客户端用公钥还原
        → {"cKey":"<16字符>","ckv":1,"key":"...","module":3,"nkv":2,"osVersion":3}

③ secretStr = base64(AES-128-CBC(PKCS7(紧凑JSON(参数)), key=cKey, iv="1g3qqdh4jvbskb9x"))
```

JS 原文（`2.js`，字符串表已解码）：

```js
var aesUtil = {
  iv: CryptoJS.enc.Utf8.parse("1g3qqdh4jvbskb9x"),
  encrypt(data, key) {
    if (data instanceof Object) data = JSON.stringify(data);
    return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(data), CryptoJS.enc.Utf8.parse(key),
      { iv: aesUtil.iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString();
  }
};
function yxyz(data, key) {
  var kp = rsaUtil.genKeyPair();
  var blob = rsaUtil.decrypt(key, kp.publicKey);
  aesUtil.key = blob.cKey;                 // ← 关键：用 cKey，不是 sl 本身
  return aesUtil.encrypt(data, aesUtil.key);
}
```

**为什么同一份 HAR 里的 `secretStr` 前面一大段相同？** 同一个 `module` 的 `cKey` 在整个会话里不变，
明文前缀（`examTestId`/`examPaperId`）也相同，CBC 前几个块自然逐字节一致。

## 4. 密钥模块号

| module | 用途 | 判据 |
|---|---|---|
| 3 | `studentexamtest` / `teacherexamtest` 作业考试 | 拦截器显式分支；本文 5 条考试密文均用它解开 |
| 6 | `kg-ai-run`（AI 课程建卷、掌握度统计、Dify 工作流） | 拦截器默认值；`questions-paper`、`mastery-statistics` 用它 |
| 11 | `studyservice-api` / `kgshare` / `aistudy` | 代码分支，未取样本 |
| 14 | `hike-teaching-api` | 代码分支，未取样本 |

`XQJZXHIZ` 请求头 = `yxyz("", key6)`，即「空串的 AES 密文」（解密后是 16 个 `0x10`）。抓包值 `8Pf5k3SZClxzWLnff1mMEw==` 已复现。

## 5. 六个接口的明文结构（字段顺序即加密顺序）

| 接口 | 模块 | 明文 |
|---|---|---|
| `POST kg-ai-run.../stu/exam/questions-paper` | 6 | `{"scMapId":"…","courseId":"…","classId":"339597","knowledgeId":"…","dateFormate":1795272661000}` |
| `POST kg-ai-run.../stu/mastery-statistics/get-knowledge-mastery-stat` | 6 | `{"courseId":2095430049486426112,"knowledgeId":1853343377786015744,"dateFormate":1795272661000}` |
| `POST /exam/user/openExam` | 3 | `{"examTestId":4263949,"examPaperId":454449917,"courseId":"2095430049486426112"}` |
| `GET /exam/user/getExamSheetInfo`、`/exam/user/getExamTestUserInfo` | 3 | `{"examTestId":"4263949","examPaperId":"454449917"}` |
| `GET /question/getExamQuestionInfo` | 3 | `{"examTestId":"4263949","examPaperId":454449917,"questionId":939136618,"version":1}` |
| `POST /answer/saveAnswer` | 3 | `{"recruitId":"2095430049486426112","examTestId":"4263949","examPaperId":454449917,"questionId":939136618,"dataVos":null,"answer":"…"}` |
| `POST /exam/user/submit` | 3 | 见 §6.2 |

**类型是混着用的**（`examPaperId` 在 `openExam` 里是整数、`getExamQuestionInfo` 里也是整数，但 `examTestId` 一处字符串一处整数）。
照抄即可，不要"统一类型"——服务端是否容忍未验证。

`openExam` 的 form **只有 `secretStr`，没有 `date`**；其余带 `date`（13 位毫秒）。

## 6. 提交与判分

### 6.1 答案的线上格式是字符串

| 题型 | `questionType` | `answer` 形态 | 例子 |
|---|---|---|---|
| 单选 | 1 | 单个选项 id 字符串 | `"671372794"` |
| 多选 | 2 | 选项 id 用 `#@#` 连接 | `"671372795#@#671372796"` |
| 填空 | 3 | 各空用 `/` 连接 | `"生产力/生产关系"` |
| 判断 | 14 | 单个选项 id 字符串 | `"1"` / `"2"` |

早期实现把数组直接塞进 `answer`，是错的。`format_answer` / `decode_answer` 负责两个方向的转换，
界面只传"选了哪个 id / 填了什么文本"，分隔符由协议层决定。

### 6.2 `submit` 的明文（**注意官方拼写错误**）

```json
{"examTestId": 4263949, "courseId": 2095430049486426112, "courseType": 8,
 "examPaperId": 454449917, "aiKnlowledgeId": 1853343377786015744}
```

- 五个字段**全部是整数**，`courseType` 固定 `8`（AI 课程作业）。
- `aiKnlowledgeId` 少一个 `e`，是服务端字段名的原样拼写，**不能"修正"**。
- 请求走 exam_key（module 3），用 `session.ai_exam_submit`——它对空 body 容忍，HTTP 200 即成功。
- 响应**没有 body**（或 body 为空），所以不能用 `code: 0` 判成功。

### 6.3 判分靠回读

```
submit → GET getExamQuestionInfo(每题) → userAnswerVo[].isCorrect / optionVos[].isCorrect
```

- 提交前：`userAnswerVo: null`、`optionVos[].isCorrect: null`、`analysisVo: null`。
- 提交后：前者填 `[{answer, isCorrect}]`，后者填 `0/1`，`analysisVo` 给出解析。
- `isLookAnswer: 1` 时正确答案可见，`parse_question_result` 会一并取出 `correctOptionIds` / `correctTexts`。

### 6.4 三件事必须分开

| 字段 | 含义 | 易错点 |
|---|---|---|
| `round_score` | **本轮**正确率 | 不是掌握度 |
| `mastery_before.high` | 本轮之前的**历史最高**掌握度 | 官方达标看这个，不看本轮 |
| `mastery_after.mastery` | 提交后从只读接口读到的掌握度 | 可能因服务端延迟还没变 |

界面文案必须区分，否则会出现"我这一轮 100 分，为什么掌握度还是 60"的困惑。

## 7. 接口清单（练习链路）

| # | 步骤 | 方法 | URL | 传输形态 |
|---|---|---|---|---|
| 1 | 读知识点列表 | — | 复用 `AiCourseManager.get_knowledge_points` | 已封装 |
| 2 | 读掌握度（**只读**） | POST | `https://kg-ai-run.zhihuishu.com/run/gateway/t/stu/mastery-statistics/get-knowledge-mastery-stat` | JSON `{secretStr,date}` + 头 `XQJZXHIZ` |
| 3 | 建卷 | POST | `…/t/stu/exam/questions-paper` | 同上 |
| 4 | 开卷 | POST | `https://studentexamtest.zhihuishu.com/gateway/t/v1/exam/user/openExam` | form `secretStr`（**无 date**） |
| 5 | 卷面结构 + 进度 | GET | `…/v1/exam/user/getExamSheetInfo` | query `secretStr&date` |
| 6 | 取题 | GET | `…/v1/question/getExamQuestionInfo` | query `secretStr&date` |
| 7 | 存答案 | POST | `…/v1/answer/saveAnswer` | form `secretStr&date` |
| 8 | **提交本轮** | POST | `…/v1/exam/user/submit` | form `secretStr&date`，无 body 返回 |
| 9 | 判分回读 | GET | `…/v1/question/getExamQuestionInfo`（每题一次） | 同 6 |
| 10 | 更新用户用时 | POST | `…/v1/exam/user/updateUserUsedTime` | form `secretStr&date` |

辅助（明文 JSON，`uuid` 取自 `CASLOGC` cookie）：

| 步骤 | 方法 | URL |
|---|---|---|
| 错题推荐（只读） | POST | `…/t/stu/mastery-statistics/bd/get-test-question` |
| 结果页 | POST | `…/t/stu/exam/questions-paper-result-page` |
| 考试列表 | POST | `https://zhihuishu-ai-run-api.zhihuishu.com/run/gateway/t/v1/stuApi/knowledgePoint/getExamList` |

实测抓包顺序（14:51:01–14:51:04，全部在 3 秒内，**止于 saveAnswer**）：

```
c/has(m6) → questions-paper → c/has(m3) → openExam → getExamTestUserInfo
→ getExamSheetInfo → getExamQuestionInfo(A) → getExamQuestionInfo(B)
→ getExamQuestionInfo(A 重取) → saveAnswer → getExamQuestionInfo → getExamSheetInfo
```

正确的完整顺序（`practice_round(verify=True)` 实测）：

```
c/has(m6) → questions-paper → c/has(m3) → openExam → getExamTestUserInfo
→ getExamSheetInfo → getExamQuestionInfo × N → saveAnswer × N → submit
→ getExamSheetInfo → getExamQuestionInfo × N（判分） → c/has(m6) → questions-paper（下一轮掌握度）
```

## 8. 响应与状态

- `questions-paper` 成功：`code: 200`，`data = {masteryScore, highMasteryScore, masteryChange, examTestId, paperId, questionNum, error}`。
  - `masteryScore` 是**答这份卷之前**的掌握度，不是本次得分。
  - `examTestId` / `paperId` 只有这一个来源。
- `get-knowledge-mastery-stat` 成功：`code: 200`，`data.mastery` 为 0–100 的分数。
  前端按 `<60` 低 / `60–80` 中 / `80–100` 高 三档决定推荐哪些资源；实现里把档位一起返回，省得界面自己算。
- 考试网关成功：`code: 0`，`message: "success"`。
- `getExamTestUserInfo.data` 关键字段（实测）：`examType: 5`、`examState: 3`、`limitTime: 0`、`duration: 0`、`questionCount: 2`、`isShowScore: 1`、`isLookAnswer: 1`、`submitTime: null`。
  - 抓包里 `submitTime` 为 `null`，正是因为那一次没有提交；提交后该字段会被填上，是"是否已交"的可靠判据。
- `getExamSheetInfo.data`：`partSheetVos[0].name == "知识点练习默认部分"`，`questionSheetVos[]` 每题带 `questionId / version / answerState`（1 未答、2 已答），汇总 `answerCount` / `questionCount`。
- `saveAnswer`：`{"code":0,"data":true}`，无判分。另一次抓包回 `2046`（答案不能为空）——判断真保存，要看 `code` 再回读 `answerCount`，两者都要。

## 9. 官方阈值与重练规则

| 常量 | 值 | 含义 |
|---|---|---|
| `ai_homework_threshold` | 90（默认） | `highMasteryScore > 90` 视为该知识点已掌握 |
| 放弃线 | 30 | 掌握度 `< 30` 且 `tried > 4` 时，官方页面把资源推荐拉满——该先学再练 |

**重练规则（已确认部分）**：`questions-paper` 每调一次就是一张新卷，所以"再练一轮"必然是新 `examTestId`，
不会覆盖历史最高掌握度。**未确认部分**见 §12。

## 10. 落地代码

| 文件 | 作用 |
|---|---|
| `src/studyflow/platforms/zhidao/zhs_mastery.py` | 协议层：`rsa_*`、`seal_payload`、`KeyRing`、`format_answer`/`decode_answer`、`parse_question_result`、`ZhsMasteryClient`（`create_paper`/`open_exam`/`sheet`/`question`/`save_answer`/`submit`/`practice_round`） |
| `src/studyflow/platforms/zhidao/zhs_mastery_service.py` | 集成层：复用已授权 session，`catalog`/`start_round`/`save_answer`/`submit_round`/`discard_round`/`active_round`/`wrong` |
| `src/studyflow/platforms/zhidao/_aes_pure.py` | 无 `cryptography` 时的 AES-128-CBC 兜底 |
| `src/studyflow/services/bridge.py` | `zhidao.mastery.*` 七个操作的派发与错误码映射 |
| `frontend/src/bridge.ts` | 操作类型、TS 类型、7 个封装函数、中文错误文案 |
| `frontend/src/components/MasteryPanel.tsx` | 「AI 掌握度」面板：知识点列表 → 答题 → 提交 → 判分回显 |
| `tests/zhs_mastery_vectors.py` | HAR 原始向量（`sl`、`cKey`、5 组明文/密文） |
| `tests/zhs_fake_gateway.py` | 有状态假网关，含 `submit`（断言 `courseType == 8`），提交后才回填判分 |
| `tests/test_zhs_mastery.py` | 密文复现断言 |
| `tests/test_zhs_practice.py` | 练习流程断言（含请求顺序、submit body、答案编解码） |
| `scripts/verify_zhs_mastery.py` | 标准库自检 |
| `scripts/run_zhs_tests.py` | 无 pytest 环境下的 runner（内置最小替身） |
| `scripts/zhs_mastery_probe.py` | 真实账号探测（建卷 → 答题 → 提交 → 读判分与掌握度） |

依赖：`requests`（HTTP）+ `cryptography`（AES，缺失时自动降级到 `_aes_pure`）。

```powershell
# 离线自检，不需要登录、不需要第三方包
python scripts/verify_zhs_mastery.py

# 离线跑测试（本机没有 pytest）
python scripts/run_zhs_tests.py

# 真机只读：建卷 + 读题，不动答案、不提交
python scripts/zhs_mastery_probe.py `
  --knowledge-id 1853343377786015744 --course-id 2095430049486426112 `
  --class-id 339597 --sc-map-id 2095430049486426112

# 真机答一轮并提交：选项按文本匹配，提交后自动回读判分与掌握度
python scripts/zhs_mastery_probe.py `
  --knowledge-id 1853343377786015744 --course-id 2095430049486426112 `
  --class-id 339597 --sc-map-id 2095430049486426112 `
  --answer 939136618=新时代 --answer 939136619=共同富裕,伟大复兴 `
  --submit
```

## 11. 验证记录

`scripts/verify_zhs_mastery.py`（Python 3.13.12，未装 `cryptography`，走 `_aes_pure` 分支）：

```
[PASS] key blob (module 6) decodes          [PASS] builder saveAnswer -> body
[PASS] key blob (module 3) decodes          [PASS] builder questions-paper -> body
[PASS] seal/unseal POST openExam            [PASS] XQJZXHIZ header token
[PASS] seal/unseal getExamQuestionInfo      [PASS] KeyRing cKey (module 3)
[PASS] seal/unseal POST saveAnswer          [PASS] KeyRing caches (one HTTP call)
[PASS] seal/unseal questions-paper          [PASS] KeyRing seal -> wire
[PASS] practice request order (含 submit)    [PASS] practice round score 2/2
[PASS] submit body matches HomeworkCtx._submit
[PASS] format_answer / decode_answer 往返     [PASS] wrong single choice scores 1/2
all 44 checks passed
```

`scripts/run_zhs_tests.py` 实测：`32 passed, 0 failed`。

## 12. 未核实（代码里单独标注，不阻塞已验证功能）

1. **是否无限轮次**：官方页面没有"次数用完"的提示，但也没抓到上限分支。当前实现按"想练就建新卷"处理，
   失败时把服务端 `message` 原样透出，不做本地次数限制。
2. **掌握度是否必到 100**：`mastery_after` 是服务端算出来的，可能低于本轮正确率（加权、取最高、进度系数都有可能）。
   实现只如实展示，不推算、不补齐。
3. `bd/get-test-question` 在**没有 `examTestId`** 时的返回：接口允许省略，实际返回是否为空未验证。
4. `submit` 的**幂等性**：同一 `examTestId` 提交两次会怎样（`code` 非 0？重复计分？）未验证。
   实现的做法是提交成功即清本地状态，不给重复提交的机会。
5. **未答完就提交**是否被接受：实现允许（提示"还有 N 道未作答"但不阻止），真实行为未验证。
6. `updateUserUsedTime` 的明文只按同族推断，未取样本；当前只在 `heartbeat()` 里被动调用。
7. 单题保存失败码 `2046` 的确切触发条件：`answer:null` 时一次回 `code:0`、一次回 `2046`，差异未定位。
8. `c/has` 用 `GET` 是否与服务端 `labc` 的 `POST` 完全等价：本次抓包全是 GET，已验证 GET 可用。
