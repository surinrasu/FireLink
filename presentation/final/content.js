/* Bilingual, audience-facing deck content. No runtime or network dependencies. */
const B = (zh, en) => ({ zh, en });
window.FIRELINK_DECK = {
  title: B('FireLink　课程结题汇报', 'FireLink　Final Design Review'),
  authors: '邓雪意 24168119　朱禹杭 24168202',
  date: '2026.11',
  mainCount: 26,
  sections: [B('课题与定位','Brief & focus'), B('服务系统','Service design'), B('组织者工作台','Organizer workspace'), B('设计与实现','Design & implementation'), B('结论','Conclusion'), B('答辩备查','Appendix')],
  slides: [
    {
      id:'opening', section:0, layout:'cover', time:30,
      title:B('让每一份善意，\n都有去处。','A place for every\nwilling hand.'),
      lead:B('民间志愿者火灾支援服务系统','A volunteer coordination service for fire support'),
      subtitle:B('FireLink　课程结题汇报','FireLink　Final design review'),
      image:'organizer-tasks.webp',
      notes:'大家好，我们是邓雪意和朱禹杭。我们的选题是设计一套民间志愿者进行火灾支援的服务系统，项目叫 FireLink。它要解决的核心问题是：一个人愿意帮忙之后，怎样知道哪里需要自己、怎样报名，以及组织者怎样确认这个人是否适合。本次汇报以组织者工作台为主，同时展示志愿者端如何与它连接。所有界面中的事件与人员均为演示或演练数据。'
    },
    {
      id:'thesis', section:0, layout:'statement', time:40,
      title:B('把参与意愿，变成可以确认的支援','Make volunteer support actionable'),
      lead:B('FireLink 负责建立可信联系，并在报名通过后交接给组织已有渠道。','FireLink establishes a trusted connection, then hands coordination to the organization’s existing channels.'),
      items:[
        [B('需求说清楚','Describe the need'),B('组织者发布具体任务、时间地点、能力与资料要求。','Organizers specify the work, schedule, location, capabilities and required information.')],
        [B('匹配有依据','Make an informed match'),B('志愿者按任务授权资料，组织者依据申请逐份确认。','Volunteers share task-specific information; organizers review each application.')],
        [B('联系有边界','Connect with consent'),B('审核通过后，获授权的成员按志愿者同意的范围联系。','After acceptance, authorized members can access only the contact methods the volunteer shared.')]
      ],
      source:B('产品定位　团队确认的服务边界','Product position　Team-confirmed service boundary'),
      notes:'我们把服务重点放在建立联系之前的三个环节。第一，需求需要变成能判断、能执行的任务；第二，组织者不能只看到有人报名，还需要知道这个人的能力与时间是否符合任务；第三，联系方式不能在报名时就完全暴露。审核通过以后，很多组织已经有微信群、电话或其他成熟沟通方式，FireLink 将信息交接给这些渠道。这个交接就是本次设计的终点，而不是功能缺失。'
    },
    {
      id:'brief', section:0, layout:'table', time:40,
      title:B('课程要求被转化为五个设计问题','Five design questions from the brief'),
      lead:B('以山火支援为起点，聚焦受影响社区与民间志愿者的连接。','Starting with wildfire support, we focus on connecting affected communities and civilian volunteers.'),
      headers:[B('原始要求','Brief requirement'),B('FireLink 的回应','Our design response')],
      rows:[
        [B('理解选题与设计必要性','Explain the need'),B('为什么参与意愿还需要任务化组织与人工确认？','Why do willingness and availability still need structured tasks and human review?')],
        [B('明确用户旅程','Show a clear user journey'),B('志愿者与组织者在哪些时刻需要彼此的信息？','When do volunteers and organizers need information from one another?')],
        [B('页面流程与设计亮点','Explain flows and design decisions'),B('如何把发布、授权、审核与交接连成一条路径？','How do publishing, consent, review and handoff connect?')],
        [B('易操作与可靠性','Ease of use and reliability'),B('高压力情境下，如何减少误解、误操作与重复处理？','How can we reduce ambiguity, mistakes and duplicate work under pressure?')],
        [B('英文与 UX Manual','English and UX Manual'),B('客户端支持常见中英文变体；将可用性原则落实到具体交互。','Clients support common Chinese and English locale variants; usability principles translated into concrete interactions.')]
      ],
      source:B('课程简报 p.16–19、30、33–34、44、47','Course brief pp.16–19, 30, 33–34, 44, 47'),
      notes:'原始题目明确允许软件和系统方案，要求从用户需求、环境条件和作业流程出发。因此我们不只展示一组页面，而是先回答它如何形成服务。课程要求也强调用户旅程、页面流程、易操作和可靠性，这些会分别落实在后面的服务蓝图、双端流程与具体机制中。客户端支持常见中英文变体。我们将这些要求落实到具体页面和交互机制中，后面逐一展开。'
    },
    {
      id:'problem', section:0, layout:'columns', time:45,
      title:B('热心参与，需要跨过三道信息门槛','Willingness alone leaves three information gaps'),
      lead:B('围绕参与者与组织者的交接，梳理需求、报名与结果三类信息。','Analyze the handoff between volunteers and organizers through needs, applications and outcomes.'),
      items:[
        [B('需求是否具体','Is the request specific?'),B('“需要支援”不足以判断是否适合。参与者还需要知道做什么、何时去、在哪里、需要什么能力。','“Help needed” does not tell a person whether they fit. Work, time, place and capabilities must be clear.')],
        [B('报名是否可判断','Can an application be assessed?'),B('不同任务需要不同资料。重复询问与零散信息让组织者难以持续比较与确认。','Different tasks need different evidence. Repeated questions and fragmented information hinder review.')],
        [B('结果是否可追踪','Is the outcome clear?'),B('报名不等于确认参与。审核结果、撤回与未获确认的申请都需要明确状态。','Applying is not confirmation. Decisions, withdrawals and unconfirmed applications need explicit states.')]
      ],
      source:B('设计假设　课程简报与双角色任务分析','Design hypotheses　Course brief and role-based task analysis'),
      notes:'从课程场景和双角色的任务分析中，我们提炼出三道信息门槛。第一道门槛是任务不够具体，热心的人不一定知道自己适不适合。第二道门槛是信息零散，组织者需要反复追问。第三道门槛是状态不明确，报名人不知道是否被确认。这三点分别对应结构化任务、按任务授权和可追踪结果，也成为后续评价方案是否有效的依据。'
    },
    {
      id:'scope', section:0, layout:'scope', time:40,
      title:B('服务在可信交接处完成','The service completes at a trusted handoff'),
      lead:B('接入组织原有工作方式，让新工具承担最需要标准化的一段。','Fit existing organizational practices by structuring the part that needs a shared process.'),
      items:[
        [B('FireLink 内完成','Within FireLink'),B('发布具体支援任务\n按任务提交授权资料\n人工审核与人数控制\n通知结果、开放获授权的联系方式','Publish specific support tasks\nSubmit task-specific consent\nReview people and manage capacity\nNotify outcomes and release permitted contacts')],
        [B('交接至组织已有渠道','Handoff to existing channels'),B('电话、微信及其他既有联络方式\n由组织进一步确认人员与安排\n沿用其现有的现场协调方案','Phone, WeChat and other established channels\nThe organization confirms people and arrangements\nExisting field coordination practices continue')]
      ],
      callout:B('以“审核通过、授权联系”作为清楚的交接点，让双方进入组织熟悉的工作方式。','Acceptance and consented contact create a clear handoff into the organization’s familiar working practices.'),
      source:B('团队确认的范围　面向外围支援任务的设计定位','Team-confirmed scope　Focus on civilian support tasks'),
      notes:'这是本项目一个主动的取舍。很多组织已经有成熟的沟通渠道，现场条件又高度复杂，把所有现场问题都搬进一个新平台，会增加采用成本，也超出本题要解决的重点。我们选择把需求、申请、审核和授权联系做好，在双方形成可信连接时完成交接。系统中的通过，只表示组织者接受了这份支援申请，不能被理解为专业资质认证或火场准入。'
    },
    {
      id:'actors', section:1, layout:'table', time:40,
      title:B('同一项支援，连接三种责任','One support task, three responsibilities'),
      headers:[B('参与方','Actor'),B('需要做出的判断','Decision to make'),B('系统提供的支持','System support')],
      rows:[
        [B('志愿者','Volunteer'),B('这项任务是否适合我？我愿意提供哪些资料？','Does this task fit me? What am I willing to share?'),B('任务详情、档案复用、逐项授权、申请记录','Task details, reusable profile, granular consent, application history')],
        [B('组织者／审核员','Organizer / reviewer'),B('需求是否清楚？申请是否适合？谁可以联系？','Is the need clear? Does this person fit? Who may contact them?'),B('任务编辑、分工权限、连续审核、结果与通知','Task authoring, scoped roles, continuous review, outcomes and notices')],
        [B('需求方／受影响社区','Community / request owner'),B('需要哪些外围支援？由谁负责确认与接洽？','What support is needed, and who is responsible for coordination?'),B('通过组织者转化为事件下的具体任务','Needs become specific tasks under a shared incident')]
      ],
      callout:B('组织承担判断与联络责任；平台提供统一的信息结构与操作记录。','Organizations remain responsible for decisions and coordination; the platform structures information and records actions.'),
      source:B('课程简报 p.16–19；shared/organizer.ts；organizer/src/app.ts','Course brief pp.16–19; shared/organizer.ts; organizer/src/app.ts'),
      notes:'我们把参与者、组织者和需求方的责任分别梳理。志愿者需要判断适配性并决定分享范围；组织者负责把需求翻译成任务、审核申请并接手后续联系；需求方或社区则通过组织者表达需要。系统为这些不同责任提供信息结构，但不替代组织的判断。具体实现中又把组织管理、任务管理和审核角色分开，让分工和联系方式访问权限对应起来。'
    },
    {
      id:'journey', section:1, layout:'journey', time:60,
      title:B('把每一个等待，接到明确的下一步','Every waiting point has a clear next step'),
      lead:B('贯穿场景：林缘火情外围支援演练，招募物资整理、运输与信息登记志愿者。','Walkthrough: a simulated wildfire-edge support effort recruiting for supplies, transport and registration.'),
      headers:[B('阶段','Stage'),B('发现需求','Discover'),B('判断任务','Assess'),B('提交申请','Apply'),B('等待审核','Wait'),B('接收结果','Receive')],
      rows:[
        [B('志愿者行为','Volunteer'),B('按地区浏览事件','Browse local incidents'),B('核对时间、能力与地点','Check time, skills, location'),B('选择资料并授权','Choose and consent to data'),B('查看状态／必要时撤回','Track or withdraw'),B('通过后进入既有联络渠道','Join existing channels if accepted')],
        [B('主要疑问','Question'),B('哪里需要我？','Where can I help?'),B('我适不适合？','Am I a good fit?'),B('会分享什么？','What will be shared?'),B('有结果了吗？','Has a decision been made?'),B('接下来联系谁？','Who do I contact next?')],
        [B('设计回应','Response'),B('事件聚合任务','Tasks grouped by incident'),B('结构化任务信息','Structured task details'),B('逐项授权与必填提示','Granular consent'),B('申请状态与撤回','Visible state and withdrawal'),B('结果通知与联系方式交接','Outcome and contact handoff')]
      ],
      source:B('目标用户旅程　林缘火情外围支援演练','Target user journey　Simulated wildfire-edge support'),
      notes:'我们用外围支援演练作为贯穿场景。志愿者先在地区与事件中找到机会，再查看具体任务。如果符合时间和能力条件，才选择资料并授权报名。等待阶段可以查看状态或撤回，结果阶段知道自己是否被确认。这个旅程的重点是每一步都能回答一个具体疑问，而不是增加更多页面。例如授权页回答分享什么，申请页回答是否有结果，结果页回答如何进入后续联络。'
    },
    {
      id:'blueprint', section:1, layout:'blueprint', time:65,
      title:B('服务蓝图让前台承诺有后台支撑','A service blueprint connects promise and delivery'),
      headers:[B('服务层','Service layer'),B('发布需求','Publish'),B('报名授权','Apply'),B('审核确认','Review'),B('结果交接','Handoff')],
      rows:[
        [B('志愿者可见','Volunteer-facing'),B('事件与任务详情','Incident and task details'),B('档案、必填项、授权范围','Profile, required fields, consent'),B('待审核／可撤回','Pending / withdrawal'),B('结果、回应与联系入口','Outcome, response, contact route')],
        [B('组织者操作','Organizer actions'),B('建任务、设人数与时间','Set work, capacity and times'),B('设置任务资料要求','Specify required information'),B('核对资料、决定、填写回应','Inspect, decide, respond'),B('在已有渠道接洽','Continue in established channels')],
        [B('后台支撑','Backstage'),B('组织资格与发布校验','Organization and publish checks'),B('保存本次授权快照','Save consent snapshot'),B('权限、容量、状态冲突校验','Check access, capacity and state'),B('结果通知、授权读取与审计','Notify, disclose by consent, audit')]
      ],
      callout:B('关键服务证据：任务说明 → 授权记录 → 审核结果 → 联系方式交接。','Service evidence: task description → consent record → review outcome → contact handoff.'),
      source:B('server/src/organizer-api.ts；server/src/domain.ts；server/test/organizer.test.ts','server/src/organizer-api.ts; server/src/domain.ts; server/test/organizer.test.ts'),
      notes:'蓝图把同一件事分成志愿者看到的界面、组织者完成的工作和后台保障。以审核为例，志愿者看到待审核状态，组织者看到授权资料，后台还必须校验角色、任务人数和最新申请状态。只有三层一致，界面上的承诺才成立。最终形成的不是一个聊天群链接，而是一条有任务依据、有授权记录、有审核结果的信息链，然后再将双方交接到既有渠道。'
    },
    {
      id:'page-flow', section:1, layout:'flow', time:55,
      title:B('双端通过同一份申请相互衔接','Two interfaces meet at one application'),
      lanes:[
        {label:B('组织者','Organizer'),nodes:[B('开始／事件','Home / incidents'),B('新建任务','Create task'),B('编辑与发布','Edit & publish'),B('报名审核','Review'),B('通过并通知','Accept & notify')]},
        {label:B('志愿者','Volunteer'),nodes:[B('发现事件','Discover'),B('任务详情','Task details'),B('授权报名','Consent & apply'),B('申请记录','Application'),B('结果与联系','Outcome & contact')]}
      ],
      branches:[B('资料不完整：返回补充后提交','Incomplete information: complete before submitting'),B('待审核：可撤回；未通过：保留结果','Pending: may withdraw; declined: retain the outcome'),B('任务结束仍待审核：自动过期并通知','Still pending when the task ends: expire and notify')],
      callout:B('联系方式交接后，双方进入组织现有沟通渠道。','After the contact handoff, both parties continue in the organization’s existing channels.'),
      source:B('页面流程：organizer/src/app.ts；presentation/proposal/scenes.ts；移动端页面','Page flow: organizer/src/app.ts; presentation/proposal/scenes.ts; native client views'),
      notes:'这张页面流程图对应老师要求的页面关系。上方是组织者：从事件与开始页进入任务创建，完成编辑后发布，然后在审核页处理申请。下方是志愿者：发现、看详情、授权报名、查看申请、接收结果。两端通过同一份申请的数据相连。主路径之外也有资料不完整、撤回、未通过和过期分支。最后的联系进入原有渠道，整个路径因此有明确完成点。'
    },
    {
      id:'information-architecture', section:2, layout:'table', time:35,
      title:B('工作台按照组织者的工作来组织','The workspace follows the organizer’s work'),
      headers:[B('入口','Destination'),B('回答的问题','Question it answers'),B('关键动作','Key actions')],
      rows:[
        [B('开始','Home'),B('现在优先处理什么？','What needs attention now?'),B('筛选事件、排序待处理任务','Filter incidents and prioritize tasks')],
        [B('任务','Tasks'),B('正在招什么人，进展如何？','What are we recruiting for?'),B('编辑、发布、暂停、截止、归档','Edit, publish, pause, close, archive')],
        [B('报名审核','Applications'),B('谁适合这项任务？','Who fits this task?'),B('比较要求、查看授权资料、回复','Inspect requirements, data and respond')],
        [B('事件','Incidents'),B('哪些任务属于同一需求背景？','Which tasks share a context?'),B('维护地点与事件信息、查看关联任务','Maintain incident context and linked tasks')],
        [B('已发送通知／组织设置','Notices / organization'),B('做过什么决定，谁有什么权限？','What was communicated? Who has access?'),B('回看通知、分工、联系方式与成员管理','Inspect notices, roles, contacts and members')]
      ],
      source:B('organizer/src/app.ts　当前工作台导航','organizer/src/app.ts　Current workspace navigation'),
      notes:'信息架构按组织者工作顺序展开。开始页解决优先级，任务页管理招募本身，报名审核聚焦逐份判断，事件提供跨任务背景，通知和组织设置负责追溯与分工。这种安排让不同频率、不同对象的操作有各自的位置。我们没有把所有信息压在一个巨大的仪表盘里，而是让入口对应清晰的问题，再通过任务与申请之间的链接形成连续操作。'
    },
    {
      id:'dashboard', section:2, layout:'screen', time:45,
      title:B('先看到需要处理的任务','Start with the tasks that need attention'),
      image:'organizer-dashboard.webp',
      items:[
        [B('先限定事件','Focus the context'),B('在同一工作区筛选当前关注的事件。','Filter the incidents relevant to the current work.')],
        [B('按工作压力排序','Prioritize the work'),B('最近更新、待审核人数、距截止时间。','Sort by updates, pending applicants or time to deadline.')],
        [B('直接进入处理','Act from the overview'),B('草稿继续编辑，待审核任务进入具体申请。','Resume a draft or open the applications for a task.')]
      ],
      source:B('当前工作台实拍　本地隔离演练数据','Current application capture　Isolated synthetic drill data'),
      notes:'开始页首先帮助组织者确定下一步。上方先选事件，减少无关任务的干扰；下方按最近更新、待审核人数和截止时间排序，适应不同工作压力。需要补充信息时进入草稿，有待审申请时直接进入审核。右侧动态帮助理解刚刚发生了什么。设计的价值在于缩短从发现问题到进入处理的路径。'
    },
    {
      id:'incidents', section:2, layout:'screen', time:40,
      title:B('事件提供背景，任务承载行动','Incidents give context; tasks define action'),
      image:'organizer-events.webp',
      items:[
        [B('共享背景','Shared context'),B('一次事件可以关联多个具体支援任务。','One incident can contain multiple specific support tasks.')],
        [B('地点与地区','Location context'),B('事件地点帮助理解需求发生在哪里。','An incident location makes the setting understandable.')],
        [B('分层管理','Separate responsibilities'),B('事件说明背景；人数、要求、时间与负责人属于任务。','Capacity, requirements, schedules and owners belong to tasks.')]
      ],
      source:B('当前工作台实拍　合成演练数据　地图 © OpenStreetMap contributors','Current application capture　Synthetic drill data　Map © OpenStreetMap contributors'),
      notes:'我们把事件和任务拆成两个层级，因为它们回答不同的问题。事件回答发生了什么、在哪里，任务回答需要谁来做什么。例如同一场林缘火情可以有物资整理、运输与登记三个任务。它们共享背景，但能力、时间、人数和负责人不同。这样既避免把每项工作重复描述成一个新事件，也避免用一条笼统的招募承载所有需求。地图帮助组织者理解位置，关联任务则把地点背景连接到具体工作。'
    },
    {
      id:'authoring', section:2, layout:'screen', time:50,
      title:B('把一条招募，写成可判断的任务','Turn a request into an assessable task'),
      image:'organizer-editor.webp',
      imagePosition:'left bottom',
      items:[
        [B('分组填写与预览','Write and preview'),B('基本信息、时间地点、内容与资料分组填写，右侧预览任务说明。','Group task information and preview what volunteers will read.')],
        [B('按任务补充资料','Task-specific questions'),B('自定义“可参与时段”“相关支援经验”等文字填写项，补充通用档案。','Add availability and experience questions alongside reusable profile data.')],
        [B('保存与授权保持一致','Reliable saving'),B('草稿自动保存；已有报名后锁定资料要求，保留申请时的依据。','Drafts autosave. Requirements lock once applications exist.')]
      ],
      source:B('当前工作台实拍；organizer/src/editor.ts','Current application capture; organizer/src/editor.ts'),
      notes:'任务编辑将工作、安排、详细说明和资料要求分成四组，右侧可以预览任务说明。通用档案能够复用，针对当前任务还可以增加文字填写项。比如这次物资整理，我们增加“可参与时段”和“相关支援经验”，让组织者获得具体的判断依据。这些答案随本次报名保存，进入审核页后可以逐项核对。草稿自动保存，已发布内容手动保存，多人编辑时会提示版本冲突。已有报名后，包括自定义项目在内的资料要求一起锁定，保留申请时的条件。'
    },
    {
      id:'task-content', section:2, layout:'screen', time:40,
      title:B('任务内容支持参与前的判断','Task details support an informed decision'),
      image:'organizer-task.webp',
      items:[
        [B('工作可理解','Understand the work'),B('在指定支援点清点、分类与打包物资。','Count, sort and pack supplies at an agreed support point.')],
        [B('安排可核对','Check the arrangement'),B('分别说明任务开始、结束、报名截止与集合地点。','Distinguish start, end, application deadline and meeting point.')],
        [B('边界可确认','Know the boundaries'),B('演练任务明确外围支援范围，等待组织者确认后行动。','The drill describes support boundaries and asks volunteers to wait for confirmation.')]
      ],
      source:B('真实任务页面 + 经授权整理的本地演练文案','Implemented task page + authorized synthetic drill content'),
      notes:'这页用演练数据说明好的任务信息应该帮助报名者作判断。工作内容不能只写“需要志愿者”，而要说明实际要做什么。时间要分清任务开始、结束和报名截止，地点要有具体接洽方式。外围支援的行动边界也写进说明。界面支持文字、图片、视频、表格与地图等内容块，但本次演示选择简洁文字，重点是让这些信息足以支持参与判断。'
    },
    {
      id:'review', section:2, layout:'screen', time:55,
      title:B('让审核围绕任务与授权资料展开','Review the person against the task'),
      image:'organizer-review.webp',
      imagePosition:'left 40%',
      items:[
        [B('连续审核','Stay in the review flow'),B('申请列表与详情并置，支持上一份、下一份。','Keep the queue and detail together, with previous and next navigation.')],
        [B('有依据地决定','Decide with context'),B('回看任务要求，核对授权档案，以及可参与时段、支援经验等本次答案。','Compare task requirements with the shared profile and submitted answers on availability and experience.')],
        [B('回应与内部备注分开','Separate audiences'),B('给志愿者的回应可发送，内部备注仅用于组织协作。','The response goes to the volunteer; internal notes stay with the organization.')]
      ],
      source:B('当前工作台实拍；organizer/src/app.ts　reviewDetail','Current application capture; organizer/src/app.ts　review detail'),
      notes:'审核页把列表和详情放在一起，左侧保留队列，右侧集中显示本次申请资料。这里能对应看到任务创建时设置的两个问题：可参与时段和相关支援经验。审核员把答案与任务安排对照，再结合授权档案作判断；这些答案是本次提交的记录。通过操作有明确确认，并产生结果通知。给志愿者的回应与内部备注分开：前者说明结果，后者帮助组织内部协作。'
    },
    {
      id:'consent', section:2, layout:'table', time:60,
      title:B('先判断是否匹配，再开放必要联系','Assess the match before sharing contacts'),
      lead:B('授权属于一次申请，联系方式读取还要经过角色权限校验。','Consent belongs to an application; contact access also requires role authorization.'),
      headers:[B('信息／状态','Information / state'),B('待审核','Pending'),B('通过且具备访问权限','Accepted + permitted role'),B('未通过／撤回／过期','Declined / withdrawn / expired')],
      rows:[
        [B('授权资料与任务问答','Shared profile and task answers'),B('在任务权限内用于审核','Used for task-scoped review'),B('保留申请依据','Retained as application context'),B('保留相应结果记录','Retained with the outcome')],
        [B('授权的联系方式','Consented contact methods'),B('不开放','Hidden'),B('按授权范围开放','Only consented methods exposed'),B('不开放','Hidden')],
        [B('组织内部备注','Internal notes'),B('组织内部','Organization only'),B('组织内部','Organization only'),B('组织内部','Organization only')],
        [B('志愿者收到的内容','Volunteer receives'),B('提交状态与后续结果','Submission state and later outcome'),B('审核结果与对外回应','Decision and public response'),B('对应状态与结果说明','Status and outcome explanation')]
      ],
      callout:B('已有报名后，通用资料、联系方式与自定义资料要求一并锁定。','Once applications exist, profile, contact and custom-question requirements lock together.'),
      source:B('server/test/organizer.test.ts：联系方式披露、任务权限、授权锁定测试','server/test/organizer.test.ts: disclosure, scoped permissions and consent-lock tests'),
      notes:'隐私不只是一段隐私政策，而是服务流程中的时机设计。待审核阶段需要判断是否匹配，审核员可以查看授权档案和任务问答，联系方式保持隐藏。通过以后，读取联系方式还要同时符合任务访问权限、联系方式权限和志愿者本次授权范围。系统保存本次申请的资料和答案，已有申请后，通用资料、联系方式和自定义项目的要求一起锁定。这个机制让志愿者知道自己交出去什么，也让组织者清楚什么时候能够开始联系。'
    },
    {
      id:'states', section:2, layout:'states', time:55,
      title:B('清晰区分截止、结束与申请结果','Separate deadlines, task endings and outcomes'),
      lead:B('任务状态和报名状态是两套相关、但不同的状态。','Task state and application state are related, but distinct.'),
      items:[
        [B('报名截止','Application deadline'),B('停止新的报名；已提交申请仍可继续审核。','Stop new applications; existing applications can still be reviewed.')],
        [B('任务结束','Task end'),B('仍待审核的申请自动过期，生成对应结果通知。','Pending applications expire and receive an outcome notification.')],
        [B('明确决定','Explicit decision'),B('通过、未通过与撤回保留各自含义；后台校验最新状态。','Accepted, declined and withdrawn remain distinct; the server checks the latest state.')]
      ],
      callout:B('容量限制、重复操作与并发审核在服务端校验，避免界面显示与实际结果脱节。','Server-side capacity and concurrency checks keep the displayed decision consistent with the stored outcome.'),
      source:B('server/src/application-expiry.ts；server/test/organizer.test.ts','server/src/application-expiry.ts; server/test/organizer.test.ts'),
      notes:'截止和结束看起来相似，但会导致不同服务结果。报名截止只是停止接收新申请，组织者仍可能需要处理已提交的申请；任务结束以后，仍待审核的申请应自动过期，避免志愿者一直等待。通过、拒绝和撤回也不能被过期逻辑改写。后台同时检查人数和最新状态，例如志愿者刚撤回，审核员不能用旧页面再把它通过。这里的设计同时需要界面语义和服务端规则。'
    },
    {
      id:'volunteer', section:2, layout:'phones', time:40,
      title:B('志愿者端让每一步都可理解','Make each step understandable for volunteers'),
      phones:[
        {image:'task-light.webp',title:B('先读清任务','Understand the task'),text:B('查看组织者、要求与详细内容。','Read the organizer, requirements and details.')},
        {image:'consent-light.webp',title:B('再决定授权','Choose what to share'),text:B('区分必需资料与可选资料。','Distinguish required and optional information.')},
        {image:'accepted-light.webp',title:B('接收明确结果','Receive a clear outcome'),text:B('审核通过后进入既有联络方式。','Move to existing contact channels after acceptance.')}
      ],
      source:B('Android 客户端　任务详情、授权报名与审核结果','Android client　Task details, application consent and review outcome'),
      notes:'组织者工作台不是独立存在的，它提供的信息最终会被志愿者读到。这三张已有客户端截图展示了对应的三个节点：看清任务、选择授权、接收结果。我们保留原生移动端的阅读和操作习惯，让个人档案可以复用，而具体分享范围仍然在每次报名时决定。客户端还保留申请记录和通知入口，让志愿者能够重新查看自己的报名与结果。'
    },
    {
      id:'handoff', section:2, layout:'screen', time:40,
      title:B('交接之后，沿用组织熟悉的渠道','A deliberate handoff to familiar channels'),
      image:'organizer-notifications.webp',
      items:[
        [B('结果留下记录','Keep an outcome record'),B('组织者可回看已发送通知，志愿者可查看结果。','Organizers inspect sent notices; volunteers can revisit outcomes.')],
        [B('联系方式按授权开放','Release contacts by consent'),B('通过后，由具备权限的成员建立联系。','Authorized members establish contact after acceptance.')],
        [B('衔接已有实践','Fit existing practice'),B('通过后安排与变化，由组织在已有渠道进一步确认。','The organization confirms subsequent arrangements and changes through existing channels.')]
      ],
      source:B('当前通知页实拍；团队确认的交接定位','Current notices capture; team-confirmed handoff model'),
      notes:'这一页展示服务终点。系统把审核结果记录下来，志愿者可以收到结果，组织者可以回看通知；符合权限的成员再按授权联系方式接洽。通过后的排班或安排变化，由组织使用已有渠道确认，这是产品定位的一部分。现有实现对待审核申请发送任务更新通知，而已经通过的参与者进入组织既有沟通流程。因此，我们的下一步迭代也应当改善交接是否清楚，而不是重新建设一整套现场通信工具。'
    },
    {
      id:'visual-system', section:3, layout:'design', time:45,
      title:B('一致的视觉语言，帮助快速识别','Consistency makes the workspace easier to read'),
      image:'organizer-dark.webp',
      items:[
        [B('克制的蓝色主调','A restrained blue palette'),B('主操作、选中项与焦点保持同一语义。','Primary actions, selections and focus share a coherent language.')],
        [B('状态不只靠颜色','More than color'),B('文字、轮廓与选中标记共同表达状态。','Labels, outlines and selection indicators reinforce state.')],
        [B('同一套操作习惯','One interaction vocabulary'),B('复用按钮、输入、筛选、弹窗与错误反馈；支持深浅色与字号调整。','Reuse controls and feedback; support light, dark and larger text.')]
      ],
      source:B('organizer/src/theme.ts；organizer/public/components.css；COMPONENTS.md','organizer/src/theme.ts; organizer/public/components.css; COMPONENTS.md'),
      notes:'视觉系统主要延续组织者工作台的低饱和蓝色、浅色表面和清楚的轮廓。颜色有明确职责，例如主操作与选中态使用统一语义，状态同时配文字而不是只依赖颜色。按钮、输入、筛选、弹窗和错误反馈使用相同组件，减少用户重新学习的成本。深色与大字号模式也属于同一系统。本份汇报沿用这些颜色与字体层级，让设计成果和汇报本身保持一致。'
    },
    {
      id:'iterations', section:3, layout:'table', time:40,
      title:B('迭代把注意力转向实际操作','Iteration focused on actual use'),
      headers:[B('已有材料中的问题','Issue in review records'),B('当前设计回应','Current response'),B('判断价值的方式','How to judge value')],
      rows:[
        [B('信息分散，下一步不够突出','Scattered information and unclear next action'),B('开始页聚焦任务，审核保持列表与详情连续','Task-focused home and continuous queue/detail review'),B('能否直接找到最需要处理的申请','Can the reviewer find the next relevant application?')],
        [B('窄屏与大字号下的布局压力','Narrow-screen and large-text pressure'),B('控件尺寸统一，工具栏重排，窄屏分步显示详情','Shared control sizing, reflow and focused mobile detail'),B('检查真实内容、键盘路径与放大字号','Inspect real copy, keyboard flow and enlarged text')],
        [B('主题、状态和组件不一致','Inconsistent themes, states and components'),B('语义主题、共享组件与固定状态色','Semantic theme, shared components, stable status colors'),B('对比度与组件状态专项检查','Targeted contrast and component-state checks')]
      ],
      source:B('设计评审记录与当前组件实现','Design review records and current component implementation'),
      notes:'设计过程不只是画出第一版。仓库里已经有对桌面、窄屏、深浅色和大字号的评审记录，其中指出过控件挤压、审核动作可读性和信息密度等问题。当前实现通过共享组件、响应式重排与更连续的审核方式回应这些问题。这些评审记录帮助我们把注意力放到真实内容、键盘路径和字号变化，再通过组件与布局调整持续改进。'
    },
    {
      id:'implementation', section:3, layout:'architecture', time:40,
      title:B('双端原型共享同一套业务规则','Both interfaces share the same service rules'),
      layers:[
        {title:B('交互层','Interfaces'),text:B('组织者 Web 工作台　Android 客户端　Apple 客户端','Organizer web workspace　Android client　Apple clients')},
        {title:B('服务与契约','Service & contracts'),text:B('共享 API、任务内容、授权字段与申请状态','Shared APIs, task content, consent fields and application states')},
        {title:B('数据与约束','Data & constraints'),text:B('Cloudflare Workers　D1　R2；权限、容量、状态与记录','Cloudflare Workers　D1　R2; access, capacity, state and records')}
      ],
      callout:B('同一套规则贯穿发布、授权、审核与结果，让双端信息保持一致。','One set of rules connects publishing, consent, review and outcomes across both interfaces.'),
      source:B('仓库目录 organizer / android / apple / server / shared / contracts','Repository: organizer / android / apple / server / shared / contracts'),
      notes:'目前的成果包含双端界面及可运行的业务实现。组织者端是网页，志愿者端有 Android 和 Apple 客户端，背后共享 API、内容结构和业务约束。技术在这里的意义是保证不同界面表达同一件事。例如人数限制不能只在一个按钮上生效，授权条件不能只隐藏在前端。这样，组织者在工作台发布和处理的信息，能够按同一套规则到达志愿者端。'
    },
    {
      id:'verification', section:3, layout:'evidence', time:50,
      title:B('核心规则形成了可复跑的验证','Core service rules have repeatable tests'),
      metrics:[{n:'49',label:B('后端相关测试通过','Relevant backend tests passed')},{n:'4',label:B('配色方案测试通过','Color scheme tests passed')}],
      items:[
        [B('本次实际复跑','Re-run for this review'),B('覆盖权限、授权、人数与状态规则，新增自定义资料与答案快照检查；提供深色模式支持与自动配色方案生成。','Covers access, consent, capacity and state rules, including custom fields and answer snapshots; provides dark mode support and automatic color scheme generation.')],
        [B('规则落到服务端','Rules enforced on the server'),B('通过与撤回冲突、最后名额竞争、授权披露都有明确的预期结果。','Acceptance after withdrawal, competition for the final slot and contact disclosure each have explicit expected outcomes.')],
        [B('验证可持续复用','Reusable verification'),B('保留测试入口与场景，每次迭代都能检查关键业务行为。','Retained scenarios and test entrypoints make core behaviors checkable with each iteration.')]
      ],
      source:B('2026-11-04 本地运行：server/test/{organizer,api}.test.ts；organizer/test/theme.test.ts','Local run 2026-11-04: server/test/{organizer,api}.test.ts; organizer/test/theme.test.ts'),
      notes:'本次为汇报运行的49项相关后端测试，以及4项配色方案测试，全部通过。客户端提供深色模式支持与自动配色方案生成。后端覆盖权限隔离、联系方式开放、人数限制、撤回与过期，也加入了自定义资料的保存、名称校验、报名必填和答案快照检查。新版自定义资料界面还通过了桌面、手机布局与无障碍自动检查。这些工程检查把关键规则固定成可反复验证的场景。接下来可以与组织者进一步验证任务理解、审核判断、授权理解和交接清晰度。'
    },
    {
      id:'next', section:4, layout:'columns', time:45,
      title:B('后续深化，继续围绕招募与匹配','Deepen recruitment and matching'),
      lead:B('以少量组织试点，验证是否真正减少了确认成本。','Start with a small organizational pilot to learn whether the service reduces coordination effort.'),
      items:[
        [B('先验证服务','Validate the service'),B('邀请组织者与志愿者完成同一条流程，观察任务理解、错审、授权误解与交接失败点。','Ask organizers and volunteers to complete the connected flow; observe misunderstandings, wrong decisions and unclear handoffs.')],
        [B('再优化任务表达','Improve task authoring'),B('针对常见外围支援任务沉淀模板与字段解释，降低发布与审核成本。','Develop templates and field guidance for common support tasks to reduce authoring and review effort.')],
        [B('探索机构合作','Explore organizational adoption'),B('与志愿组织、社区及培训伙伴试点；评估维护、审核与支持成本。','Pilot with volunteer organizations, communities and training partners; assess maintenance and support costs.')]
      ],
      source:B('服务试点与机构采用方案','Service pilot and organizational adoption proposal'),
      notes:'后续深化继续围绕同一个定位。先邀请少量组织和志愿者共同走通流程，观察哪些任务说明读不懂、哪些资料不够判断、授权和交接有没有误解。再把常见外围支援需求沉淀成模板，降低使用成本。机构合作是可能的推广方式，我们计划通过试点进一步理解任务维护、审核分工和支持成本。德尔格的安全理念和培训生态可以作为合作讨论方向，具体合作尚未建立。'
    },
    {
      id:'closing', section:4, layout:'closing', time:30,
      title:B('善意被理解，\n支援才有着落。','Support starts with\na shared understanding.'),
      lead:B('清楚的需求　有依据的确认　有边界的联系','Clear needs　Informed decisions　Consented connections'),
      items:[
        [B('对志愿者','For volunteers'),B('知道自己是否适合，知道资料如何被使用。','Know whether the task fits and how information is used.')],
        [B('对组织者','For organizers'),B('用同一套流程表达需求、确认人员并交接联系。','Use one flow to express needs, confirm people and hand off contact.')]
      ],
      source:B('FireLink　邓雪意 24168119　朱禹杭 24168202','FireLink　邓雪意 24168119　朱禹杭 24168202'),
      notes:'最后回到开头的问题：怎样让愿意帮忙的人真正找到合适的地方？FireLink 的回答是把需求说明白，让审核有依据，再以明确的授权建立联系。它帮助志愿者理解参与，也帮助组织者确认人选，并在合适的时机把工作交还给组织熟悉的渠道。我们希望交付一段清楚、可信、容易接入现有实践的服务。'
    },
    {
      id:'firelink', section:4, layout:'brand-end', time:5,
      title:B('FireLink','FireLink'),
      notes:'谢谢大家，欢迎提问。'
    },
    {
      id:'brief-mapping', section:5, layout:'table',
      title:B('备查｜课程要求与成果对应','Appendix | Mapping the brief to outcomes'),
      headers:[B('要求与出处','Requirement / source'),B('对应成果','Deck evidence'),B('说明','Qualification')],
      rows:[
        [B('选题 2.4　p.30','Topic 2.4　p.30'),B('民间志愿者山火支援服务系统','Civilian volunteer wildfire-support service'),B('外围任务招募、匹配与交接','Support recruitment, matching and handoff')],
        [B('以人为本、现实约束　p.17','Human-centered, practical constraints　p.17'),B('角色分析、旅程、服务蓝图','Roles, journey and blueprint'),B('双角色任务分析与目标旅程','Role-based task analysis and target journey')],
        [B('用户旅程与页面流程　p.44','Journey and page flow　p.44'),B('主体第 7–9 页','Main slides 7–9'),B('同时解释正常路径与异常分支','Main path and exception branches')],
        [B('设计亮点　p.44','Design highlights　p.44'),B('主体第 11–20 页','Main slides 11–20'),B('真实实现截图与设计理由','Implemented interfaces and rationale')],
        [B('UX Manual　p.44','UX Manual　p.44'),B('易操作、状态、反馈、对比度、权限','Controls, state, feedback, contrast, permissions'),B('以课程给出的易用性与可靠性原则落实设计','Apply the usability and reliability principles in the course brief')],
        [B('英文／20 分钟以内　p.44、47','English / within 20 min　pp.44, 47'),B('完整双语正文、26 页主线与备查页','Bilingual deck, 26 main slides and appendix'),B('静态截图中的现有产品界面保留中文','Existing product screenshots remain in Chinese')]
      ],
      source:B('1008-BJUT+DRAEGER.pdf　PDF 页码与页面标注一致','1008-BJUT+DRAEGER.pdf　PDF page numbers match printed labels'),
      notes:'课程要求的快速索引。若老师询问英文要求，说明演示正文和讲解标签可完整切换为英文，产品实拍保留当前中文界面。UX Manual 完整手册没有提供，因此当前呈现原则回应而非宣称完整验收。'
    },
    {
      id:'task-lifecycle', section:5, layout:'table',
      title:B('备查｜任务生命周期与报名生命周期','Appendix | Two connected lifecycles'),
      headers:[B('对象','Object'),B('状态','States'),B('含义与约束','Meaning and constraints')],
      rows:[
        [B('任务','Task'),B('草稿 → 招募中','Draft → open'),B('满足发布要求；组织已认证并有联系方式','Validate publishing requirements, organization status and contacts')],
        [B('任务','Task'),B('招募中 ↔ 暂停','Open ↔ paused'),B('暂时停止接收报名，恢复后继续招募','Suspend new enrollment and resume when appropriate')],
        [B('任务','Task'),B('截止招募 → 归档','Closed → archived'),B('结束招募，保留历史任务与结果','Close recruitment and retain task history and outcomes')],
        [B('申请','Application'),B('待审核 → 通过／未通过','Pending → accepted / declined'),B('人工判断、检查容量、生成结果通知','Human review, capacity check and result notification')],
        [B('申请','Application'),B('待审核 → 已撤回','Pending → withdrawn'),B('志愿者撤回后不可被旧审核操作重新通过','A stale review cannot override withdrawal')],
        [B('申请','Application'),B('待审核 → 已过期','Pending → expired'),B('以任务结束时间触发；不覆盖已经明确的决定','Triggered by task end; explicit prior decisions remain intact')]
      ],
      source:B('shared/organizer.ts；server/test/organizer.test.ts','shared/organizer.ts; server/test/organizer.test.ts'),
      notes:'两套状态需要分开解释。任务的截止招募属于招募管理，并不能等同于任务结束。申请自动过期依据任务结束时间。已通过、未通过和已撤回不会被自动过期逻辑覆盖。'
    },
    {
      id:'data-governance', section:5, layout:'table',
      title:B('备查｜每项信息都应有用途与边界','Appendix | Give each data field a purpose'),
      headers:[B('信息','Data'),B('设计用途','Purpose'),B('访问与使用边界','Access boundary')],
      rows:[
        [B('任务时间、地点与人数','Schedule, location, capacity'),B('支持参与判断与组织安排','Support fit and planning'),B('发布前校验，修改需保留清楚状态','Validate publishing; make updates explicit')],
        [B('档案、装备、车辆、技能证明','Profile, equipment, vehicles, evidence'),B('根据任务需要判断适配','Assess task-specific suitability'),B('按任务授权，交由组织者结合任务核对','Task-specific consent, reviewed by the organizer against the task')],
        [B('手机号、微信、邮箱','Phone, WeChat, email'),B('通过后进入既有沟通渠道','Handoff after acceptance'),B('通过 + 相应权限 + 本次授权范围','Acceptance + authorized role + consented methods')],
        [B('对外回应','Volunteer response'),B('说明审核结果','Explain the decision'),B('面向志愿者，可随结果通知','Visible to the volunteer with the outcome')],
        [B('内部备注与操作记录','Internal notes and activity records'),B('组织协作与追溯','Internal collaboration and traceability'),B('区分内外读者；访问与披露留痕','Separate audiences; record access and disclosure')]
      ],
      source:B('申请授权、角色权限与联系方式访问控制','Application consent, role permissions and contact-access controls'),
      notes:'答辩时强调“为了这项任务，为什么需要这项资料”。字段数量不是越多越好，资料用途、访问者和开放时机要对应。当前实现的边界是应用权限与授权逻辑，并不意味着我们已经完成全部合规评估。'
    },
    {
      id:'exceptions', section:5, layout:'table',
      title:B('备查｜异常也需要明确的结果','Appendix | Exceptions need explicit outcomes'),
      headers:[B('情境','Situation'),B('现有处理','Current behavior'),B('服务意义','Why it matters')],
      rows:[
        [B('多人同时通过最后一个名额','Concurrent decisions for the last slot'),B('服务端校验容量与状态','Server checks capacity and state'),B('避免超额确认','Avoid over-acceptance')],
        [B('志愿者撤回后仍有人在旧页面审核','Stale review after withdrawal'),B('拒绝过时的状态转换','Reject stale transitions'),B('尊重志愿者退出','Respect the volunteer’s withdrawal')],
        [B('任务结束仍未审核','Pending at task end'),B('申请自动过期并通知，重复运行不重复通知','Expire and notify once'),B('给等待明确终点','End indefinite waiting')],
        [B('多人编辑同一任务或事件','Concurrent task or incident edits'),B('版本校验与冲突提示','Version checks and conflict feedback'),B('避免静默覆盖','Avoid silent overwrites')],
        [B('网络断开或提交超时','Disconnection or submission timeout'),B('显示连接提示；超时后先刷新确认结果','Show connectivity state; verify outcome before retry'),B('减少重复操作与错误预期','Reduce duplicates and uncertainty')],
        [B('已通过者后续安排变化','Arrangements change after acceptance'),B('组织通过既有联络渠道确认','Organization confirms through existing channels'),B('遵循产品交接边界','Preserve the intended handoff')]
      ],
      source:B('server/test/organizer.test.ts；organizer/src/api.ts；团队确认范围','server/test/organizer.test.ts; organizer/src/api.ts; team-confirmed scope'),
      notes:'异常处理的目标不是宣称任何环境下都可用，而是尽量让结果可解释、可恢复。尤其网络超时不能简单等同于操作失败，用户应该先确认服务端是否已经完成操作。'
    },
    {
      id:'study-plan', section:5, layout:'table',
      title:B('备查｜下一轮用户验证怎么做','Appendix | A practical usability study'),
      lead:B('计划邀请 3–5 名组织者与 5–8 名志愿者，围绕同一组演练任务开展流程验证。','Plan: invite 3–5 organizers and 5–8 volunteers to evaluate the flow using shared drill tasks.'),
      headers:[B('验证任务','Study task'),B('观察与记录','Observe / record'),B('需要回答的问题','Question to answer')],
      rows:[
        [B('发布一项物资整理任务','Publish a supplies task'),B('信息遗漏、求助次数、完成时间','Missing information, help requests, task time'),B('是否能独立写出可判断的任务？','Can an organizer author a usable request?')],
        [B('发现任务并完成授权报名','Find a task and apply'),B('任务理解、必填项错误、授权复述','Comprehension, required-field errors, consent recall'),B('是否理解适配性与分享范围？','Does the volunteer understand fit and data sharing?')],
        [B('审核匹配／不匹配申请','Review fitting and unsuitable applications'),B('错审、反复跳转、遗漏条件','Wrong decisions, navigation loops, missed criteria'),B('是否根据相关资料做出决定？','Are decisions based on relevant information?')],
        [B('收到结果并说明下一步','Interpret the result and next step'),B('能否找对联系人与既有渠道','Correct contact and channel identification'),B('是否清楚何时、如何交接？','Is the handoff understood?')]
      ],
      source:B('建议研究方案；先获取基线，再决定指标目标','Proposed research protocol; establish a baseline before setting targets'),
      notes:'样本人数是下一轮计划，不能作为已经做过调研的证据。先记录基线，再决定是否需要量化目标。除了完成时间，更重要的是任务理解、授权理解和错误判断，因为单纯速度更快并不一定代表服务质量更高。'
    },
    {
      id:'adoption', section:5, layout:'table',
      title:B('备查｜机构采用与 Dräger 的关联','Appendix | Adoption and the Dräger context'),
      headers:[B('问题','Question'),B('提出的方向','Proposed direction'),B('需要验证','To validate')],
      rows:[
        [B('谁采用？','Who adopts?'),B('志愿组织、社区服务组织与支援协调方','Volunteer groups, community organizations and support coordinators'),B('谁维护任务、谁审核、谁接手联系','Ownership of publishing, review and handoff')],
        [B('如何进入日常使用？','How does it fit?'),B('从一次演练或一个常见任务开始','Start with one drill or recurring support task'),B('现有流程与使用成本是否匹配','Fit with existing workflows and effort')],
        [B('与 Dräger 有何关联？','Why relevant to Dräger?'),B('回应简报中的安全、可用性与社区支援；可讨论任务说明和培训资源衔接','Respond to the brief’s safety, usability and community focus; explore task guidance and training links'),B('品牌要求、伙伴意愿、内容责任','Brand requirements, partner interest, content ownership')],
        [B('如何持续维护？','How is it sustained?'),B('探索机构服务、培训合作或公共项目支持','Explore institutional service, training collaboration or public-program support'),B('成本、责任和资源来源；暂无定价与收入结论','Costs, responsibilities and funding; no pricing or revenue conclusion')]
      ],
      source:B('课程简报 p.17–18　机构采用与合作方向探索','Course brief pp.17–18　Adoption and collaboration exploration'),
      notes:'本页用于商业设计方向的追问。我们把采用者、使用者与维护者区分开：组织可能采用并维护系统，志愿者是报名使用者。与 Dräger 的关联来自课题中的安全与社区应对方向，合作和商业模式仍然属于假设，不应把品牌关系说成已经成立。'
    },
    {
      id:'deliverables', section:5, layout:'table',
      title:B('备查｜本次成果可以在哪里核查','Appendix | Where the implementation lives'),
      headers:[B('成果','Deliverable'),B('代码与资料入口','Repository evidence'),B('可核查内容','What can be checked')],
      rows:[
        [B('组织者工作台','Organizer workspace'),'organizer/',B('任务、事件、审核、通知、组织与主题','Tasks, incidents, review, notices, organization and themes')],
        [B('志愿者客户端','Volunteer clients'),'android/　apple/',B('发现、任务详情、档案、授权、申请与通知','Discovery, tasks, profile, consent, applications and notices')],
        [B('服务端与数据','Backend and data'),'server/src/　server/migrations/',B('权限、容量、状态、存储与通知','Access, capacity, state, storage and notifications')],
        [B('共享模型与接口','Shared models and API'),'shared/　contracts/openapi.json',B('跨端任务、内容块、地图和业务契约','Task, content-block, map and service contracts')],
        [B('验证材料','Verification'),'server/test/　organizer/test/',B('业务规则、主题、浏览器与无障碍检查入口','Rules, themes, browser and accessibility checks')],
        [B('结题材料','Final presentation'),'presentation/final/',B('双语正文、静态截图、讲稿与离线版本','Bilingual slides, static captures, notes and offline edition')]
      ],
      source:B('2026-11-04 仓库实现与验证入口','Implementation and verification entrypoints as of 2026-11-04'),
      notes:'如果老师询问完成程度，可以通过这个索引定位。汇报中只把实际复跑的49项后端测试和4项配色方案测试计为本次通过的测试，其他入口作为已有验证资源，不混为本次全部执行。'
    },
    {
      id:'questions', section:5, layout:'qa',
      title:B('备查｜四个关键取舍','Appendix | Four design decisions'),
      items:[
        [B('与已有群聊如何配合？','How does it complement group chat?'),B('群聊擅长持续沟通；FireLink 在此前整理任务、资料与审核结果，再交接到组织原有群聊或电话。','Chat works well for ongoing coordination. FireLink structures tasks, consent and decisions before handing people to established channels.')],
        [B('人工审核的价值是什么？','What does human review contribute?'),B('任务语境、能力证明与组织责任需要人工判断；系统帮助整理依据并约束状态。','Context, evidence and organizational responsibility require human judgment. The system organizes evidence and enforces state rules.')],
        [B('为什么联系方式后开放？','Why delay contact access?'),B('审核前先判断适配，减少不必要的联系方式披露；通过后仍遵循授权与角色权限。','Assess fit first and avoid unnecessary disclosure. Acceptance still requires consent and role-based access.')],
        [B('为什么在通过后交接？','Why hand off after acceptance?'),B('组织已有联络与现场方案；本项目主动聚焦招募、匹配和可信交接，降低接入成本。','Organizations already have communication and field practices. We focus on recruitment, matching and trusted handoff to ease adoption.')]
      ],
      source:B('产品定位、组织采用与设计机制','Product focus, organizational adoption and design rationale'),
      notes:'这些问题围绕主动取舍展开。特别是“为什么不继续做现场调度”，应强调已有工作方式和服务定位，而不是说时间不够。'
    },
    {
      id:'sources', section:5, layout:'sources',
      title:B('备查｜资料与验证来源','Appendix | Sources and verification'),
      items:[
        [B('课程原始材料','Original course material'),B('1008-BJUT+DRAEGER.pdf，48 页。重点：p.16–19 项目背景，p.30 选题，p.33–34 易操作与可靠性，p.44 UI 要求，p.47 时间要求。','1008-BJUT+DRAEGER.pdf, 48 pages. Key sections: pp.16–19 context; p.30 topic; pp.33–34 usability and reliability; p.44 UI criteria; p.47 schedule.')],
        [B('产品事实','Product evidence'),B('当前仓库源码、组件清单、开题场景及静态客户端截图；组织者界面于 2026-11-04 从本地隔离演练工作区截图。','Current source, component inventory, proposal scenes and native screenshots. Organizer captures from an isolated local drill workspace on 2026-11-04.')],
        [B('本次验证','Verification for this deck'),B('后端相关测试 49/49、配色方案测试 4/4 通过；现有设计评审记录支持对组件、交互和响应式布局的迭代。','49/49 relevant backend tests and 4/4 color scheme tests passed. Existing reviews inform component, interaction and responsive-layout iteration.')],
        [B('演练与分析','Drills and analysis'),B('角色任务分析、目标用户旅程与服务蓝图；截图中的事件、组织和人员使用合成演练数据，配合可运行原型展示流程。','Role-based task analysis, target journey and service blueprint. Synthetic incidents, organizations and people demonstrate the flow in a working prototype.')]
      ],
      source:B('BJUT × Dräger 课程设计　FireLink 项目资料','BJUT × Dräger design studio　FireLink project materials'),
      notes:'参考资料按可以核查的范围列出。原始课程简报有 Internal 标记，因此只摘述与设计相关的要求，不复制整份材料或其中个人联系方式。所有场景数据均明确为合成演示，不能被误解为真实火情、真实志愿者或真实合作成果。'
    }
  ]
};
