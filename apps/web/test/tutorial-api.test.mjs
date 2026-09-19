import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../tutorial-api.js', import.meta.url), 'utf8');
function create(options) {
  const context = {};
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'document', 'window', 'process', 'require']) {
    Object.defineProperty(context, name, { get() { throw new Error(`Unexpected I/O: ${name}`); } });
  }
  vm.runInNewContext(source, context);
  return context.TutorialAPI.create(options);
}
function day(offset = 2) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const booking = () => ({ date: day(), start: '09:00', end: '10:00', people: 1, purpose: '课程实验练习', equipmentId: 'scope' });
const maintenance = () => ({ equipmentId: 'scope', date: day(0), type: 'maintenance', status: 'completed', cost: 0, description: '校准探头' });
const procurement = () => ({ equipmentId: 'scope', date: day(0), vendor: '演示供应商', amount: 1200, status: 'pending', notes: '课堂练习' });
const lab = () => ({ name: '教学实验室', code: 'DEMO-02', alias: '教学空间', sortOrder: 2 });
const post = (api, path, body) => api.request(path, { method: 'POST', body: JSON.stringify(body) });
const patch = (api, path, body = {}) => api.request(path, { method: 'PATCH', body: JSON.stringify(body) });

test('tutorial API loads without browser or I/O and returns production-compatible fake data', async () => {
  const api = create({ role: 'developer', lessonId: 'orientation' });
  assert.equal((await api.request('/auth/session')).role, 'developer');
  assert.equal((await api.request('/equipment')).length, 3);
  assert.equal((await api.request('/equipment'))[0].name, '数字示波器');
  assert.equal((await api.request('/laboratories?includeInactive=true'))[0].id, 'demo-lab');
  assert.equal((await api.request('/meeting-rooms?includeInactive=true'))[0].capacity, 8);
  assert.equal((await api.request('/users')).length, 1);
  const own = await api.request('/my-reservations');
  assert.equal(own.length, 1);
  assert.equal(own[0].resourceType, 'equipment');
  assert.equal(own[0].resourceCode, 'DEMO-001');
  assert.equal(own[0].requesterUserId, 'demo-user');
  for (const path of ['/maintenance-records', '/procurement-records', '/room-reservations']) assert.equal((await api.request(path)).length, 0);
  assert.equal((await api.request('/audit-logs?page=1&pageSize=20')).pagination.total, 0);
});

test('tutorial API rejects unknown routes and methods rather than forwarding requests', async () => {
  const api = create({ role: 'developer' });
  for (const [path, method] of [['/auth/logout', 'POST'], ['/equipment/scope', 'DELETE'], ['/auth/login', 'POST'], ['/update', 'DELETE'], ['/api/equipment', 'GET'], ['https://example.invalid/api', 'GET'], ['//example.invalid/api', 'GET'], ['/equipment/../update', 'POST']]) {
    await assert.rejects(api.request(path, { method }), { code: 'TUTORIAL_ROUTE_DISABLED' });
  }
  for (const body of ['{', 'null', '[]', '"text"']) await assert.rejects(api.request('/reservations', { method: 'POST', body }), { code: 'TUTORIAL_VALIDATION_ERROR' });
  assert.equal(api.snapshot().equipment.length, 3);
});

test('tutorial requests and snapshots are isolated from each other and caller mutations', async () => {
  const a = create(), b = create();
  const resources = await a.request('/equipment'); resources[0].name = 'changed';
  const snapshot = a.snapshot(); snapshot.currentUser.role = 'developer'; snapshot.reservations.length = 0;
  assert.equal((await a.request('/equipment'))[0].name, '数字示波器');
  assert.equal((await a.request('/auth/session')).role, 'member');
  const saved = await post(a, '/reservations', booking()); saved.status = 'cancelled';
  assert.equal((await a.request('/my-reservations'))[0].status, 'approved');
  assert.equal((await b.request('/my-reservations')).length, 0);
  await assert.rejects(a.request('/users'), { status: 403 });
});

test('tutorial equipment creation uses the production payload and remains virtual', async () => {
  const api = create({ role:'member', lessonId:'equipment-create', values:{ 'submit:equipment': { name:'光谱分析仪（演示）', code:'DEMO-004', metric:'400–1100 nm / 高精度', lab:'光电实验室', location:'光电实验室', owner:'演示老师', status:'available' } } });
  const equipment = await api.request('/equipment');
  const item = equipment.find(entry => entry.id === 'practice-equipment');
  assert.equal(item.name, '光谱分析仪（演示）');
  assert.equal(item.code, 'DEMO-004');
  assert.equal(item.lab, '光电实验室');
  assert.equal(item.status, 'available');
  await assert.rejects(post(api, '/equipment', { name:'重复设备', code:'DEMO-004', metric:'x', lab:'光电实验室', owner:'演示老师', status:'available' }), { status:409 });
});

test('tutorial reservations check schedule, resources, capacity and ownership', async () => {
  const api = create();
  const record = await post(api, '/reservations', booking());
  assert.equal(record.id, 'practice-booking');
  assert.equal(record.equipmentName, '数字示波器');
  for (const values of [{ end: '08:00' }, { start: '24:00' }, { people: 13 }, { people: 1.5 }, { people: 0 }, { purpose: '' }, { date: '2026-02-30' }, { date: '2000-01-01' }, { equipmentId: 'laser' }, { equipmentId: 'missing' }]) {
    await assert.rejects(post(api, '/reservations', { ...booking(), ...values }));
  }
  await assert.rejects(post(api, '/reservations', booking()), { code: 'TUTORIAL_RESERVATION_CONFLICT' });
  await assert.rejects(patch(api, '/reservations/demo-booking/cancel'), { status: 403 });
  assert.equal((await patch(api, `/reservations/${record.id}/cancel`)).status, 'cancelled');
  assert.equal((await post(api, '/reservations', booking())).status, 'approved');
  assert.equal((await post(api, '/reservations', { ...booking(), start: '10:00', end: '11:00' })).status, 'approved');
});

test('tutorial room reservations use capacity and production my-reservations fields', async () => {
  const api = create();
  const input = { ...booking(), meetingRoomId: 'room-a', people: 8 };
  await assert.rejects(post(api, '/room-reservations', { ...input, people: 9 }));
  const record = await post(api, '/room-reservations', input);
  assert.equal(record.meetingRoomName, '研讨室 A');
  assert.equal(record.id, 'practice-room');
  const own = await api.request('/my-reservations');
  assert.equal(own[0].resourceType, 'meeting_room');
  assert.equal(own[0].kind, 'room');
  assert.equal(own[0].resourceCode, 'ROOM-A');
  await assert.rejects(post(api, '/room-reservations', input), { status: 409 });
  assert.equal((await patch(api, `/room-reservations/${record.id}/cancel`)).status, 'cancelled');
});

test('tutorial maintenance and procurement mutate only fake records with validation', async () => {
  const api = create({ role: 'admin' });
  for (const values of [{ cost: -1 }, { cost: 'NaN' }, { description: '' }, { status: 'bad' }, { type: 'bad' }, { date: '2026-02-30' }]) await assert.rejects(post(api, '/maintenance-records', { ...maintenance(), ...values }));
  assert.equal((await api.request('/maintenance-records')).length, 0);
  const record = await post(api, '/maintenance-records', { ...maintenance(), status: 'in_progress' });
  assert.equal(record.equipmentStatus, 'maintenance');
  assert.equal(record.createdByName, '演示同学');
  assert.equal((await api.request('/equipment'))[0].status, 'maintenance');
  assert.equal((await patch(api, `/maintenance-records/${record.id}`, { status: 'completed' })).equipmentStatus, 'available');
  for (const values of [{ amount: -1 }, { amount: Infinity }, { vendor: '' }, { status: 'bad' }]) await assert.rejects(post(api, '/procurement-records', { ...procurement(), ...values }));
  const purchase = await post(api, '/procurement-records', procurement());
  assert.equal(purchase.id, 'practice-procurement');
  assert.equal((await patch(api, `/procurement-records/${purchase.id}`, { status: 'accepted' })).status, 'accepted');
  await assert.rejects(patch(api, `/procurement-records/${purchase.id}`, { status: 'bad' }));
  assert.equal((await api.request('/audit-logs?page=2&pageSize=2')).items.length, 2);
});

test('tutorial manager routes reject members, default unknown roles to member and validate creation', async () => {
  const member = create({ role: 'unknown' });
  assert.equal((await member.request('/auth/session')).role, 'member');
  for (const path of ['/users', '/audit-logs', '/laboratories?includeInactive=true', '/meeting-rooms?includeInactive=true', '/update/status', '/update/check']) await assert.rejects(member.request(path), { status: 403 });
  await assert.rejects(post(member, '/users', {}), { status: 403 });
  await assert.rejects(post(member, '/laboratories', lab()), { status: 403 });
  const admin = create({ role: 'admin' });
  const input = { displayName: '演示新同学', username: 'demostudent', role: 'member', laboratoryId: 'demo-lab' };
  for (const values of [{ displayName: '' }, { username: '../root' }, { role: 'developer' }, { laboratoryId: 'missing' }]) await assert.rejects(post(admin, '/users', { ...input, ...values }));
  const user = await post(admin, '/users', input);
  assert.equal(user.id, 'practice-member');
  assert.equal(user.laboratoryName, '光电实验室');
  assert.equal(user.mustChangePassword, true);
  assert.equal(user.password, undefined);
  await assert.rejects(post(admin, '/users', input), { status: 409 });
});

test('tutorial laboratories support create/edit with derived names and inactive filtering', async () => {
  const api = create({ role: 'admin' });
  for (const values of [{ name: '' }, { code: '' }, { sortOrder: -1 }, { sortOrder: 1.5 }, { active: 'false' }]) await assert.rejects(post(api, '/laboratories', { ...lab(), ...values }));
  const record = await post(api, '/laboratories', lab());
  assert.equal(record.id, 'practice-lab');
  await assert.rejects(post(api, '/laboratories', lab()), { status: 409 });
  const updated = await patch(api, '/laboratories/practice-lab', { ...lab(), name: '综合教学实验室', active: false });
  assert.equal(updated.active, false);
  assert.equal((await api.request('/laboratories')).length, 1);
  assert.equal((await api.request('/laboratories?includeInactive=true')).length, 2);
  await patch(api, '/laboratories/demo-lab', { name: '基础实验室', code: 'DEMO-LAB', alias: '基础空间', sortOrder: 1 });
  assert.equal((await api.request('/equipment'))[0].lab, '基础实验室');
  assert.equal((await api.request('/auth/session')).laboratoryName, '基础实验室');
});

test('tutorial upgrade is developer-only and changes virtual status with no external work', async () => {
  await assert.rejects(post(create({ role: 'admin' }), '/update', { version: '0.0.2' }), { status: 403 });
  const api = create({ role: 'developer' });
  assert.equal((await api.request('/update/status')).currentVersion, '0.0.1');
  const check = await api.request('/update/check');
  assert.equal(check.latestVersion, '0.0.2');
  assert.equal(check.updateAvailable, true);
  assert.match(check.releaseNotes, /虚拟版本演练/);
  await assert.rejects(post(api, '/update', { version: '1.4.12' }));
  assert.equal((await post(api, '/update', { version: '0.0.2' })).state, 'completed');
  assert.equal((await api.request('/update/status')).currentVersion, '0.0.2');
  assert.equal((await api.request('/update/check')).updateAvailable, false);
});

test('tutorial saved steps reconstruct virtual records and cancel/upgrade states deterministically', async () => {
  const values = {
    'submit:booking': booking(), 'submit:room': { ...booking(), people: '4' },
    'submit:maintenance': { ...maintenance(), equipment: 'scope', notes: '校准探头' },
    'submit:procurement': { ...procurement(), equipment: 'scope' }, 'accept:procurement': { status: 'accepted' },
    'submit:member': { name: '新同学', username: 'demostudent', role: 'member', laboratory: 'demo-lab' },
    'submit:lab': { ...lab(), sort: '2' }, 'submit:lab-edit': { name: '综合教学实验室', active: 'true' }
  };
  const api = create({ role: 'developer', values });
  values['submit:booking'].purpose = 'external change';
  const s = api.snapshot();
  assert.equal(s.reservations.at(-1).id, 'practice-booking');
  assert.equal(s.reservations.at(-1).purpose, '课程实验练习');
  assert.equal(s.roomReservations[0].id, 'practice-room');
  assert.equal(s.maintenanceRecords[0].id, 'practice-maintenance');
  assert.equal(s.procurementRecords[0].status, 'accepted');
  assert.equal(s.users.at(-1).id, 'practice-member');
  assert.equal(s.laboratories.at(-1).name, '综合教学实验室');
  assert.equal(create({ lessonId: 'cancel', stepIndex: 1 }).snapshot().reservations[0].status, 'approved');
  assert.equal(create({ lessonId: 'cancel', stepIndex: 2 }).snapshot().reservations[0].status, 'cancelled');
  assert.equal(create({ role: 'developer', lessonId: 'upgrade', stepIndex: 4 }).snapshot().updateStatus.state, 'completed');
  assert.equal(create({ role: 'developer', lessonId: 'upgrade', stepIndex: 3 }).snapshot().updateStatus.state, 'idle');
  assert.equal(create().snapshot().procurementRecords.length, 0);
});


test('tutorial rehydrates every editable laboratory field while retaining older minimal lesson values', async () => {
  const added = { name: '教学实验室', code: 'DEMO-02', alias: '教学空间', sort: '2' };
  const edited = { name: '综合教学实验室', code: 'DEMO-03', alias: '综合空间', sort: '42', active: 'true' };
  const full = create({ role: 'admin', values: { 'submit:lab': added, 'submit:lab-edit': edited } });
  const result = (await full.request('/laboratories')).find(item => item.id === 'practice-lab');
  assert.equal(result.name, edited.name);
  assert.equal(result.code, edited.code);
  assert.equal(result.alias, edited.alias);
  assert.equal(result.sortOrder, 42);
  assert.equal(result.active, true);
  const legacy = create({ role: 'admin', values: { 'submit:lab': added, 'submit:lab-edit': { name: edited.name, active: 'false' } } });
  const restored = (await legacy.request('/laboratories?includeInactive=true')).find(item => item.id === 'practice-lab');
  assert.equal(restored.name, edited.name);
  assert.equal(restored.code, added.code);
  assert.equal(restored.alias, added.alias);
  assert.equal(restored.sortOrder, 2);
  assert.equal(restored.active, false);
});

test('tutorial laboratory edit replay retains every visible editable field', async () => {
  const api = create({ role:'admin', values:{
    'submit:lab':{name:'教学空间',code:'LAB-X',alias:'教学',sort:'2'},
    'submit:lab-edit':{name:'综合空间',code:'LAB-Y',alias:'综合',sort:'7',active:'true'}
  }});
  const labs = await api.request('/laboratories?includeInactive=true');
  const edited = labs.find(lab=>lab.id==='practice-lab');
  assert.equal(edited.name,'综合空间'); assert.equal(edited.code,'LAB-Y');
  assert.equal(edited.alias,'综合'); assert.equal(edited.sortOrder,7);
});

test('equipment creation validates all fields atomically and uses active lab associations', async () => {
  const api = create({ role:'admin' });
  const input = { name:'演示仪器',code:'demo-004',metric:'教学测量',lab:'光电实验室',owner:'演示老师',status:'available' };
  const initial = JSON.stringify(api.snapshot());
  for (const patch of [
    {name:' '},{code:''},{metric:''},{owner:''},{lab:'demo-lab'},{lab:'未知实验室'},
    {status:'reserved'},{name:'x'.repeat(201)},{code:'x'.repeat(81)},
    {metric:'x'.repeat(501)},{owner:'x'.repeat(201)},{code:'demo-001'}
  ]) {
    await assert.rejects(post(api, '/equipment', {...input,...patch}));
    assert.equal(JSON.stringify(api.snapshot()), initial, JSON.stringify(patch));
  }
  const addedLab = await post(api, '/laboratories', lab());
  const record = await post(api, '/equipment', {...input,lab:addedLab.name});
  assert.equal(record.laboratoryId, addedLab.id);
  assert.equal(record.code, 'DEMO-004');
  assert.equal(record.location, addedLab.name);
  await patch(api, '/laboratories/'+addedLab.id, {...lab(),active:false});
  const before = JSON.stringify(api.snapshot());
  await assert.rejects(post(api, '/equipment', {...input,lab:addedLab.name,code:'DEMO-005'}));
  assert.equal(JSON.stringify(api.snapshot()), before);
});

test('every business role can create equipment in all four statuses and replay does not duplicate it', async () => {
  for (const role of ['member','admin','developer']) {
    for (const status of ['available','maintenance','disabled','retired']) {
      const values = {name:'自定义演示仪器',code:'demo-004',metric:'自定义指标',lab:'光电实验室',owner:'演示保管人',status};
      const api = create({role});
      const saved = await post(api,'/equipment',values);
      assert.equal((await api.request('/equipment')).length,4);
      assert.equal(saved.status,status);
      const replay = create({role,values:{'submit:equipment':values}});
      const row = (await replay.request('/equipment')).find(item=>item.id==='practice-equipment');
      for (const field of ['name','metric','lab','owner','status']) assert.equal(row[field],values[field]);
      assert.equal(row.code,'DEMO-004');
      assert.equal((await replay.request('/equipment')).length,4);
      row.name='caller mutation';
      assert.equal(replay.snapshot().equipment.find(item=>item.id==='practice-equipment').name,values.name);
      assert.equal((await create({role}).request('/equipment')).length,3);
    }
  }
});
