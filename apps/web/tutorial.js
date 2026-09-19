(() => {
  "use strict";
  const all = ["member", "admin", "developer"];
  const managers = ["admin", "developer"];
  const field = (name, label, example, type = "text", options = null) => ({ name, label, example, type, options });
  const step = (action, title, hint, view, extra = {}) => ({ action, title, hint, view, ...extra });
  const bookingFields = [field("date", "预约日期", "tomorrow", "date"), field("start", "开始时间", "09:00", "time"), field("end", "结束时间", "10:00", "time"), field("people", "使用人数", "1", "number"), field("purpose", "使用用途", "课程实验练习", "textarea")];
  const labs = [["demo-lab", "光电实验室（演示）"]];
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
      step("search:equipment", "搜索示例设备", "在搜索框输入“示波器”，点击“搜索设备”。真实系统中输入后会自动筛选，这里用按钮确认练习。", "search", { fields: [field("query", "搜索设备", "示波器")], cta: "搜索设备", validate: "search" }),
      step("open:equipment", "打开设备详情", "点击搜索结果中的“查看详情”，核对资产编号与所在实验室。", "equipment", { cta: "查看详情" }),
      step("reserve:equipment", "发起设备预约", "确认状态为“可用”，点击“预约此设备”。", "detail", { cta: "预约此设备" }),
      step("submit:booking", "填写预约信息", "按字段下方示例填写。日期在将来、结束时间晚于开始时间、用途填写清楚后，提交预约。", "booking", { fields: bookingFields, cta: "提交预约", validate: "booking" }),
      step("nav:mine", "到我的预约核对", "预约已在演示中生效。点击“我的预约”核对刚填写的信息。", "booked"),
      step("verify:booking", "确认预约结果", "检查卡片上的日期、时间和用途，然后点击“信息正确，完成练习”。", "mine", { cta: "信息正确，完成练习" })
    ], ["从台账搜索设备并查看详情。", "预约提交后立即生效；在我的预约核对时间与用途。"]),
    lesson("cancel", "取消本人的预约", "练习取消尚未开始的预约，认识取消后的状态。", all, [
      step("nav:mine", "打开我的预约", "点击“我的预约”。这次使用一条已准备好的本人演示预约。", "overview"),
      step("cancel:booking", "选择要取消的预约", "核对预约是本人创建且尚未开始，然后点击“取消预约”。", "mine", { cta: "取消预约" }),
      step("confirm:cancel", "确认取消", "再次核对设备与时间后点击“确认取消”。这是演示额外的核对步骤；真实页面点击“取消”会直接处理。", "confirm-cancel", { cta: "确认取消" }),
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
      step("submit:maintenance", "填写维护记录", "选择设备、记录类型与状态，填写日期、费用和说明；本练习填写一条已完成的保养记录。", "maintenance-form", { fields: [field("equipment", "关联设备", "scope", "select", [["scope", "数字示波器（演示）"]]), field("type", "记录类型", "maintenance", "select", [["maintenance", "保养"], ["repair", "维修"]]), field("status", "处理状态", "completed", "select", [["completed", "已完成"], ["in_progress", "处理中"], ["open", "待处理"]]), field("date", "记录日期", "today", "date"), field("cost", "费用（元）", "0", "number"), field("notes", "说明", "清洁探头并完成校准", "textarea")], cta: "保存记录", validate: "maintenance" }),
      step("verify:maintenance", "核对记录", "检查列表中的类型、状态和说明。维修处理中会影响设备可预约状态，实际录入时请认真核对。", "maintenance-saved", { cta: "完成练习" })
    ], ["维护记录应包含设备、类型、状态、日期与说明。", "维护状态会影响设备使用；不要随意修改他人的记录。"]),
    lesson("procurement", "采购与验收", "新增采购记录，再把验收状态更新为已验收。", all, [
      step("nav:records", "打开采购记录", "点击“采购记录”，查看采购与验收信息。", "overview"),
      step("new:procurement", "新建采购记录", "点击“新增记录”，填一条演示设备采购信息。", "records", { cta: "新增记录" }),
      step("submit:procurement", "填写采购信息", "选择设备，填写供应商、采购日期、金额和说明，初始状态选“待验收”。", "procurement-form", { fields: [field("equipment", "关联设备", "scope", "select", [["scope", "数字示波器（演示）"]]), field("vendor", "供应商", "教学仪器商（演示）"), field("date", "采购日期", "today", "date"), field("amount", "采购金额（元）", "1200", "number"), field("status", "验收状态", "pending", "select", [["pending", "待验收"]]), field("notes", "备注", "教学设备采购练习", "textarea")], cta: "保存记录", validate: "procurement" }),
      step("accept:procurement", "更新验收状态", "查看演示记录，在“验收状态”选择“已验收”，点击确认。真实页面选择状态后会直接保存。", "procurement-saved", { fields: [field("status", "验收状态", "accepted", "select", [["pending", "待验收"], ["accepted", "已验收"], ["rejected", "验收未通过"]])], cta: "确认验收状态", validate: "accept" }),
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
      step("submit:lab-edit", "修改名称与开放状态", "将名称更新为示例名称，保留启用状态后保存。真实改名会同步现有设备与成员归属。", "lab-edit", { fields: [field("name", "实验室名称", "综合教学实验室（演示）"), field("active", "开放状态", "true", "select", [["true", "启用"], ["false", "停用"]])], cta: "保存修改", validate: "lab-edit" }),
      step("verify:lab", "确认空间已更新", "检查新的名称。停用空间会限制新分配，但保留历史归属；设备和会议室状态需单独管理。", "lab-updated", { cta: "完成练习" })
    ], ["实验室名称、编号、别名和排序均由管理员维护。", "编辑已有定义可更新名称与启用状态；历史关联会保留。"]),
    lesson("upgrade", "演练系统升级", "仅模拟检查、备份、切换与结果核对，不触发实际升级。", ["developer"], [
      step("nav:update", "打开系统升级", "点击“系统升级”。此课程仅演示流程，不连接版本仓库或生产服务。", "overview"),
      step("check:update", "检查更新", "点击“检查更新”，演示将展示一个虚拟的新版本。", "upgrade", { cta: "检查更新" }),
      step("read:update", "阅读版本说明", "先确认兼容性与维护窗口，再点击“已阅读，准备升级”。真实操作应确认备份可用且没有正在录入的人员。", "release", { cta: "已阅读，准备升级" }),
      step("apply:update", "备份并升级（模拟）", "点击“备份并升级（模拟）”。真实系统由服务器依次执行备份、测试、切换和健康检查。", "upgrade-ready", { cta: "备份并升级（模拟）" }),
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
      if (!value) return `请填写“${f.label}”。字段下方有练习示例。`;
      if (f.type === "select" && !f.options.some(([id]) => id === value)) return `请选择有效的“${f.label}”。`;
      if (f.type === "date" && !validDate(value)) return "请选择有效日期。";
      if (f.type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return "请使用有效的小时和分钟。";
      if (value.length > 200) return `“${f.label}”请控制在 200 字以内。`;
    }
    switch (item.validate) {
      case "search": return String(values.query).trim().includes("示波器") ? "" : "本课请搜索“示波器”，再查看这台示例设备。";
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
      case "lab-edit": return values.active === "true" ? "" : "本课保留空间开放，请选择“启用”后保存。";
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
  globalThis.TutorialModel = { lessons, lessonsForRole, createState, start, advance, previous, restart, currentStep, demoValues, mount };

  // Trusted host controller: the embedded document itself has scripts disabled.
  function mount(document, callbacks = {}) {
  const window = document.defaultView;
  const listeners = new AbortController();
  const listen = (target, type, callback) => target.addEventListener(type, callback, { signal: listeners.signal });

    const root = document.querySelector("#classroom");
    const state = createState(document.body.dataset.role);
    const roleNames = { member:"普通用户", admin:"系统管理员", developer:"开发者" };
    let demoTimer = null, paused = false;
    const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
    function clearDemo() { if (demoTimer !== null) clearTimeout(demoTimer); demoTimer = null; }
    function focusHeading() { window.scrollTo(0, 0); root.querySelector("[data-focus]")?.focus({ preventScroll:true }); }
    function catalog() {
      clearDemo(); paused = false; Object.assign(state, createState(state.role));
      root.innerHTML = `<section class="intro"><div><p class="eyebrow">边做边学 / INTERACTIVE GUIDE</p><h1 tabindex="-1" data-focus>先在这里练习，再去实际操作</h1><p>选择一个任务，跟着提示点击、输入和核对。每一步都会告诉你怎么做；所有示例都在独立演示区中。</p></div><span class="role-chip">${roleNames[state.role]} · ${lessonsForRole(state.role).length} 个教程</span></section><section class="catalog" aria-label="教程列表">${lessonsForRole(state.role).map((item,i) => `<article class="lesson"><header><span class="lesson-number">${String(i+1).padStart(2,"0")}</span><h2>${item.title}</h2></header><p>${item.description}</p><small>${item.steps.length} 步 · 约 ${Math.ceil(item.steps.length/2)} 分钟</small><div class="lesson-actions"><button class="primary" data-start="${item.id}" data-mode="practice" aria-label="动手练习：${item.title}">动手练习</button><button data-start="${item.id}" data-mode="demo" aria-label="先看演示：${item.title}">先看演示</button></div></article>`).join("")}</section><p class="catalog-note">练习进度仅在本次演示中保留。退出、切换文字指南或角色后会重置。这里没有真实账号、预约、备份或升级操作。</p>`;
      focusHeading();
    }
    function actionButton(action, label, target, primary = false) { return `<button type="button" data-action="${esc(action)}" class="${primary ? "primary " : ""}${target === action ? "target" : ""}">${esc(label)}</button>`; }
    function bookingSummary() {
      const room = state.lessonId === "room";
      const data = state.values[room ? "submit:room" : "submit:booking"] || { date:localDate(1), start:"09:00", end:"10:00", people:"1", purpose:"课程实验练习" };
      return `<strong>${room ? "研讨室 A" : "数字示波器"}（演示）</strong><small>预约人：演示同学（本人）<br>${esc(data.date)} ${esc(data.start)}–${esc(data.end)} · ${esc(data.people)} 人<br>用途：${esc(data.purpose)}</small>`;
    }
    function summaryRows(data, labels) { return `<dl>${Object.entries(labels).map(([key,label]) => `<dt>${esc(label)}</dt><dd>${esc(data[key])}</dd>`).join("")}</dl>`; }
    function formView(item) {
      const examples = demoValues(state);
      return `<form data-action="${item.action}" class="target" novalidate><span class="target-tag">本步：填写下列信息</span><div class="fields">${item.fields.map(f => {
        const saved = state.values[item.action]?.[f.name] || (item.view === "lab-edit" ? (f.name === "active" ? "true" : state.values["submit:lab"]?.[f.name]) : "") || "";
        const example = f.options ? f.options.find(([v]) => v === examples[f.name])?.[1] : examples[f.name];
        const common = `id="practice-${f.name}" name="${f.name}" aria-describedby="example-${f.name}" required`;
        const control = f.type === "select" ? `<select ${common}><option value="">请选择</option>${f.options.map(([value,label]) => `<option value="${esc(value)}"${saved === value ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>` : f.type === "textarea" ? `<textarea ${common} maxlength="200">${esc(saved)}</textarea>` : `<input ${common} type="${f.type}" value="${esc(saved)}"${f.type === "number" ? ' step="any"' : ''} autocomplete="off" maxlength="200">`;
        return `<label class="${f.type === "textarea" ? "wide" : ""}" for="practice-${f.name}">${esc(f.label)}${control}<span class="example" id="example-${f.name}">示例：${esc(example)}</span></label>`;
      }).join("")}</div><button class="primary" type="button" data-submit>${esc(item.cta)}</button></form>`;
    }
    function sceneView(item) {
      const cta = item.cta ? actionButton(item.action, item.cta, item.action, true) : "";
      const scope = `<div class="row"><strong>数字示波器（演示）</strong><small>DEMO-001 · 光电实验室 · 演示老师</small><span class="status">可用</span></div>`;
      switch (item.view) {
        case "overview": return `<h3>总览</h3><p class="muted">欢迎，演示同学。先从侧栏选择本步的入口。</p><div class="stats"><div><small>设备总数</small><strong>3</strong></div><div><small>我的预约</small><strong>1</strong></div></div>`;
        case "equipment": return `<h3>设备台账</h3>${scope}${cta}`;
        case "search": return `<h3>设备台账 · 搜索</h3>${formView(item)}`;
        case "detail": return `<h3>设备详情</h3>${scope}<p class="muted">性能指标：100 MHz / 4 通道<br>共享方式：预约后使用</p>${cta}`;
        case "calendar": return `<h3>预约日历</h3><div class="row"><strong>${localDate(1)} · 明日</strong><small>09:00–10:00 · 数字示波器（演示）</small><span class="status">已预约</span></div><p class="muted">真实日历支持周视图、月视图和单项资源视图。</p>`;
        case "booking": case "room-form": return `<h3>${item.view === "booking" ? "设备预约 · 数字示波器" : "会议室预约 · 研讨室 A"}</h3>${formView(item)}`;
        case "booked": case "room-booked": return `<h3>预约提交成功（模拟）</h3><div class="row">${bookingSummary()}<span class="status">未开始</span></div>`;
        case "mine": return `<h3>我的预约</h3><div class="row">${bookingSummary()}<span class="status">未开始</span></div>${cta}`;
        case "confirm-cancel": return `<h3>确认取消预约</h3><div class="row">${bookingSummary()}</div><p>取消后将释放该时段。本演示不会修改真实预约。</p>${cta} ${actionButton("cancel:back", "暂不取消", item.action)}`;
        case "cancelled": return `<h3>我的预约</h3><div class="row">${bookingSummary()}<span class="status cancelled">已取消</span></div>${cta}`;
        case "rooms": return `<h3>会议室预约</h3><div class="row"><strong>研讨室 A（演示）</strong><small>教学楼 201 · 容量 8 人</small><span class="status">开放中</span></div>${cta}`;
        case "maintenance": return `<h3>维修与保养</h3><p class="muted">记录维修过程、日常保养与处理结果。</p>${cta}`;
        case "maintenance-form": return `<h3>新增维修与保养记录</h3>${formView(item)}`;
        case "maintenance-saved": { const d = state.values["submit:maintenance"] || {}; return `<h3>维修与保养</h3><div class="row"><strong>数字示波器（演示） · ${d.type === "repair" ? "维修" : "保养"}</strong><small>${esc(d.date)} · ${d.status === "completed" ? "已完成" : d.status === "open" ? "待处理" : "处理中"} · ¥${esc(d.cost)}<br>${esc(d.notes)}</small></div>${cta}`; }
        case "records": return `<h3>采购记录</h3><p class="muted">记录采购金额与验收结果。</p>${cta}`;
        case "procurement-form": return `<h3>新增采购记录</h3>${formView(item)}`;
        case "procurement-saved": case "procurement-accepted": { const d = state.values["submit:procurement"] || {}; return `<h3>采购记录</h3><div class="row"><strong>数字示波器（演示）</strong><small>${esc(d.vendor)} · ${esc(d.date)} · ¥${esc(d.amount)}<br>${esc(d.notes)}</small><span class="status">${item.view === "procurement-accepted" ? "已验收" : "待验收"}</span></div>${item.fields ? formView(item) : cta}`; }
        case "members": return `<h3>成员与权限</h3><div class="row"><strong>演示同学</strong><small>demo01 · 普通用户 · 光电实验室（演示）</small></div>${cta}`;
        case "member-form": return `<h3>新增成员</h3>${formView(item)}`;
        case "member-saved": return `<h3>成员已创建（模拟）</h3><div class="row">${summaryRows(state.values["submit:member"] || {}, {name:"姓名",username:"用户名"})}<small>普通用户 · 光电实验室（演示） · 待首次改密</small></div>${cta}`;
        case "laboratories": return `<h3>成员与权限 · 实验室与空间</h3><div class="row"><strong>光电实验室（演示）</strong><small>DEMO-01 · 启用</small></div>${cta}`;
        case "lab-form": case "lab-edit": return `<h3>${item.view === "lab-edit" ? "编辑实验室" : "新增实验室"}</h3>${formView(item)}`;
        case "lab-saved": case "lab-updated": { const d = { ...state.values["submit:lab"], ...(item.view === "lab-updated" ? state.values["submit:lab-edit"] : {}) }; return `<h3>实验室与空间</h3><div class="row">${summaryRows(d, {name:"名称",code:"编号",alias:"别名",sort:"排序"})}<span class="status">启用</span></div>${cta}`; }
        case "upgrade": return `<h3>系统升级（演示）</h3><p>当前：演示版本 A<br>尚未检查版本</p>${cta}`;
        case "release": return `<h3>发现演示版本 B</h3><div class="row"><strong>版本说明（虚构）</strong><p>改进页面交互，兼容已有数据。模拟维护窗口约 1 分钟。</p><small>正式升级先确认备份、兼容性和使用安排。</small></div>${cta}`;
        case "upgrade-ready": return `<h3>准备升级（模拟）</h3><p>演示版本 A → 演示版本 B</p><p class="muted">点击后仅在本页面展示虚拟结果。</p>${cta}`;
        case "upgrade-done": return `<h3>升级完成（模拟）</h3><div class="row"><strong>演示版本 B</strong><small>✓ 虚拟备份完成<br>✓ 发布包测试通过（示例）<br>✓ 切换与健康检查通过（示例）</small></div><p class="muted">没有真实文件、数据库或服务被修改。</p>${cta}`;
        default: return "";
      }
    }
    function render(focus = true) {
      clearDemo();
      const entry = currentLesson(state), item = currentStep(state);
      if (!entry) return catalog();
      if (state.completed) {
        root.innerHTML = `<section class="done"><span class="success-icon" aria-hidden="true">✓</span><p class="eyebrow">${state.mode === "demo" ? "演示结束" : "练习完成"}</p><h1 tabindex="-1" data-focus>${esc(entry.title)}</h1><p>${state.mode === "demo" ? "你已看完操作流程，现在亲手练习一次吧。" : "做得好！你已完成这个任务的关键步骤。"}</p><ul>${entry.takeaways.map(text => `<li>${esc(text)}</li>`).join("")}</ul><p class="notice">这里只操作了虚拟数据。真实业务还需回到系统页面实际提交。</p><div class="controls"><button class="primary" data-control="practice">自己再练一次</button><button data-control="previous">回看最后一步</button><button data-control="catalog">返回教程列表</button></div></section>`;
        if (focus) focusHeading(); return;
      }
      const navs = [["equipment","设备台账"],["calendar","预约日历"],["mine","我的预约"],["rooms","会议室预约"],["maintenance","维修与保养"],["records","采购记录"],...(managers.includes(state.role) ? [["members","成员与权限"]] : []),...(state.role === "developer" ? [["update","系统升级"]] : [])];
      root.innerHTML = `<header class="session-head"><div><h2>${esc(entry.title)}</h2><small>${state.mode === "demo" ? "先看演示 · 自动填写与操作" : "动手练习 · 完成操作后自动进入下一步"}</small></div><div class="controls">${state.mode === "demo" ? `<button data-control="pause">${paused ? "继续演示" : "暂停演示"}</button><button data-control="practice">切换为自己练习</button>` : ""}<button data-control="catalog">教程列表</button></div></header><div class="progress-label"><span>${state.mode === "demo" ? "演示" : "练习"}进度</span><span>第 ${state.stepIndex+1} / ${entry.steps.length} 步</span></div><progress value="${state.stepIndex}" max="${entry.steps.length}" aria-label="教程进度"></progress><div class="classroom"><aside class="coach"><span class="eyebrow">STEP ${String(state.stepIndex+1).padStart(2,"0")}</span><h2 tabindex="-1" data-focus>${esc(item.title)}</h2><p>${esc(item.hint)}</p><p class="tip">${state.mode === "demo" ? "演示会先填入示例，随后执行高亮操作。你可以随时暂停，或切换为自己练习。" : "跟着橙色边框操作。点错也没关系，提示会帮你回到当前步骤。"}</p><div class="controls"><button data-control="previous"${state.stepIndex === 0 ? " disabled" : ""}>上一步</button><button data-control="restart">重新开始</button></div><p class="mode-note">演示数据与真实业务完全分开。</p><p id="feedback" role="alert"></p></aside><section class="workbench" aria-label="虚拟操作区"><header class="workbench-header"><strong>实验室资源平台</strong><span class="badge">虚拟操作区</span></header><div class="workbench-inner"><nav class="sim-nav" aria-label="虚拟系统导航">${navs.map(([id,label]) => actionButton(`nav:${id}`, label, item.action)).join("")}</nav><div class="scene">${sceneView(item)}</div></div></section></div>`;
      if (focus) focusHeading();
      scheduleDemo();
    }
    function showError(message) { const feedback = root.querySelector("#feedback"); if (feedback) { feedback.textContent = message; feedback.scrollIntoView({block:"nearest", behavior:"auto"}); } }
    function perform(action, values = {}) {
      const result = advance(state, action, values);
      if (result.ok) render(); else showError(result.message);
    }
    function scheduleDemo() {
      if (state.mode !== "demo" || paused || state.completed || document.hidden) return;
      demoTimer = setTimeout(() => {
        demoTimer = null;
        const item = currentStep(state);
        if (!item) return;
        const values = demoValues(state);
        for (const [key,value] of Object.entries(values)) { const control = root.querySelector(`[name="${key}"]`); if (control) control.value = value; }
        root.querySelector(".target")?.classList.add("demo-target");
        demoTimer = setTimeout(() => { demoTimer = null; perform(item.action, values); }, 2200);
      }, 1800);
    }
    listen(root, "click", event => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.start) { start(state, button.dataset.start, button.dataset.mode); paused = false; render(); return; }
      const control = button.dataset.control;
      if (control) {
        clearDemo();
        if (control === "catalog") { catalog(); return; }
        if (control === "pause") { paused = !paused; button.textContent = paused ? "继续演示" : "暂停演示"; scheduleDemo(); return; }
        if (control === "practice") { start(state, state.lessonId, "practice"); paused = false; }
        if (control === "restart") { restart(state); paused = false; }
        if (control === "previous") { previous(state); paused = state.mode === "demo"; }
        render(); return;
      }
      if (button.hasAttribute("data-submit")) { submitPractice(button.closest("form")); return; }
      if (button.dataset.action) {
        if (state.mode === "demo") { showError("现在是自动演示。若想亲自操作，请先点击“切换为自己练习”。"); return; }
        if (button.dataset.action === "cancel:back") { previous(state); render(); return; }
        perform(button.dataset.action);
      }
    });
    // The sandbox intentionally disallows native submissions, even to this page.
    function submitPractice(form) {
      if (state.mode === "demo") { showError("先切换为自己练习，再提交表单。"); return; }
      perform(form.dataset.action, Object.fromEntries(new FormData(form)));
    }
    listen(root, "submit", event => event.preventDefault());
    listen(root, "input", () => { const feedback = root.querySelector("#feedback"); if (feedback) feedback.textContent = ""; });
    listen(root, "keydown", event => {
      if (event.key === "Enter" && event.target.matches("form input")) {
        event.preventDefault();
        submitPractice(event.target.closest("form"));
      }
    });
    function leave(type) {
      clearDemo();
      const callback = type === "lab-tutorial:help" ? callbacks.onHelp : callbacks.onClose;
      if (callback) callback(); else catalog();
    }
    listen(document.querySelector("#exit"), "click", () => leave("lab-tutorial:close"));
    listen(document.querySelector("#text-guide"), "click", () => leave("lab-tutorial:help"));
    listen(document, "keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); leave("lab-tutorial:close"); }
      if (event.key !== "Tab") return;
      const items = [...document.querySelectorAll("button:not(:disabled),input,select,textarea")].filter(el => !el.hidden && el.offsetParent !== null);
      const first = items[0], last = items[items.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    listen(document, "visibilitychange", () => {
      if (document.hidden && state.mode === "demo" && !state.completed) { clearDemo(); paused = true; const button = root.querySelector('[data-control="pause"]'); if (button) button.textContent = "继续演示"; }
    });
    listen(window, "pagehide", clearDemo);
    catalog();
    return () => { clearDemo(); listeners.abort(); };
  }
  if (typeof document !== "undefined" && document.querySelector("#classroom")) mount(document);
})();
