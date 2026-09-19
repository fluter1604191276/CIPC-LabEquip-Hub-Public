import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, hashPassword } from "../lib/database.mjs";
import { createService } from "../lib/service.mjs";

const originalPassword = "OriginalPass2026";
const originalCredential = hashPassword(originalPassword);

function fixture(t) {
  const database = createDatabase(":memory:", { seed: false });
  t.after(() => database.close());
  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT INTO users (id, username, display_name, role, password_hash, password_salt,
      must_change_password, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `);
  for (const role of ["developer", "member"]) {
    insert.run(role, role, role, role, originalCredential.hash, originalCredential.salt, now, now);
  }
  const service = createService(database);
  const users = service.listUsers();
  return { database, service, member: users.find((user) => user.id === "member"), developer: users.find((user) => user.id === "developer") };
}

function isError(code) {
  return (error) => error.code === code;
}

test("rejects a pending old-password login after a synchronous password reset", async (t) => {
  const { database, service, member, developer } = fixture(t);
  const existingSession = service.createSession(member.id);
  const pendingLogin = service.authenticate(member.username, originalPassword);
  const reset = service.resetUserPassword(member.id, developer);
  await assert.rejects(pendingLogin, isError("INVALID_CREDENTIALS"));
  assert.equal(database.prepare("SELECT last_login_at FROM users WHERE id = ?").get(member.id).last_login_at, null);
  assert.throws(() => service.getSessionUser(existingSession.token), isError("SESSION_EXPIRED"));
  assert.equal((await service.authenticate(member.username, reset.temporaryPassword)).mustChangePassword, true);
});

test("a pending password change cannot overwrite a later administrator reset", async (t) => {
  const { database, service, member, developer } = fixture(t);
  const pendingChange = service.changePassword(member.id, originalPassword, "StaleChange2026", member);
  const reset = service.resetUserPassword(member.id, developer);
  const resetSession = service.createSession(member.id);
  await assert.rejects(pendingChange, isError("CREDENTIALS_CHANGED"));
  assert.equal(service.getSessionUser(resetSession.token).mustChangePassword, true);
  await assert.rejects(service.authenticate(member.username, "StaleChange2026"), isError("INVALID_CREDENTIALS"));
  assert.equal((await service.authenticate(member.username, reset.temporaryPassword)).id, member.id);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'user.password_change'").get().count, 0);
});

test("only one of two simultaneous password changes can consume the same credentials", async (t) => {
  const { database, service, member } = fixture(t);
  const passwords = ["ConcurrentPassOne2026", "ConcurrentPassTwo2026"];
  const changes = await Promise.allSettled(passwords.map((password) => service.changePassword(member.id, originalPassword, password, member)));
  assert.equal(changes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(changes.find((result) => result.status === "rejected").reason.code, "CREDENTIALS_CHANGED");
  const winner = changes.findIndex((result) => result.status === "fulfilled");
  assert.equal((await service.authenticate(member.username, passwords[winner])).id, member.id);
  await assert.rejects(service.authenticate(member.username, passwords[1 - winner]), isError("INVALID_CREDENTIALS"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'user.password_change'").get().count, 1);
});

for (const operation of ["login", "password change"]) {
  test(`rejects a pending ${operation} when the account is disabled during verification`, async (t) => {
    const { database, service, member } = fixture(t);
    const pending = operation === "login"
      ? service.authenticate(member.username, originalPassword)
      : service.changePassword(member.id, originalPassword, "DisabledChange2026", member);
    database.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(member.id);
    await assert.rejects(pending, isError(operation === "login" ? "INVALID_CREDENTIALS" : "AUTH_REQUIRED"));
    const row = database.prepare("SELECT * FROM users WHERE id = ?").get(member.id);
    assert.equal(row.password_hash, originalCredential.hash);
    assert.equal(row.last_login_at, null);
  });
}

for (const operation of ["login", "password change"]) {
  test(`session issuance is bound to the credentials verified by ${operation}`, async (t) => {
    const { database, service, member, developer } = fixture(t);
    const verified = operation === "login"
      ? await service.authenticate(member.username, originalPassword)
      : await service.changePassword(member.id, originalPassword, "ChangedPass2026", member);
    assert.doesNotMatch(JSON.stringify(verified), /password_hash|password_salt|credential|ticket/i);
    const reset = service.resetUserPassword(member.id, developer);
    assert.throws(() => service.createSession(verified.id, verified), isError("INVALID_CREDENTIALS"));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 0);
    const freshUser = await service.authenticate(member.username, reset.temporaryPassword);
    const session = service.createSession(freshUser.id, freshUser);
    assert.equal(service.getSessionUser(session.token).id, member.id);
  });
}

test("session issuance rejects disabled users and forged authentication snapshots", async (t) => {
  const { database, service, member, developer } = fixture(t);
  const verified = await service.authenticate(member.username, originalPassword);
  assert.throws(() => service.createSession(developer.id, verified), isError("INVALID_CREDENTIALS"));
  assert.throws(() => service.createSession(member.id, { ...verified }), isError("INVALID_CREDENTIALS"));
  database.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(member.id);
  assert.throws(() => service.createSession(member.id, verified), isError("INVALID_CREDENTIALS"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 0);
});
