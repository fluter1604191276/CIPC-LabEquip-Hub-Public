(() => {
  "use strict";
  const all = ["member", "admin", "developer"];
  const managers = ["admin", "developer"];
  const field = (name, label, example, type = "text", options = null) => ({ name, label, example, type, options });
  const step = (action, title, hint, view, extra = {}) => ({ action, title, hint, view, ...extra });
  const bookingFields = [field("date", "预约日期", "tomorrow", "date"), field("start", "开始时间", "09:00", "time"), field("end", "结束时间", "10:00", "time"), field("people", "使用人数", "1", "number"), field("purpose", "使用用途", "课程实验练习", "textarea")];
  const labs = [["demo-lab", "光电实验室"]];
  const lesson = (id, title, description, roles, steps, takeaways) => ({ id, title, description, roles, steps, takeaways });
  const lessons = [
    lesson("orientation", "认识系统界面", "从资源查询到我的预约，熟悉三个最常用的入口。", all, [
      step("nav:equipment", "找到设备台账", "点击虚拟侧栏中的“设备台账”，查看设备名称、编号和可用状态。", "overview"),
      step("nav:calendar", "查看预约日历", "点击“预约日历”。可用设备也可能有预约，具体占用应以日历为准。", "equipment"),
      step("nav:mine", "找到自己的预约", "点击“我的预约”，这里集中显示你提交的设备与会议室预约。", "calendar"),
      step("inspect:mine", "认识预约状态", "核对卡片上的对象、时间和状态，然后点击“已核对”。该按钮仅用于确认本步练习。", "mine", { cta: "已核对" })
    ], ["设备台账用于查设备；预约日历用于查时段。", "我的预约只显示本人提交的预约；状态随时间变化。"]),
    lesson("equipment", "查询并预约设备", "搜索示波器、打开详情，再亲手填写一张预约单。", all, [
      step("nav:equipment", "打开设备台账", "点击左侧“设备台账”，开始查找示例设备。", "overview"),
      step("search:equipment", "搜索示例设备", "在真实台账的搜索框输入“示波器”，等待列表自动筛选。", "search", { fields: [field("query", "搜索设备", "示波器")], cta: "搜索设备", validate: "search" }),
      step("open:equipment", "打开设备详情", "点击搜索结果右侧的“•••”，打开实际的设备详情抽屉，核对资产编号与实验室。", "equipment", { cta: "查看详情" }),
      step("reserve:equipment", "发起设备预约", "确认状态为“可用”，点击“预约此设备”。", "detail", { cta: "预约此设备" }),
      step("submit:booking", "填写预约信息", "展开教学提示中的“填写示例”。日期在将来、结束时间晚于开始时间、用途填写清楚后，提交预约。", "booking", { fields: bookingFields, cta: "提交预约", validate: "booking" }),
      step("nav:mine", "到我的预约核对", "预约已在演示中生效。点击“我的预约”核对刚填写的信息。", "booked"),
      step("verify:booking", "确认预约结果", "检查卡片上的日期、时间和用途，然后点击“信息正确，完成练习”。", "mine", { cta: "信息正确，完成练习" })
    ], ["从台账搜索设备并查看详情。", "预约提交后立即生效；在我的预约核对时间与用途。"]),
    lesson("cancel", "取消本人的预约", "练习取消尚未开始的预约，认识取消后的状态。", all, [
      step("nav:mine", "打开我的预约", "点击“我的预约”。这次使用一条已准备好的本人演示预约。", "overview"),
      step("cancel:booking", "选择要取消的预约", "核对预约是本人创建且尚未开始，然后点击“取消预约”。", "mine", { cta: "取消预约" }),
      step("verify:cancel", "检查取消结果", "卡片显示“已取消”，对应时段已释放。点击“完成练习”。", "cancelled", { cta: "完成练习" })
    ], ["本人尚未开始的预约可以取消。", "取消后应核对“已取消”状态；开始后联系管理员协调。"]),
    lesson("room", "预约会议室", "选择空间、人数和时段，练习容量与时间检查。", all, [
      step("nav:rooms", "打开会议室预约", "点击“会议室预约”，查看开放状态与容量。", "overview"),
      step("reserve:room", "选择示例会议室", "“研讨室 A（演示）”最多容纳 8 人。点击“预约会议室”。", "rooms", { cta: "预约会议室" }),
      step("submit:room", "填写会议安排", "选择将来的日期，填写时段、人数和用途。演示会议室容量为 8 人。", "room-form", { fields: bookingFields.map(f => f.name === "people" ? { ...f, example: "4" } : f), cta: "提交预约", validate: "room" }),
      step("nav:mine", "查看本人预约", "会议室预约已模拟保存。点击“我的预约”。", "room-booked"),
      step("verify:room", "核对会议安排", "核对空间、时段与人数，然后点击“信息正确，完成练习”。", "mine", { cta: "信息正确，完成练习" })
    ], ["会议室必须开放，人数应在容量范围内。", "设备与会议室预约都可以在我的预约中核对。"]),
    lesson("maintenance", "新增维修与保养记录", "为示例设备填写维护类型、状态、费用与说明。", all, [
      step("nav:maintenance", "打开维修与保养", "点击“维修与保养”。记录设备维护过程，便于后续追溯。", "overview"),
      step("new:maintenance", "新建一条记录", "点击“新建记录”，开始录入演示维护记录。", "maintenance", { cta: "新建记录" }),
      step("submit:maintenance", "填写维护记录", "选择设备、记录类型与状态，填写日期、费用和说明；本练习填写一条已完成的保养记录。", "maintenance-form", { fields: [field("equipment", "关联设备", "scope", "select", [["scope", "数字示波器"]]), field("type", "记录类型", "maintenance", "select", [["maintenance", "保养"], ["repair", "维修"]]), field("status", "处理状态", "completed", "select", [["completed", "已完成"], ["in_progress", "处理中"], ["open", "待处理"]]), field("date", "记录日期", "today", "date"), field("cost", "费用（元）", "0", "number"), field("notes", "说明", "清洁探头并完成校准", "textarea")], cta: "保存记录", validate: "maintenance" }),
      step("verify:maintenance", "核对记录", "检查列表中的类型、状态和说明。维修处理中会影响设备可预约状态，实际录入时请认真核对。", "maintenance-saved", { cta: "完成练习" })
    ], ["维护记录应包含设备、类型、状态、日期与说明。", "维护状态会影响设备使用；不要随意修改他人的记录。"]),
    lesson("procurement", "采购与验收", "新增采购记录，再把验收状态更新为已验收。", all, [
      step("nav:records", "打开采购记录", "点击“采购记录”，查看采购与验收信息。", "overview"),
      step("new:procurement", "新建采购记录", "点击“新增记录”，填一条演示设备采购信息。", "records", { cta: "新增记录" }),
      step("submit:procurement", "填写采购信息", "选择设备，填写供应商、采购日期、金额和说明，初始状态选“待验收”。", "procurement-form", { fields: [field("equipment", "关联设备", "scope", "select", [["scope", "数字示波器"]]), field("vendor", "供应商", "教学仪器商（演示）"), field("date", "采购日期", "today", "date"), field("amount", "采购金额（元）", "1200", "number"), field("status", "验收状态", "pending", "select", [["pending", "待验收"]]), field("notes", "备注", "教学设备采购练习", "textarea")], cta: "保存记录", validate: "procurement" }),
      step("accept:procurement", "更新验收状态", "在采购列表的状态下拉框选择“已验收”；与真实系统一样，选择后直接保存。", "procurement-saved", { fields: [field("status", "验收状态", "accepted", "select", [["pending", "待验收"], ["accepted", "已验收"], ["rejected", "验收未通过"]])], cta: "确认验收状态", validate: "accept" }),
      step("verify:procurement", "核对验收结果", "确认列表显示“已验收”。真实系统中，验收结果应与实际收货情况一致。", "procurement-accepted", { cta: "完成练习" })
    ], ["采购信息应记录供应商、日期、金额与说明。", "验收状态需要依据实际情况更新，系统会保留审计记录。"]),
    lesson("members", "创建成员账号", "管理员练习创建账号、分配角色与实验室。", managers, [
      step("nav:members", "打开成员与权限", "点击“成员与权限”。演示里不会读取或创建真实账号。", "overview"),
      step("new:member", "新增成员", "点击“新增成员”。用户名应唯一，角色按工作职责分配。", "members", { cta: "新增成员" }),
      step("submit:member", "填写成员信息", "填写虚构姓名和用户名，选择“普通用户”与演示实验室。本课练习最小必要权限。", "member-form", { fields: [field("name", "姓名", "演示同学"), field("username", "用户名", "demostudent"), field("role", "账号角色", "member", "select", [["member", "普通用户"], ["admin", "系统管理员"]]), field("laboratory", "所属实验室", "demo-lab", "select", labs)], cta: "创建账号", validate: "member" }),
      step("verify:member", "核对账号与首次改密", "核对角色和实验室。真实新账号首次登录需修改初始密码；请通过受控渠道交付账号信息。", "member-saved", { cta: "完成练习" })
    ], ["管理员可创建成员、分配实验室和合适的角色。", "开发者权限另行管理；初始账号首次登录需改密。"]),
    lesson("laboratories", "定义实验室与空间", "新建虚拟实验室，再编辑名称并检查关联提示。", managers, [
      step("nav:members", "打开成员与权限", "点击“成员与权限”，在其中管理“实验室与空间”。", "overview"),
      step("new:lab", "新增实验室", "点击“新增实验室”，为新空间定义名称、编号与别名。", "laboratories", { cta: "新增实验室" }),
      step("submit:lab", "填写空间定义", "按示例填写唯一编号、名称、别名与排序，点击保存。", "lab-form", { fields: [field("name", "实验室名称", "教学实验室（演示）"), field("code", "实验室编号", "DEMO-02"), field("alias", "别名", "教学空间"), field("sort", "排序", "2", "number")], cta: "保存实验室", validate: "lab" }),
      step("edit:lab", "编辑已有实验室", "在新建空间的卡片上点击“编辑”，练习维护已有定义。", "lab-saved", { cta: "编辑" }),
      step("submit:lab-edit", "修改名称与开放状态", "将名称更新为示例名称，保留启用状态后保存。真实改名会同步现有设备与成员归属。", "lab-edit", { fields: [field("name", "实验室名称", "综合教学实验室（演示）"), field("code", "实验室编号", "DEMO-02"), field("alias", "别名", "教学空间"), field("sort", "排序", "2", "number"), field("active", "开放状态", "true", "select", [["true", "启用"], ["false", "停用"]])], cta: "保存修改", validate: "lab-edit" }),
      step("verify:lab", "确认空间已更新", "检查新的名称。停用空间会限制新分配，但保留历史归属；设备和会议室状态需单独管理。", "lab-updated", { cta: "完成练习" })
    ], ["实验室名称、编号、别名和排序均由管理员维护。", "编辑已有定义可更新名称与启用状态；历史关联会保留。"]),
    lesson("upgrade", "演练系统升级", "仅模拟检查、备份、切换与结果核对，不触发实际升级。", ["developer"], [
      step("nav:update", "打开系统升级", "点击“系统升级”。此课程仅演示流程，不连接版本仓库或生产服务。", "overview"),
      step("check:update", "检查更新", "点击“检查更新”，演示将展示一个虚拟的新版本。", "upgrade", { cta: "检查更新" }),
      step("read:update", "阅读版本说明", "先确认兼容性与维护窗口，再点击“已阅读，准备升级”。真实操作应确认备份可用且没有正在录入的人员。", "release", { cta: "已阅读，准备升级" }),
      step("apply:update", "备份并升级（模拟）", "点击真实的“备份并升级”按钮并确认提示。这里使用内存升级任务，仅演示成功结果。", "upgrade-ready", { cta: "备份并升级" }),
      step("verify:update", "核对升级结果", "演示任务已完成。真实升级后还应核对当前版本、登录与业务页面；代码回滚和数据恢复分开处理。", "upgrade-done", { cta: "完成练习" })
    ], ["检查版本 → 阅读说明 → 确认备份与维护窗口 → 提交升级 → 核对结果。", "本课所有状态均为演示；没有创建真实备份或触发部署。"])
  ];
  function roleValue(role) { return all.includes(role) ? role : "member"; }
  function lessonsForRole(role) { return lessons.filter(item => item.roles.includes(roleValue(role))); }
  function createState(role) { return { role:roleValue(role), lessonId:null, stepIndex:0, completed:false, mode:"practice", values:{}, history:[] }; }
  function currentLesson(state) { return lessonsForRole(state.role).find(item => item.id === state.lessonId); }
  function currentStep(state) { return currentLesson(state)?.steps[state.stepIndex] || null; }
  function start(state, id, mode = "practice") {
    const entry = lessonsForRole(state.role).find(item => item.id === id);
    if (!entry) return { ok:false, message:"请从当前角色的教程列表选择课程。" };
    Object.assign(state, createState(state.role), { lessonId:id, mode:mode === "demo" ? "demo" : "practice" });
    return { ok:true, message:"练习开始" };
  }
  function localDate(offset = 0) { const date = new Date(); date.setDate(date.getDate()+offset); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
  function demoValues(state) { return Object.fromEntries((currentStep(state)?.fields || []).map(f => [f.name, f.example === "tomorrow" ? localDate(1) : f.example === "today" ? localDate() : f.example])); }
  function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(`${value}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value; }
  function validateInput(item, values) {
    for (const f of item.fields || []) {
      const value = String(values[f.name] ?? "").trim();
      if (!value) return `请填写“${f.label}”。教学提示中的“填写示例”可以展开查看。`;
      if (f.type === "select" && !f.options.some(([id]) => id === value)) return `请选择有效的“${f.label}”。`;
      if (f.type === "date" && !validDate(value)) return "请选择有效日期。";
      if (f.type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return "请使用有效的小时和分钟。";
      if (value.length > 200) return `“${f.label}”请控制在 200 字以内。`;
    }
    switch (item.validate) {
      case "search": return String(values.query).trim().includes("示波器") && "数字示波器".includes(String(values.query).trim()) ? "" : "本课请搜索“示波器”，再查看这台示例设备。";
      case "booking": case "room": {
        if (new Date(`${values.date}T${values.start}:00`).getTime() <= Date.now()) return "开始时间应在将来，可以使用示例中的明日日期。";
        if (values.end <= values.start) return "结束时间需要晚于开始时间。";
        const people = Number(values.people);
        if (!Number.isInteger(people) || people < 1 || people > (item.validate === "room" ? 8 : 12)) return item.validate === "room" ? "演示会议室容量为 8 人，请填写 1–8 的整数。" : "人数请填写 1–12 的整数。";
        if (String(values.purpose).trim().length < 2) return "请写明用途，例如“课程实验练习”。";
        return "";
      }
      case "maintenance": return Number.isFinite(Number(values.cost)) && Number(values.cost) >= 0 ? "" : "费用应为零或正数。";
      case "procurement": return Number.isFinite(Number(values.amount)) && Number(values.amount) >= 0 ? "" : "金额应为零或正数。";
      case "accept": return values.status === "accepted" ? "" : "本步练习完成验收，请选择“已验收”。";
      case "member":
        if (!/^[a-z][a-z0-9]{1,39}$/.test(values.username)) return "用户名需以小写字母开头，使用 2–40 位小写字母或数字。";
        return values.role === "member" ? "" : "本课创建普通成员，请选择“普通用户”。";
      case "lab": return Number.isInteger(Number(values.sort)) && Number(values.sort) >= 0 && Number(values.sort) <= 999999 ? "" : "排序请填写 0–999999 的整数。";
      case "lab-edit":
        if (!Number.isInteger(Number(values.sort)) || Number(values.sort) < 0 || Number(values.sort) > 999999) return "排序请填写 0–999999 的整数。";
        return values.active === "true" ? "" : "本课保留空间开放，请选择“启用”后保存。";
      default: return "";
    }
  }
  function advance(state, action, values = {}) {
    const item = currentStep(state);
    if (!item || state.completed) return { ok:false, message:"请先选择教程或重新练习。" };
    if (item.action !== action) return { ok:false, message:`还没到这一步。${item.hint}` };
    const error = validateInput(item, values);
    if (error) return { ok:false, message:error };
    if (item.validate === "lab-edit" && String(values.name).trim() === state.values["submit:lab"]?.name) return { ok:false, message:"请为演示实验室填写一个新名称，再保存修改。" };
    state.history.push(JSON.parse(JSON.stringify(state.values)));
    if (item.fields) state.values[action] = Object.fromEntries(item.fields.map(f => [f.name, String(values[f.name]).trim()]));
    state.stepIndex += 1;
    state.completed = state.stepIndex === currentLesson(state).steps.length;
    return { ok:true, message:state.completed ? "练习完成" : "操作正确，继续下一步。" };
  }
  function previous(state) {
    if (!currentLesson(state) || state.stepIndex === 0) return false;
    state.stepIndex -= 1; state.completed = false; state.values = state.history.pop() || {}; return true;
  }
  function restart(state) { return start(state, state.lessonId, state.mode); }

  // These selectors point to the real application, never to a separate imitation UI.
  const controls = {
    'nav:equipment': '.nav-item[data-view="equipment"]', 'nav:calendar': '.nav-item[data-view="calendar"]',
    'nav:mine': '.nav-item[data-view="my-reservations"]', 'nav:rooms': '.nav-item[data-view="meeting-rooms"]',
    'nav:maintenance': '.nav-item[data-view="maintenance"]', 'nav:records': '.nav-item[data-view="records"]',
    'nav:members': '.nav-item[data-view="members"]', 'nav:update': '.nav-item[data-view="update"]',
    'search:equipment': '#directory-search', 'open:equipment': '#equipment-directory [data-equipment-id="scope"] .directory-row-action',
    'reserve:equipment': '#reserve-from-drawer', 'submit:booking': '#reservation-form', 'submit:room': '#reservation-form',
    'cancel:booking': '.my-reservation-cancel[data-reservation-id="demo-booking"]',
    'reserve:room': '.room-reserve-action[data-room-id="room-a"]',
    'new:maintenance': '#open-maintenance-form', 'submit:maintenance': '#maintenance-form',
    'new:procurement': '#open-procurement-form', 'submit:procurement': '#procurement-form',
    'accept:procurement': '.procurement-record-status[data-procurement-record-id="practice-procurement"]',
    'new:member': '#open-member-form', 'submit:member': '#member-form',
    'new:lab': '#open-laboratory-form', 'submit:lab': '#laboratory-form',
    'edit:lab': '.edit-laboratory-action[data-laboratory-id="practice-lab"]', 'submit:lab-edit': '#laboratory-form',
    'check:update': '#update-check', 'apply:update': '#update-apply', 'read:update': '#update-release-notes',
    'inspect:mine': '#my-reservations-list', 'verify:booking': '#my-reservations-list', 'verify:room': '#my-reservations-list',
    'verify:cancel': '#my-reservations-list', 'verify:maintenance': '#maintenance-list',
    'verify:procurement': '#procurement-list', 'verify:member': '#members-list', 'verify:lab': '#laboratory-list', 'verify:update': '#update-status'
  };
  const fieldControls = {
    'search:equipment': { query:'directory-search' },
    'submit:booking': { date:'reservation-date',start:'reservation-start',end:'reservation-end',people:'reservation-people',purpose:'reservation-purpose' },
    'submit:room': { date:'reservation-date',start:'reservation-start',end:'reservation-end',people:'reservation-people',purpose:'reservation-purpose' },
    'submit:maintenance': { equipment:'maintenance-equipment',type:'maintenance-type',status:'maintenance-status',date:'maintenance-date',cost:'maintenance-cost',notes:'maintenance-description' },
    'submit:procurement': { equipment:'procurement-equipment',vendor:'procurement-vendor',date:'procurement-date',amount:'procurement-amount',status:'procurement-status',notes:'procurement-notes' },
    'submit:member': { name:'new-member-name',username:'new-member-username',role:'new-member-role',laboratory:'new-member-laboratory' },
    'submit:lab': { name:'laboratory-name',code:'laboratory-code',alias:'laboratory-alias',sort:'laboratory-sort-order' },
    'submit:lab-edit': { name:'laboratory-name',code:'laboratory-code',alias:'laboratory-alias',sort:'laboratory-sort-order',active:'laboratory-active' }
  };
  // Only the two version-controlled static assets are loaded. No business endpoint is used.
  async function loadAssets(signal) {
    const options = { credentials:'omit', signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) };
    const responses = await Promise.all([fetch('./index.html', options), fetch('./styles.css', options)]);
    if (responses.some(response => !response.ok)) throw new Error('正式界面资源加载失败');
    const [html,css] = await Promise.all(responses.map(response => response.text()));
    if (!html.includes('id="equipment-table"') || !css.includes('.app-shell')) throw new Error('正式界面资源不完整');
    return {html,css};
  }
  function productionDocument(assets) {
    const parsed = new DOMParser().parseFromString(assets.html, 'text/html');
    parsed.querySelectorAll('script,link,base,meta[http-equiv]').forEach(node => node.remove());
    const csp = parsed.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
    csp.content = "default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'";
    parsed.head.prepend(csp);
    const style = parsed.createElement('style'); style.dataset.productionStyle = '';
    style.textContent = assets.css; parsed.head.append(style);
    const highlight = parsed.createElement('style');
    highlight.textContent = '[data-tutorial-target] { outline:3px solid #bf512f !important; outline-offset:4px; } .sidebar [data-tutorial-target] { outline-color:#ffbe8e !important; }';
    parsed.head.append(highlight);
    return '<!doctype html>\n'+parsed.documentElement.outerHTML;
  }

  function mount(document, callbacks = {}) {
    const view = document.defaultView, root = document.querySelector('#classroom');
    const state = createState(document.body.dataset.role);
    const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    const lifetime = new AbortController();
    let runtime=null, stepEvents=null, generation=0, activeDocument=null, timer=null, paused=false, pending=false, disposed=false;
    let onRequestSuccess=null, rebuilding=false, demoActing=false, searchTimer=null, actionTimer=null;
    const listen = (el,type,handler,options={}) => el.addEventListener(type,handler,{...options,signal:lifetime.signal});
    const roleNames = {member:'普通用户',admin:'系统管理员',developer:'开发者'};
    let assetsReady = null;
    function getAssets() {
      if(!assetsReady) {
        assetsReady = callbacks.assets ? Promise.resolve(callbacks.assets) : loadAssets(lifetime.signal);
        assetsReady.catch(()=>{assetsReady=null;});
      }
      return assetsReady;
    }
    getAssets();
    function clearDemo() { if(timer!==null) clearTimeout(timer); timer=null; if(searchTimer!==null) clearTimeout(searchTimer); searchTimer=null; }
    function destroyStage() {
      generation++; clearDemo(); clearTimeout(actionTimer); actionTimer=null; runtime?.destroy(); runtime=null;
      stepEvents?.abort(); stepEvents=null; activeDocument=null; pending=false; rebuilding=false; onRequestSuccess=null;
      const frame = root.querySelector('#production-practice-frame'); if(frame) { frame.onload=null; frame.removeAttribute('srcdoc'); }
    }
    function focusHeading() { view.scrollTo(0,0); root.querySelector('[data-focus]')?.focus({preventScroll:true}); }
    function stageMode(active) { document.body.classList.toggle('in-lesson',active); callbacks.onStageChange?.(active); }
    function catalog() {
      destroyStage(); paused=false; Object.assign(state,createState(state.role)); stageMode(false);
      root.innerHTML = `<section class="intro"><div><p class="eyebrow">边做边学 / LIVE INTERFACE</p><h1 tabindex="-1" data-focus>在真实界面里，练习每一步</h1><p>布局、按钮、表单和交互直接复用正式系统。只有数据是虚构的，教学提示会带你一步步完成。</p></div><span class="role-chip">${roleNames[state.role]} · ${lessonsForRole(state.role).length} 个教程</span></section><section class="catalog" aria-label="教程列表">${lessonsForRole(state.role).map((item,i)=>`<article class="lesson"><header><span class="lesson-number">${String(i+1).padStart(2,'0')}</span><h2>${item.title}</h2></header><p>${item.description}</p><small>${item.steps.length} 步 · 使用正式系统控件</small><div class="lesson-actions"><button class="primary" data-start="${item.id}" data-mode="practice" aria-label="动手练习：${item.title}">动手练习</button><button data-start="${item.id}" data-mode="demo" aria-label="先看演示：${item.title}">先看演示</button></div></article>`).join('')}</section><p class="catalog-note">练习使用独立内存数据。不连接业务接口，不创建真实预约、成员或升级任务；退出后清空练习。</p>`;
      focusHeading();
    }
    function verification(item) { return item.action.startsWith('verify:') || item.action === 'inspect:mine' || item.action === 'read:update'; }
    function coachMarkup(entry,item) {
      const examples = demoValues(state);
      return `<aside class="practice-coach" id="practice-coach"><button class="coach-toggle" data-control="collapse" aria-expanded="true"><span>第 ${state.stepIndex+1} / ${entry.steps.length} 步 · ${esc(item.title)}</span><span aria-hidden="true">−</span></button><div class="coach-body"><p>${esc(item.hint)}</p>${item.fields ? `<details><summary>填写示例</summary><dl>${item.fields.map(f=>`<dt>${esc(f.label)}</dt><dd>${esc(f.options ? f.options.find(([id])=>id===examples[f.name])?.[1] : examples[f.name])}</dd>`).join('')}</dl></details>`:''}<p id="feedback" role="alert"></p><div class="coach-controls">${verification(item) ? `<button class="primary" data-control="verify">${esc(item.cta || '已核对，继续')}</button>`:''}<button data-control="locate">定位操作位置</button><button data-control="previous"${state.stepIndex===0?' disabled':''}>上一步</button><button data-control="restart">重新开始</button>${state.mode==='demo'?`<button data-control="pause">${paused?'继续演示':'暂停演示'}</button><button data-control="practice">自己练习</button>`:''}</div><small>${state.mode==='demo'?'自动演示':'动手练习'} · 仅虚拟数据</small></div></aside>`;
    }
    function showError(text) {
      const element=root.querySelector('#feedback'); if(element) element.textContent=text;
      root.querySelector('#practice-coach')?.classList.remove('collapsed');
      root.querySelector('.coach-toggle')?.setAttribute('aria-expanded','true');
    }
    function readValues(item,doc) {
      if(item.action==='accept:procurement') return {status:doc.querySelector(controls[item.action]).value};
      return Object.fromEntries(Object.entries(fieldControls[item.action] || {}).map(([key,id])=>[key,doc.getElementById(id)?.value || '']));
    }
    function validated(item,values) { const copy = JSON.parse(JSON.stringify(state)); return advance(copy,item.action,values); }
    function advanceUI(values = {}) { advance(state,currentStep(state).action,values); render(); }
    function locate(scroll = true) {
      const item = currentStep(state), doc=activeDocument;
      if(!doc || !item) return;
      doc.querySelectorAll('[data-tutorial-target]').forEach(el=>el.removeAttribute('data-tutorial-target'));
      let target=doc.querySelector(controls[item.action]);
      if(item.action.startsWith('nav:') && doc.defaultView.innerWidth<=760 && !doc.querySelector('.sidebar').classList.contains('mobile-open')) target=doc.querySelector('.mobile-menu');
      if(!target) return;
      target.setAttribute('data-tutorial-target','');
      if(scroll) target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const rect=target.getBoundingClientRect();
      root.querySelector('#practice-coach')?.classList.toggle('coach-left',rect.left+rect.width/2 > doc.defaultView.innerWidth*.5);
    }
    const routes = {overview:'overview',equipment:'equipment',search:'equipment',detail:'equipment',booking:'equipment',booked:'equipment',calendar:'calendar',mine:'my-reservations',cancelled:'my-reservations',rooms:'meeting-rooms','room-form':'meeting-rooms','room-booked':'meeting-rooms',maintenance:'maintenance','maintenance-form':'maintenance','maintenance-saved':'maintenance',records:'records','procurement-form':'records','procurement-saved':'records','procurement-accepted':'records',members:'members','member-form':'members','member-saved':'members',laboratories:'members','lab-form':'members','lab-edit':'members','lab-saved':'members','lab-updated':'members',upgrade:'update',release:'update','upgrade-ready':'update','upgrade-done':'update'};
    async function prepare(doc,item) {
      doc.querySelector(`.nav-item[data-view="${routes[item.view]}"]`).click();
      if(['equipment','detail','booking'].includes(item.view) && state.values['search:equipment']) {
        doc.querySelector('#directory-search').value=state.values['search:equipment'].query;
        doc.querySelector('#directory-search').dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,240));
      }
      if(['detail','booking'].includes(item.view)) {
        doc.querySelector(controls['open:equipment']).click();
        if(item.view==='booking') doc.querySelector('#reserve-from-drawer').click();
      }
      if(item.view==='room-form') doc.querySelector(controls['reserve:room']).click();
      const openForms={'maintenance-form':'#open-maintenance-form','procurement-form':'#open-procurement-form','member-form':'#open-member-form','lab-form':'#open-laboratory-form','lab-edit':controls['edit:lab']};
      if(openForms[item.view]) doc.querySelector(openForms[item.view]).click();
      if(['release','upgrade-ready'].includes(item.view)) {
        doc.querySelector('#update-check').click();
        // Let the real async check handler apply its in-memory response.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    async function render() {
      destroyStage(); const currentGeneration=generation;
      const entry=currentLesson(state), item=currentStep(state);
      if(!entry) return catalog();
      if(state.completed) {
        stageMode(false);
        root.innerHTML=`<section class="done"><span class="success-icon">✓</span><p class="eyebrow">${state.mode==='demo'?'演示结束':'练习完成'}</p><h1 tabindex="-1" data-focus>${entry.title}</h1><p>刚才操作的是与正式系统同源的界面。</p><ul>${entry.takeaways.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><p class="notice">只有虚拟数据发生了变化。真实业务请退出教程后再操作。</p><div class="controls"><button class="primary" data-control="practice">自己再练一次</button><button data-control="previous">回看最后一步</button><button data-control="catalog">返回教程列表</button></div></section>`; focusHeading(); return;
      }
      stageMode(true);
      root.innerHTML=`<div class="practice-topline"><strong>${esc(entry.title)}</strong><span>${state.mode==='demo'?'自动演示':'动手练习'}</span><button data-control="catalog">教程列表</button></div><div id="practice-loading" role="status">正在打开正式界面的演示副本…</div><iframe id="production-practice-frame" title="正式界面演示副本：仅虚拟数据" sandbox="allow-same-origin" hidden></iframe>${coachMarkup(entry,item)}`;
      if(view.innerWidth<=760) { root.querySelector('#practice-coach').classList.add('collapsed');root.querySelector('.coach-toggle').setAttribute('aria-expanded','false'); }
      try {
        const assets=await getAssets();
        if(disposed || generation!==currentGeneration)return;
        const frame=root.querySelector('#production-practice-frame');
        frame.onload=async()=>{
          if(disposed || generation!==currentGeneration || !frame.contentDocument?.querySelector('#equipment-table'))return;
          const doc=frame.contentDocument;
          try {
            const adapter=TutorialAPI.create({role:state.role,values:state.values,lessonId:state.lessonId,stepIndex:state.stepIndex});
            let requestSerial=0;
            const request=async(path,options={})=>{
              const data=await adapter.request(path,options);
              if(generation===currentGeneration && !disposed && !rebuilding && options.method && options.method!=='GET') onRequestSuccess?.(++requestSerial);
              return data;
            };
            rebuilding=true;
            runtime=LabApplication.mount(doc,{tutorial:true,request,confirm:message=>state.mode==='demo' || globalThis.confirm(`演示模式（不会升级真实系统）\n${message}`)});
            await runtime.ready;
            if(disposed || generation!==currentGeneration)return;
            if(!doc.body.classList.contains('authenticated'))throw new Error('演示数据初始化失败');
            await prepare(doc,item);
            if(disposed || generation!==currentGeneration)return;
            rebuilding=false; activeDocument=doc;
            frame.hidden=false; root.querySelector('#practice-loading').hidden=true;
            bindStep(doc,item,currentGeneration); locate(); scheduleDemo();
          } catch(error) { if(generation===currentGeneration && !disposed)showError(error.message || '演示界面准备失败，请重新开始。'); }
        };
        frame.srcdoc=productionDocument(assets);
      } catch(error) { if(generation===currentGeneration && !disposed)showError(error.message || '加载失败，请返回教程重试。'); }
    }
    function bindStep(doc,item,version) {
      stepEvents=new AbortController(); const on=(type,fn)=>doc.addEventListener(type,fn,{capture:true,signal:stepEvents.signal});
      const target=()=>doc.querySelector(controls[item.action]);
      let dispatching=false;
      const reject=event=>{event.preventDefault();event.stopImmediatePropagation();};
      function finishAfterAction(values,requiresWrite) {
        pending=true; let wrote=false; onRequestSuccess=()=>{wrote=true;};
        actionTimer=setTimeout(()=>{
          actionTimer=null; if(disposed || generation!==version)return;
          pending=false;onRequestSuccess=null;
          if(!requiresWrite || wrote) advanceUI(values);
          else showError('操作尚未完成，请检查表单提示后再试。');
        },140);
      }
      function submitForm(button) {
        const form=target(), values=readValues(item,doc), result=validated(item,values);
        if(item.action==='submit:booking' && doc.querySelector('#reservation-equipment').value!=='scope') {showError('本节练习数字示波器，请在“选择设备”中选回数字示波器。');return;}
        if(!result.ok){showError(result.message);return;}
        if(!form.checkValidity()){form.reportValidity();showError('请按正式表单的提示补全或修正信息。');return;}
        finishAfterAction(values,true);
        dispatching=true;
        form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:button}));
        dispatching=false;
      }
      on('click',event=>{
        const el=event.target.closest('button,a,input,select,textarea,label');
        if(!el)return;
        if(pending){reject(event);return;}
        if(el.matches('.mobile-menu') && item.action.startsWith('nav:')) {setTimeout(()=>locate(false),0);return;}
        const t=target();
        if(t?.tagName==='FORM' && t.contains(el)) {
          if(el.matches('button[type="submit"]')) {reject(event);if(state.mode==='practice'||demoActing)submitForm(el);}
          else if(el.tagName==='BUTTON'){reject(event);showError(item.hint);}
          return;
        }
        if(el===t || t?.contains(el)) {
          if(verification(item)) {reject(event);showError('本步只需核对信息，请使用教学提示中的确认按钮。');return;}
          if(el.matches('input,select,textarea,label'))return;
          if(state.mode==='demo' && !demoActing){reject(event);showError('演示正在运行，可以暂停或切换为自己练习。');return;}
          finishAfterAction({},item.action==='cancel:booking'||item.action==='apply:update'); return;
        }
        reject(event);showError(`请先完成当前步骤：${item.hint}`);
      });
      on('submit',event=>{if(!dispatching) {reject(event);if(target()?.tagName==='FORM')submitForm(event.submitter || target().querySelector('[type="submit"]'));}});
      on('input',event=>{
        root.querySelector('#feedback').textContent='';
        if(item.action!=='search:equipment' || event.target!==target() || (state.mode==='demo'&&!demoActing))return;
        clearTimeout(searchTimer);
        searchTimer=setTimeout(()=>{searchTimer=null; const values=readValues(item,doc); if(validated(item,values).ok && doc.querySelector(controls['open:equipment']))advanceUI(values);else showError('没有找到本课的目标设备。请输入“示波器”，等待列表出现数字示波器。');},400);
      });
      on('change',event=>{
        if(target()?.tagName==='FORM' && target().contains(event.target))return;
        if(item.action!=='accept:procurement' || event.target!==target()){reject(event);showError(item.hint);return;}
        if(state.mode==='demo'&&!demoActing){reject(event);return;}
        const values=readValues(item,doc),result=validated(item,values);
        if(!result.ok){reject(event);showError(result.message);return;}
        finishAfterAction(values,true);
      });
      on('keydown',event=>{
        if(event.key==='Escape'){reject(event);leave('close');return;}
        if(event.key==='Enter' && target()?.tagName==='FORM' && event.target.matches('input')) {reject(event);if(state.mode==='demo'&&!demoActing)return;submitForm(target().querySelector('[type="submit"]'));}
      });
    }
    function scheduleDemo() {
      clearDemo();
      if(state.mode!=='demo'||paused||state.completed||document.hidden||!activeDocument)return;
      const version=generation;
      timer=setTimeout(()=>{
        timer=null;if(version!==generation||disposed)return;
        const item=currentStep(state),doc=activeDocument;
        const values=demoValues(state);
        Object.entries(fieldControls[item.action]||{}).forEach(([key,id])=>{const el=doc.getElementById(id);el.value=values[key];});
        if(item.action==='accept:procurement') doc.querySelector(controls[item.action]).value=values.status;
        locate();
        timer=setTimeout(()=>{
          timer=null;if(version!==generation||disposed)return;
          demoActing=true;
          const t=doc.querySelector(controls[item.action]);
          if(verification(item)) advanceUI();
          else if(item.action==='search:equipment') t.dispatchEvent(new Event('input',{bubbles:true}));
          else if(item.action==='accept:procurement') t.dispatchEvent(new Event('change',{bubbles:true}));
          else if(t.tagName==='FORM') t.querySelector('[type="submit"]').click();
          else t.click();
          demoActing=false;
        },2200);
      },1500);
    }
    listen(root,'click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.dataset.start){start(state,button.dataset.start,button.dataset.mode);paused=false;render();return;}
      const control=button.dataset.control;if(!control)return;
      if(control==='collapse'){const card=root.querySelector('#practice-coach');card.classList.toggle('collapsed');button.setAttribute('aria-expanded',String(!card.classList.contains('collapsed')));return;}
      if(control==='locate'){locate();return;}
      if(control==='catalog'){catalog();return;}
      if(control==='pause'){paused=!paused;clearDemo();button.textContent=paused?'继续演示':'暂停演示';if(!paused)scheduleDemo();return;}
      if(control==='verify'){if(!pending && activeDocument)advanceUI();return;}
      if(control==='previous')previous(state);
      if(control==='restart')restart(state);
      if(control==='practice')start(state,state.lessonId,'practice');
      paused=control==='previous'&&state.mode==='demo';render();
    });
    function leave(kind) { const cb=kind==='help'?callbacks.onHelp:callbacks.onClose;destroyStage();stageMode(false);if(cb)cb();else catalog(); }
    listen(document.querySelector('#exit'),'click',()=>leave('close'));
    listen(document.querySelector('#text-guide'),'click',()=>leave('help'));
    listen(document,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();leave('close');}});
    listen(document,'visibilitychange',()=>{if(document.hidden){paused=true;clearDemo();const b=root.querySelector('[data-control="pause"]');if(b)b.textContent='继续演示';}});
    listen(view,'resize',()=>locate(false)); listen(view,'pagehide',destroyStage);
    catalog();
    return ()=>{disposed=true;destroyStage();lifetime.abort();stageMode(false);};
  }
  globalThis.TutorialModel = { lessons, lessonsForRole, createState, start, advance, previous, restart, currentStep, demoValues, mount, loadAssets, productionDocument, controls };
  if(typeof document!=='undefined' && document.querySelector('#classroom')) mount(document);
})();
