# Software Factory Concept

**Version:** v31  
**Status:** Concept v1 — refined through 30 review iterations

> **Software Factory یک System of Coordination برای تولید نرم‌افزار است، نه System of Record همه‌چیز.**  
> ابزارها، Agentها و workflowها قابل‌تعویض‌اند؛ Factory جریان کار و رابطه‌ی میان آن‌ها را قابل ردیابی می‌کند.

---

## 1. ایده در یک نگاه

سیستم‌های موجود همان کاری را که خوب انجام می‌دهند ادامه می‌دهند:

- GitLab / GitHub → کد، commit، MR/PR و pipeline
- Jira / Linear / ServiceNow → issue و ticket
- Slack / Telegram / Teams → گفتگو
- Agent Runtimeها → اجرای Agent
- CI/CD → build, test, deploy
- n8n / Zapier / Make → integration و automation

Software Factory قرار نیست جای این‌ها را بگیرد.

کار Factory این است که بداند:

```text
چه چیزی اتفاق افتاد؟
        ↓
چه Workی ایجاد شد؟
        ↓
چه Actorی آن را انجام داد؟
        ↓
Execution کجا انجام شد؟
        ↓
چه Result/Referenceای تولید شد؟
        ↓
بعد از آن چه اتفاقی افتاد؟
```

### اصل مرکزی

> داده در System of Record خودش می‌ماند؛ Factory تا حد ممکن فقط **Reference + Relation + Coordination State** نگه می‌دارد.

---

## 2. Core بسیار کوچک

Core پیشنهادی فقط این primitiveها را می‌شناسد:

| Primitive | معنی |
|---|---|
| **Work** | کاری که باید پیگیری یا انجام شود |
| **Actor** | انجام‌دهنده Work؛ Human یا Agent |
| **Execution** | یک attempt/run مشخص برای انجام Work |
| **Reference** | اشاره پایدار به چیزی داخل یا خارج Factory |
| **Relation** | رابطه و lineage بین Work، Execution و Referenceها |
| **Event** | اتفاقی که جریان را حرکت می‌دهد |

`Outcome` لازم نیست entity سنگین مستقلی باشد؛ معمولاً نتیجه‌ی Execution به شکل یک یا چند `Reference` و metadata ثبت می‌شود.

### مثال Reference

```text
jira://PAY-241
gitlab://payments/api/merge_requests/81
agent://security-vendor/run/9301
ci://pipeline/18201
slack://support/thread/...
```

### مثال Relation

```text
triggered-by
performed-by
produced
depends-on
verifies
derived-from
caused
```

---

## 3. Factory چه چیزی را مالک نیست؟

Factory نباید ذاتاً مالک این موارد باشد:

- Issue Tracker
- Git Hosting
- Chat Platform
- Agent Runtime
- CI/CD Engine
- Knowledge Base
- Workflow Engine عمومی
- LLM Provider
- MCP/A2A/HTTP implementation

ممکن است برای performance داده‌ای را cache/index کند، اما cache نباید با **Source of Truth** اشتباه شود.

---

## 4. Actor: Human و Agent در یک مدل

از دید coordination:

```text
Actor
├── Human
├── Internal Agent
└── External / Vendor Agent
```

Human و Agent از نظر assignment و lineage یک مفهوم مشترک دارند.

تفاوت آن‌ها می‌تواند در این موارد باشد:

- execution adapter
- availability
- authentication
- owner
- autonomy policy
- capabilities

ولی Core نباید برای Human و Agent دو مدل جدا بسازد.

### Bring Your Own Agent

یک Agent می‌تواند هرجایی اجرا شود:

```text
Software Factory
       │
       │ Standard Agent Contract
       ▼
External Agent
       │
       ▼
Vendor / Internal Platform
```

Factory لازم نیست بداند پشت Agent چه چیزی قرار دارد.

آن Agent ممکن است نماینده‌ی یک سیستم کامل خارجی باشد؛ مثلاً شرکت پشتیبانی می‌تواند به‌جای API تیکتینگ خود، یک Support Agent در اختیار Factory قرار دهد.

### Agent Contract حداقلی

یک Agent قابل اتصال بهتر است بتواند این موارد را اعلام کند:

- identity
- owner
- endpoint / discovery mechanism
- supported capabilities
- execution semantics
- execution reference
- health / availability
- authentication requirements

### Protocol-Agnostic

```text
Agent Contract
      │
      ├── A2A Adapter
      ├── MCP Adapter
      ├── HTTP Adapter
      ├── Webhook Adapter
      └── Future Adapter
```

MCP، A2A، HTTP و استانداردهای آینده **هویت Core نیستند**.

---

## 5. دنیای بیرون چگونه وارد Factory می‌شود؟

Factory سه نوع boundary اصلی دارد:

```text
                   External World
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
        Events         Actions         Actors
```

### Events

چیزی از بیرون اتفاق افتاده است:

- customer complaint
- production alert
- ticket created
- email received
- deployment failed
- agent detected a problem

### Actions

یک سیستم بیرونی عملی را در اختیار می‌گذارد:

- create issue
- send message
- merge PR
- deploy
- query customer

### Actors

یک سیستم/سازمان می‌تواند خود یک Actor قابل استفاده معرفی کند:

- Support Agent
- Security Agent
- Billing Agent
- Custom Engineering Agent

> **Actor با Action Provider یکی نیست.**  
> Jira ممکن است Action Provider باشد؛ Security Agent یک Actor است.

---

## 6. ورودی Factory الزاماً Issue نیست

ورودی اولیه را بهتر است `Signal` بنامیم.

```text
Phone Call
Monitoring Alert
Email
Webhook
Agent Event
      │
      ▼
    Signal
      │
      ▼
 Intake / Policy
      │
      ▼
     Work
```

### Signal vs Event

- **Signal:** ورودی بیرونی که ممکن است نیازمند واکنش باشد.
- **Event:** یک اتفاق ثبت‌شدنی در جریان Factory یا سیستم‌های متصل.

هر Signal الزاماً Work ایجاد نمی‌کند؛ policy/workflow تصمیم می‌گیرد.

---

## 7. Workflow

Workflow نباید داخل Core به Scrum، QA، CI/CD یا فرایند خاصی قفل شود.

مدل عمومی:

```text
Event / Signal
      ↓
Rule / Policy
      ↓
Work
      ↓
Actor
      ↓
Execution
      ↓
Result / Reference
      ↓
Next Event / Next Work
```

### سه نوع جریان

**Deterministic**

```text
PR Created → Test → Review → Merge
```

**Agentic**

```text
Investigate Problem
       ↓
Agent decides next useful Work
```

**External**

```text
Factory Event → n8n / Temporal / CI → Result Event
```

> Factory باید **جریان و نتیجه‌ی آن** را بفهمد؛ لازم نیست خودش موتور اجرای تمام workflowها باشد.

### Test و Verification چه می‌شوند؟

Test، Review، Approval، Deploy، Planning و Investigation همگی می‌توانند فقط `Work` باشند.

```text
Implementation Work
       ↓
Developer Agent
       ↓
MR
       ↓
Test Work
       ↓
QA Agent / CI
       ↓
Test Result
       ↓
Security Review Work
       ↓
Security Agent
```

هیچ‌کدام لازم نیست subsystem ویژه Core باشند.

---

## 8. چیزی که Factory واقعاً اضافه می‌کند: Cross-System Lineage

مثال:

```text
Customer Call
      │
      ▼
Support Ticket
      │
      ▼
Investigation Agent Run
      │
      ▼
GitLab Issue
      │
      ▼
Developer Agent Run
      │
      ▼
Merge Request
      │
      ▼
Security Review
      │
      ▼
Deployment
```

ممکن است هر Node در سیستم متفاوتی زندگی کند.

Factory فقط می‌تواند این رابطه‌ها را نگه دارد:

```text
customer-call      ──triggered──> support-ticket
support-ticket     ──caused─────> investigation-work
agent-run          ──produced───> merge-request
security-review    ──verifies───> merge-request
deployment         ──derived-from──> merge-request
```

این **end-to-end lineage** یکی از مهم‌ترین ارزش‌های Factory است.

---

## 9. Factoryهای مختلف چرا متفاوت‌اند؟

Core همه مشترک است.

تفاوت از **composition** می‌آید:

```text
Factory =
  Scope
+ Actors
+ External Systems
+ Policies
+ Workflow Bindings
+ Autonomy Level
```

### مثال: Startup Factory

```text
GitHub
Linear
Slack
Codex
Claude Code
Vercel

Policy:
low-risk work → mostly autonomous
production → human gate
```

### مثال: Bank Factory

```text
GitLab
Jira
Private Agents
Security Agent
Compliance Agent
Internal CI/CD

Policy:
security review → mandatory
production → human approval
```

### مثال: Incident Factory

```text
Monitoring
Pager system
Slack
SRE Agent
Runbook Agent
Human Incident Commander
```

> Software Factory یک process ثابت نیست؛ یک **configured production environment** است.

---

## 10. Factory Definition

حداقل تعریف یک Factory می‌تواند بسیار کوچک باشد:

```yaml
factory:
  scope: payment-platform

  actors:
    - backend-agent
    - qa-agent
    - human-tech-lead
    - external-security-agent

  systems:
    - gitlab
    - jira
    - slack

  policies:
    - production_requires_human_approval

  workflow_bindings:
    - on: merge_request_created
      create: review_work
```

این configuration است؛ نه یک مدل سازمانی سنگین.

---

## 11. n8n / Zapier / Make

این ابزارها می‌توانند integration را بسیار ساده کنند:

```text
Software Factory
      │
      ▼
     n8n
  ┌───┼─────┐
  ▼   ▼     ▼
Jira Slack Telegram
```

اما آن‌ها فقط **integration accelerator** هستند.

حذف یا جایگزینی آن‌ها نباید Core یا Concept محصول را تغییر دهد.

---

## 12. North Star

> **Bring your agents. Bring your tools. Bring your workflows. The factory coordinates the work.**

یا دقیق‌تر:

> **Software Factory coordinates software work across humans, agents and existing systems while leaving each system of record in control of its own data.**

---

# Appendix A — قواعدی که Agent/Developer نباید بشکند

## A.1 Invariants

1. Factory باید System of Coordination باقی بماند.
2. External data تا جای ممکن با `Reference` نگه‌داری شود، نه copy کامل.
3. Human و Agent هر دو Actor هستند.
4. Vendor، runtime و protocol نباید وارد Domain Core شوند.
5. Test/Review/Approval/Deploy special-case Core نیستند؛ می‌توانند Work باشند.
6. Workflow engine باید قابل‌تعویض باشد.
7. Cross-system relation و causation باید قابل ردیابی باشد.
8. Event ingestion و action execution باید idempotency را در نظر بگیرند.
9. credentials/secrets متعلق به connector/credential boundary هستند.
10. capabilityهای providerها برابر فرض نشوند؛ graceful degradation لازم است.

---

## A.2 Non-Goals

Factory قرار نیست این‌ها را دوباره بسازد:

- GitHub/GitLab
- Jira/Linear
- Slack/Telegram
- CI/CD
- LLM framework عمومی
- Agent runtime عمومی
- workflow engine عمومی
- universal knowledge store

---

## A.3 Core Decision Test

قبل از اضافه کردن هر primitive جدید به Core بپرسید:

1. آیا بدون آن coordination end-to-end هنوز ممکن است؟  
   اگر بله، احتمالاً Core نیست.

2. آیا یک System of Record موجود بهتر مالک داده است؟  
   اگر بله، `Reference` نگه دارید.

3. آیا مفهوم vendor/protocol/tool-specific است؟  
   اگر بله، Adapter/Connector است.

4. آیا می‌توان آن را با Work، Actor، Execution، Reference، Relation یا Event بیان کرد؟  
   اگر بله، primitive جدید نسازید.

5. آیا عوض شدن Claude/Codex/Jira/GitLab/n8n معماری اصلی را تغییر می‌دهد؟  
   پاسخ مطلوب: **خیر**.

---

# Appendix B — Operational Semantics

## B.1 Correlation & Causation

برای lineage قابل اتکا، هر event/execution در صورت امکان باید این‌ها را داشته باشد:

```text
id
correlation_id
causation_id
source_ref
occurred_at
```

timestamp به‌تنهایی برای reconstruct کردن causal chain کافی نیست.

## B.2 Idempotency

Factory باید فرض کند:

- webhook ممکن است دوبار برسد؛
- queue ممکن است message را redeliver کند؛
- Agent ممکن است execution را retry کند؛
- external action ممکن است timeout شود ولی در واقع انجام شده باشد.

بنابراین adapterها باید تا حد امکان idempotency key و external execution reference ارائه دهند.

## B.3 Cache vs Ownership

Factory می‌تواند برای search/performance داده‌ای را cache یا project کند.

اما:

```text
Cache ≠ Source of Truth
Projection ≠ Ownership
```

---

# Appendix C — نمونه End-to-End

سناریو: مشتری با پشتیبانی تماس می‌گیرد و از خطای پرداخت شکایت می‌کند.

```text
Customer Call
  [Support Platform]
        │
        ▼
Signal: payment_problem
  [Factory]
        │
        ▼
Investigation Work
        │
        ▼
Support Agent
  [External Vendor]
        │
        ▼
Result: software_bug
        │
        ▼
Implementation Work
        │
        ▼
Backend Agent
  [Remote Runtime]
        │
        ▼
Merge Request
  [GitLab]
        │
        ▼
Test Work
        │
        ▼
CI / QA Agent
        │
        ▼
Security Review Work
        │
        ▼
External Security Agent
        │
        ▼
Deploy Work
        │
        ▼
Deployment System
```

### مالک هر داده کیست؟

| اطلاعات | System of Record |
|---|---|
| تماس و اطلاعات مشتری | Support Platform |
| Ticket | Support/Jira/ServiceNow |
| Code / MR | GitLab/GitHub |
| Agent execution details | Agent Runtime |
| Chat | Slack/Telegram/etc. |
| Deployment | Deployment Platform |
| End-to-end lineage | Software Factory |

---

# Appendix D — Anti-Patterns

- ساختن issue tracker داخلی فقط برای اینکه Factory مفهوم Work داشته باشد.
- mirror کردن کامل GitLab/Slack/Jira در دیتابیس Factory.
- hard-code کردن `QAAgent`, `SecurityAgent`, `ClaudeCodeActor` در Core.
- فرض اینکه همه Actorها داخل زیرساخت Factory اجرا می‌شوند.
- مساوی گرفتن Agent Contract با MCP یا A2A.
- ساخت workflow engine بزرگ قبل از اینکه نیاز واقعی ثابت شود.
- فرض اینکه هر Outcome یعنی success.
- فرض اینکه همه providerها capability یکسان دارند.
- تبدیل Factory به «همه‌چیز پلتفرم» به‌جای coordination layer.

---

## Final Mental Model

```text
                    SOFTWARE FACTORY

             System of Coordination

        Work ── Actor ── Execution
          │                 │
          └──── Relations ──┘
                   │
                References
                   │
         ┌─────────┼─────────┐
         ▼         ▼         ▼
       Jira      GitLab    Agents
       Slack       CI      Vendors
       n8n       Deploy    Future X
```

**Core کوچک است. دنیای بیرون بزرگ و قابل‌تعویض است.**
