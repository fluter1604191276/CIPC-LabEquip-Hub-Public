import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const html = readFileSync(new URL('../tutorial.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../tutorial.js', import.meta.url), 'utf8');
function model() { const context = {}; vm.runInNewContext(script, context); return context.TutorialModel; }

test('tutorial catalog follows the selected role and unknown roles default to member', () => {
  const m = model();
  assert.equal(m.lessonsForRole('member').length, 7);
  assert.equal(m.lessonsForRole('admin').length, 9);
  assert.equal(m.lessonsForRole('developer').length, 10);
  assert.deepEqual([...m.lessonsForRole('unknown').map(l => l.id)], [...m.lessonsForRole('member').map(l => l.id)]);
  for (const role of ['member', 'admin']) {
    const s = m.createState(role);
    assert.equal(m.start(s, 'upgrade').ok, false);
    assert.equal(s.lessonId, null);
  }
  assert.equal(m.start(m.createState('member'), 'members').ok, false);
  assert.equal(m.start(m.createState('member'), 'laboratories').ok, false);
  assert.equal(m.start(m.createState('developer'), 'unknown').ok, false);
});

test('all tutorials can finish through their actual validated actions in practice and demo', () => {
  const m = model();
  for (const mode of ['practice', 'demo']) {
    for (const lesson of m.lessons) {
      const s = m.createState('developer');
      assert.equal(m.start(s, lesson.id, mode).ok, true);
      assert.equal(s.mode, mode);
      for (const [index, step] of lesson.steps.entries()) {
        assert.equal(s.stepIndex, index);
        const result = m.advance(s, step.action, m.demoValues(s));
        assert.equal(result.ok, true, `${lesson.id}/${step.action}: ${result.message}`);
      }
      assert.equal(s.completed, true, lesson.id);
      assert.equal(m.currentStep(s), null);
      assert.equal(m.advance(s, 'extra').ok, false);
    }
  }
});

test('wrong actions and empty forms do not skip steps or modify virtual records', () => {
  const m = model();
  for (const lesson of m.lessons) {
    const s = m.createState('developer'); m.start(s, lesson.id);
    for (const step of lesson.steps) {
      const before = JSON.stringify(s);
      assert.equal(m.advance(s, 'unrelated-action').ok, false);
      assert.equal(JSON.stringify(s), before);
      if (step.fields) {
        const result = m.advance(s, step.action, {});
        assert.equal(result.ok, false);
        assert.ok(result.message.length > 3);
        assert.equal(JSON.stringify(s), before);
      }
      m.advance(s, step.action, m.demoValues(s));
    }
  }
});

function stateAt(m, lesson, action) {
  const s = m.createState('developer'); m.start(s, lesson);
  while (m.currentStep(s)?.action !== action) {
    assert.equal(s.completed, false, `missing ${action}`);
    assert.equal(m.advance(s, m.currentStep(s).action, m.demoValues(s)).ok, true);
  }
  return s;
}

test('booking validates future time, valid dates, ordering, capacity and purpose', () => {
  const m = model();
  for (const [lesson,action] of [['equipment','submit:booking'], ['room','submit:room']]) {
    const s = stateAt(m, lesson, action), valid = m.demoValues(s);
    for (const patch of [{date:'2020-01-01'}, {date:'2030-02-30'}, {start:'24:00'}, {end:'08:30'}, {people:'0'}, {people:'1.5'}, {purpose:' '}, {people:'Infinity'}]) {
      assert.equal(m.advance(s, action, {...valid,...patch}).ok, false, JSON.stringify(patch));
    }
    if (lesson === 'room') assert.equal(m.advance(s, action, {...valid,people:'9'}).ok, false);
    else assert.equal(m.advance(s, action, {...valid,people:'13'}).ok, false);
    assert.equal(m.advance(s, action, valid).ok, true);
  }
});

test('search, monetary fields, roles and space definitions validate tutorial input', () => {
  const m = model();
  const cases = [
    ['equipment','search:equipment',{query:'no match'}],
    ['equipment','search:equipment',{query:'示波器x'}],
    ['maintenance','submit:maintenance',{cost:'-1'}],
    ['maintenance','submit:maintenance',{cost:'NaN'}],
    ['procurement','submit:procurement',{amount:'-5'}],
    ['procurement','accept:procurement',{status:'pending'}],
    ['members','submit:member',{username:'bad user'}],
    ['members','submit:member',{role:'developer'}],
    ['members','submit:member',{role:'admin'}],
    ['laboratories','submit:lab',{sort:'-1'}],
    ['laboratories','submit:lab',{sort:'1.2'}],
    ['laboratories','submit:lab-edit',{active:'false'}]
  ];
  for (const [lesson,action,patch] of cases) {
    const s = stateAt(m,lesson,action), before = JSON.stringify(s);
    assert.equal(m.advance(s,action,{...m.demoValues(s),...patch}).ok,false,`${lesson}/${action}`);
    assert.equal(JSON.stringify(s),before);
  }
});

test('previous and restart restore virtual state, including after completion', () => {
  const m = model();
  for (const lesson of m.lessons) {
    const s = m.createState('developer'); m.start(s,lesson.id);
    assert.equal(m.previous(s),false);
    for (const step of lesson.steps) {
      const before = JSON.stringify(s);
      const values = m.demoValues(s);
      m.advance(s,step.action,values);
      assert.equal(m.previous(s),true);
      assert.equal(JSON.stringify(s),before,`${lesson.id}/${step.action}`);
      m.advance(s,step.action,values);
    }
    m.restart(s);
    assert.equal(s.stepIndex,0); assert.equal(s.completed,false);
    assert.equal(JSON.stringify(s.values),'{}'); assert.equal(s.history.length,0);
  }
});

test('virtual form values never change production app state and restart clears prior lesson input', () => {
  const m = model(); const s = stateAt(m,'equipment','submit:booking');
  m.advance(s,'submit:booking',{...m.demoValues(s),purpose:'My custom practice'});
  assert.equal(s.values['submit:booking'].purpose,'My custom practice');
  m.start(s,'room'); assert.equal(JSON.stringify(s.values),'{}');
  const second = m.createState('member'); assert.equal(JSON.stringify(second.values),'{}');
});

test('tutorial reuses production assets with CSP-blocked scripts and WebKit-compatible event sandbox', () => {
  assert.match(html,/connect-src 'self'/); assert.match(html,/form-action 'none'/);
  assert.match(script,/fetch\('\.\/index\.html', options\)/);
  assert.match(script,/fetch\('\.\/styles\.css', options\)/);
  assert.doesNotMatch(script,/fetch\([^)]*api|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie/);
  assert.match(script,/LabApplication\.mount\(doc,\{tutorial:true,request/);
  assert.match(script,/TutorialAPI\.create/);
  assert.match(script,/style\.textContent = assets\.css/);
  assert.match(script,/parsed\.querySelectorAll\('script,link,base,meta\[http-equiv\]'/);
  assert.match(script,/script-src 'none'; connect-src 'none'; form-action 'none'/);
  assert.doesNotMatch(script,/function sceneView|class="sim-nav"|class="workbench"/);
  assert.match(shell,/<iframe[^>]+id="guide-practice-frame"[^>]+sandbox="allow-same-origin allow-scripts"/);
  assert.match(app,/TutorialModel\.mount\(guidePracticeFrame\.contentDocument/);
  assert.match(app,/guidePracticeCleanup\?\.\(\)/);
});

test('guide integration keeps text reference and loads tutorial only for an open signed-in guide', () => {
  assert.match(shell,/id="guide-tab-practice"/); assert.match(shell,/id="guide-tab-start"/);
  assert.match(app,/if \(!guideModal\.classList\.contains\("open"\) \|\| !currentUser\) return/);
  assert.match(app,/credentials: "omit"/);
  assert.match(app,/if \(currentRole !== role\) clearGuidePractice\(\)/);
  assert.match(app,/function showLogin\([^)]*\) \{\s*setGuideModal\(false\)/);
  assert.match(app,/onHelp: \(\) => activateGuideSection/);
  assert.match(shell,/id="guide-practice-retry"/);
});

test('tutorial uses actual controls without invented search, cancel or acceptance confirmation', () => {
  const m=model();
  assert.equal(m.controls['search:equipment'],'#directory-search');
  assert.ok(m.controls['open:equipment'].includes('.directory-row-action'));
  assert.ok(m.controls['accept:procurement'].includes('.procurement-record-status'));
  assert.equal(m.lessons.find(l=>l.id==='cancel').steps.some(step=>step.action==='confirm:cancel'),false);
  assert.match(script,/new SubmitEvent\('submit'/);
  assert.match(script,/form\.checkValidity\(\)/);
  assert.match(script,/requiresWrite/);
});

test('shared app runtime requires a memory adapter before touching a tutorial document', () => {
  const context={};vm.runInNewContext(app,context);
  assert.equal(typeof context.LabApplication.mount,'function');
  assert.throws(()=>context.LabApplication.mount(null,{tutorial:true}),/in-memory request adapter/);
  assert.match(app,/if \(tutorial\) \{/);
  assert.match(app,/await requestAdapter\(path, options\)/);
  assert.match(app,/演示中不发送网络请求/);
  assert.match(app,/tutorialStorage\.clear\(\)/);
  assert.match(app,/for \(const id of tutorialTimeouts\)/);
});

test('pause cancels only demo timers, while action completion has its own lifecycle', () => {
  assert.match(script,/actionTimer=setTimeout/);
  const clear = script.match(/function clearDemo\(\) \{[^\n]+/)[0];
  assert.doesNotMatch(clear,/actionTimer/);
  assert.match(script,/generation\+\+; clearDemo\(\); clearTimeout\(actionTimer\)/);
  assert.match(script,/doc\.querySelector\(controls\['open:equipment'\]\)/);
});

test('both classroom iframe levels allow Safari host listeners while child scripts stay blocked', () => {
  const outer = shell.match(/<iframe[^>]+id="guide-practice-frame"[^>]*>/)?.[0];
  const inner = script.match(/<iframe[^>]+id="production-practice-frame"[^>]*>/)?.[0];
  for (const frame of [outer, inner]) {
    assert.ok(frame);
    assert.match(frame, /sandbox="allow-same-origin allow-scripts"/);
    assert.doesNotMatch(frame, /allow-forms|allow-popups|allow-top-navigation/);
  }
  assert.match(app, /replace\("script-src 'self'", "script-src 'none'"\)/);
  assert.match(script, /script-src 'none'; connect-src 'none'; form-action 'none'/);
  assert.match(script, /parsed\.querySelectorAll\('script,link,base,meta\[http-equiv\]'/);
  assert.match(app, /Tutorial mode requires an in-memory request adapter/);
});

test('equipment creation lesson uses the real form and validates asset identifiers', () => {
  const m = model();
  const lesson = m.lessons.find(item => item.id === 'equipment-create');
  assert.ok(lesson); assert.deepEqual(Array.from(lesson.roles), ['member', 'admin', 'developer']);
  const state = m.createState('member'); assert.equal(m.start(state, 'equipment-create').ok, true);
  while (m.currentStep(state).action !== 'submit:equipment') m.advance(state, m.currentStep(state).action, m.demoValues(state));
  const valid = m.demoValues(state);
  assert.equal(m.advance(state, 'submit:equipment', { ...valid, code: 'x'.repeat(81) }).ok, false);
  for (const patch of [{code:' '},{status:'reserved'},{lab:'demo-lab'},{metric:'x'.repeat(501)}]) {
    assert.equal(m.advance(state, 'submit:equipment', {...valid,...patch}).ok, false);
  }
  // Production asset codes are text, not a restricted letters-and-digits pattern.
  assert.equal(m.advance(state, 'submit:equipment', {...valid,code:'资产 4/A',metric:'x'.repeat(500)}).ok, true);
  assert.equal(m.currentStep(state).action, 'verify:equipment');
  assert.match(script, /#open-equipment-form/);
  assert.match(script, /#equipment-form/);
});
