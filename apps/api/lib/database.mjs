import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const INITIAL_PASSWORD = "123456";

const laboratorySeeds = [
  { code: "LAB-01", name: "低空通信与遥感实验室", alias: "实验室一" },
  { code: "LAB-02", name: "光电融合实验室", alias: "实验室二" },
  { code: "LAB-03", name: "通感融合与空车天地系统实验室", alias: "实验室三" },
  { code: "LAB-04", name: "集成封装与测试实验室", alias: "实验室四" },
  { code: "LAB-05", name: "量子实验室", alias: "实验室五" },
  { code: "LAB-06", name: "4楼学生工作间", alias: "实验室六" },
  { code: "LAB-07", name: "3楼学生工作间", alias: "实验室七" },
  { code: "MEETING-01", name: "3楼会议室", alias: "会议室" }
];

const userSeeds = [
  { username: "developer", displayName: "开发者账号", role: "developer" },
  { username: "member01", displayName: "测试成员01", role: "member" },
  { username: "member02", displayName: "测试成员02", role: "member" },
  { username: "member03", displayName: "测试成员03", role: "member" },
  { username: "member04", displayName: "测试成员04", role: "member" },
  { username: "member05", displayName: "测试成员05", role: "member" },
  { username: "member06", displayName: "测试成员06", role: "member" },
  { username: "member07", displayName: "测试成员07", role: "member" },
  { username: "member08", displayName: "测试成员08", role: "member" },
  { username: "member09", displayName: "测试成员09", role: "member" },
  { username: "member10", displayName: "测试成员10", role: "member" },
  { username: "member11", displayName: "测试成员11", role: "member" },
  { username: "member12", displayName: "测试成员12", role: "member" },
  { username: "member13", displayName: "测试成员13", role: "member" },
  { username: "member14", displayName: "测试成员14", role: "member" },
  { username: "member15", displayName: "测试成员15", role: "member" },
  { username: "member16", displayName: "测试成员16", role: "member" },
  { username: "member17", displayName: "测试成员17", role: "member" },
  { username: "member18", displayName: "测试成员18", role: "member" },
  { username: "member19", displayName: "测试成员19", role: "member" },
  { username: "member20", displayName: "测试成员20", role: "member" }
];

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

export function createDatabase(filePath, { seed = true, seedReferenceData = seed, seedUsers = seed } = {}) {
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });

  const database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS laboratories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL UNIQUE,
      alias TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('developer', 'admin', 'member')),
      laboratory_id TEXT REFERENCES laboratories(id),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      last_login_at TEXT,
      password_changed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_display_name TEXT NOT NULL DEFAULT '',
      actor_username TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx ON audit_logs(actor_user_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS equipment (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      metric TEXT NOT NULL,
      lab TEXT NOT NULL,
      location TEXT NOT NULL,
      owner TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('available', 'reserved', 'maintenance', 'disabled', 'retired')),
      icon TEXT NOT NULL DEFAULT '◇',
      thumb TEXT NOT NULL DEFAULT 'thumb-orange',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      equipment_id TEXT NOT NULL REFERENCES equipment(id),
      reservation_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      people INTEGER NOT NULL CHECK (people BETWEEN 1 AND 12),
      purpose TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      requester_lab TEXT NOT NULL,
      requester_user_id TEXT REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('approved', 'cancelled', 'in_use', 'completed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (start_at < end_at)
    );

    CREATE INDEX IF NOT EXISTS reservations_equipment_time_idx
      ON reservations(equipment_id, start_at, end_at);

    CREATE TABLE IF NOT EXISTS meeting_rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 500),
      location TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_reservations (
      id TEXT PRIMARY KEY,
      meeting_room_id TEXT NOT NULL REFERENCES meeting_rooms(id),
      reservation_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      people INTEGER NOT NULL CHECK (people BETWEEN 1 AND 500),
      purpose TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      requester_lab TEXT NOT NULL,
      requester_user_id TEXT REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('approved', 'cancelled', 'in_use', 'completed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (start_at < end_at)
    );

    CREATE INDEX IF NOT EXISTS room_reservations_room_time_idx
      ON room_reservations(meeting_room_id, start_at, end_at);

    CREATE TRIGGER IF NOT EXISTS room_reservations_no_overlap_insert
    BEFORE INSERT ON room_reservations
    WHEN NEW.status IN ('approved', 'in_use')
      AND EXISTS (
        SELECT 1 FROM room_reservations
        WHERE meeting_room_id = NEW.meeting_room_id
          AND status IN ('approved', 'in_use')
          AND NEW.start_at < end_at
          AND NEW.end_at > start_at
      )
    BEGIN
      SELECT RAISE(ABORT, 'room_reservation_conflict');
    END;

    CREATE TABLE IF NOT EXISTS maintenance_records (
      id TEXT PRIMARY KEY,
      equipment_id TEXT NOT NULL REFERENCES equipment(id),
      type TEXT NOT NULL CHECK (type IN ('repair', 'maintenance')),
      status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'completed')),
      record_date TEXT NOT NULL,
      description TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
      created_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS maintenance_records_equipment_date_idx
      ON maintenance_records(equipment_id, record_date DESC, created_at DESC);

    CREATE TRIGGER IF NOT EXISTS maintenance_records_sync_equipment_insert
    AFTER INSERT ON maintenance_records
    WHEN NEW.status IN ('open', 'in_progress')
    BEGIN
      UPDATE equipment
      SET status = 'maintenance', updated_at = NEW.updated_at
      WHERE id = NEW.equipment_id AND status = 'available';
    END;

    CREATE TRIGGER IF NOT EXISTS maintenance_records_sync_equipment_update
    AFTER UPDATE OF status ON maintenance_records
    BEGIN
      UPDATE equipment
      SET status = 'maintenance', updated_at = NEW.updated_at
      WHERE id = NEW.equipment_id
        AND NEW.status IN ('open', 'in_progress')
        AND status = 'available';
      UPDATE equipment
      SET status = 'available', updated_at = NEW.updated_at
      WHERE id = NEW.equipment_id
        AND NEW.status = 'completed'
        AND status = 'maintenance'
        AND NOT EXISTS (
          SELECT 1 FROM maintenance_records
          WHERE equipment_id = NEW.equipment_id
            AND status IN ('open', 'in_progress')
        );
    END;

    CREATE TRIGGER IF NOT EXISTS equipment_prevent_active_maintenance_override
    BEFORE UPDATE OF status ON equipment
    WHEN NEW.status = 'available'
      AND EXISTS (
        SELECT 1 FROM maintenance_records
        WHERE equipment_id = NEW.id
          AND status IN ('open', 'in_progress')
      )
    BEGIN
      SELECT RAISE(ABORT, 'equipment_has_active_maintenance');
    END;

    CREATE TABLE IF NOT EXISTS procurement_records (
      id TEXT PRIMARY KEY,
      equipment_id TEXT REFERENCES equipment(id),
      vendor TEXT NOT NULL,
      procurement_date TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      notes TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS procurement_records_equipment_date_idx
      ON procurement_records(equipment_id, procurement_date DESC, created_at DESC);

    CREATE TRIGGER IF NOT EXISTS reservations_no_overlap_insert
    BEFORE INSERT ON reservations
    WHEN NEW.status IN ('approved', 'in_use')
      AND EXISTS (
        SELECT 1 FROM reservations
        WHERE equipment_id = NEW.equipment_id
          AND status IN ('approved', 'in_use')
          AND NEW.start_at < end_at
          AND NEW.end_at > start_at
      )
    BEGIN
      SELECT RAISE(ABORT, 'reservation_conflict');
    END;
  `);

  migrateDatabase(database);
  if (seedReferenceData || seedUsers) seedDatabase(database, { includeUsers: seedUsers });
  return database;
}

function migrateDatabase(database) {
  const migrations = [
    {
      version: "20260726_three_roles_and_direct_booking",
      run() {
        const reservationColumns = database.prepare("PRAGMA table_info(reservations)").all();
        if (!reservationColumns.some((column) => column.name === "requester_user_id")) {
          database.exec("ALTER TABLE reservations ADD COLUMN requester_user_id TEXT REFERENCES users(id)");
        }
        database.exec(`
          UPDATE users SET role = 'member' WHERE role = 'custodian';
          UPDATE reservations SET status = 'approved' WHERE status = 'pending';
          DROP TRIGGER IF EXISTS reservations_no_overlap_insert;
          DROP TRIGGER IF EXISTS reservations_no_overlap_update;
          CREATE TRIGGER reservations_no_overlap_insert
          BEFORE INSERT ON reservations
          WHEN NEW.status IN ('approved', 'in_use')
            AND EXISTS (
              SELECT 1 FROM reservations
              WHERE equipment_id = NEW.equipment_id
                AND status IN ('approved', 'in_use')
                AND NEW.start_at < end_at
                AND NEW.end_at > start_at
            )
          BEGIN
            SELECT RAISE(ABORT, 'reservation_conflict');
          END;
          CREATE TRIGGER reservations_no_overlap_update
          BEFORE UPDATE OF equipment_id, start_at, end_at, status ON reservations
          WHEN NEW.status IN ('approved', 'in_use')
            AND EXISTS (
              SELECT 1 FROM reservations
              WHERE id <> NEW.id
                AND equipment_id = NEW.equipment_id
                AND status IN ('approved', 'in_use')
                AND NEW.start_at < end_at
                AND NEW.end_at > start_at
            )
          BEGIN
            SELECT RAISE(ABORT, 'reservation_conflict');
          END;
        `);
      }
    },
    {
      version: "20260726_reject_legacy_roles_and_approval_states",
      run() {
        database.exec(`
          DROP TRIGGER IF EXISTS users_reject_legacy_role_insert;
          DROP TRIGGER IF EXISTS users_reject_legacy_role_update;
          DROP TRIGGER IF EXISTS reservations_reject_approval_state_insert;
          DROP TRIGGER IF EXISTS reservations_reject_approval_state_update;
          CREATE TRIGGER users_reject_legacy_role_insert
          BEFORE INSERT ON users
          WHEN NEW.role NOT IN ('developer', 'admin', 'member')
          BEGIN
            SELECT RAISE(ABORT, 'invalid_role');
          END;
          CREATE TRIGGER users_reject_legacy_role_update
          BEFORE UPDATE OF role ON users
          WHEN NEW.role NOT IN ('developer', 'admin', 'member')
          BEGIN
            SELECT RAISE(ABORT, 'invalid_role');
          END;
          CREATE TRIGGER reservations_reject_approval_state_insert
          BEFORE INSERT ON reservations
          WHEN NEW.status NOT IN ('approved', 'cancelled', 'in_use', 'completed')
          BEGIN
            SELECT RAISE(ABORT, 'invalid_reservation_status');
          END;
          CREATE TRIGGER reservations_reject_approval_state_update
          BEFORE UPDATE OF status ON reservations
          WHEN NEW.status NOT IN ('approved', 'cancelled', 'in_use', 'completed')
          BEGIN
            SELECT RAISE(ABORT, 'invalid_reservation_status');
          END;
        `);
      }
    },
    {
      version: "20260727_business_records",
      run() {
        database.exec(`
          CREATE TABLE IF NOT EXISTS maintenance_records (
            id TEXT PRIMARY KEY,
            equipment_id TEXT NOT NULL REFERENCES equipment(id),
            type TEXT NOT NULL CHECK (type IN ('repair', 'maintenance')),
            status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'completed')),
            record_date TEXT NOT NULL,
            description TEXT NOT NULL,
            cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
            created_by_user_id TEXT REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS maintenance_records_equipment_date_idx
            ON maintenance_records(equipment_id, record_date DESC, created_at DESC);
          CREATE TABLE IF NOT EXISTS procurement_records (
            id TEXT PRIMARY KEY,
            equipment_id TEXT REFERENCES equipment(id),
            vendor TEXT NOT NULL,
            procurement_date TEXT NOT NULL,
            amount REAL NOT NULL CHECK (amount >= 0),
            status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
            notes TEXT NOT NULL DEFAULT '',
            created_by_user_id TEXT REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS procurement_records_equipment_date_idx
            ON procurement_records(equipment_id, procurement_date DESC, created_at DESC);
        `);
      }
    },
    {
      version: "20260727_business_record_enums",
      run() {
        database.exec(`
          DROP TRIGGER IF EXISTS maintenance_records_validate_insert;
          DROP TRIGGER IF EXISTS maintenance_records_validate_update;
          DROP TRIGGER IF EXISTS procurement_records_validate_insert;
          DROP TRIGGER IF EXISTS procurement_records_validate_update;
          CREATE TRIGGER maintenance_records_validate_insert
          BEFORE INSERT ON maintenance_records
          WHEN NEW.type NOT IN ('repair', 'maintenance')
            OR NEW.status NOT IN ('open', 'in_progress', 'completed')
          BEGIN
            SELECT RAISE(ABORT, 'invalid_maintenance_record');
          END;
          CREATE TRIGGER maintenance_records_validate_update
          BEFORE UPDATE OF type, status ON maintenance_records
          WHEN NEW.type NOT IN ('repair', 'maintenance')
            OR NEW.status NOT IN ('open', 'in_progress', 'completed')
          BEGIN
            SELECT RAISE(ABORT, 'invalid_maintenance_record');
          END;
          CREATE TRIGGER procurement_records_validate_insert
          BEFORE INSERT ON procurement_records
          WHEN NEW.status NOT IN ('pending', 'accepted', 'rejected')
          BEGIN
            SELECT RAISE(ABORT, 'invalid_procurement_record');
          END;
          CREATE TRIGGER procurement_records_validate_update
          BEFORE UPDATE OF status ON procurement_records
          WHEN NEW.status NOT IN ('pending', 'accepted', 'rejected')
          BEGIN
            SELECT RAISE(ABORT, 'invalid_procurement_record');
          END;
        `);
      }
    },
    {
      version: "20260727_meeting_room_reservations",
      run() {
        database.exec(`
          CREATE TABLE IF NOT EXISTS meeting_rooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            code TEXT NOT NULL UNIQUE COLLATE NOCASE,
            capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 500),
            location TEXT NOT NULL DEFAULT '',
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS room_reservations (
            id TEXT PRIMARY KEY,
            meeting_room_id TEXT NOT NULL REFERENCES meeting_rooms(id),
            reservation_date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            people INTEGER NOT NULL CHECK (people BETWEEN 1 AND 500),
            purpose TEXT NOT NULL,
            requester_name TEXT NOT NULL,
            requester_lab TEXT NOT NULL,
            requester_user_id TEXT REFERENCES users(id),
            status TEXT NOT NULL CHECK (status IN ('approved', 'cancelled', 'in_use', 'completed')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (start_at < end_at)
          );
          CREATE INDEX IF NOT EXISTS room_reservations_room_time_idx
            ON room_reservations(meeting_room_id, start_at, end_at);
          DROP TRIGGER IF EXISTS room_reservations_no_overlap_insert;
          DROP TRIGGER IF EXISTS room_reservations_no_overlap_update;
          CREATE TRIGGER room_reservations_no_overlap_insert
          BEFORE INSERT ON room_reservations
          WHEN NEW.status IN ('approved', 'in_use')
            AND EXISTS (
              SELECT 1 FROM room_reservations
              WHERE meeting_room_id = NEW.meeting_room_id
                AND status IN ('approved', 'in_use')
                AND NEW.start_at < end_at
                AND NEW.end_at > start_at
            )
          BEGIN
            SELECT RAISE(ABORT, 'room_reservation_conflict');
          END;
          CREATE TRIGGER room_reservations_no_overlap_update
          BEFORE UPDATE OF meeting_room_id, start_at, end_at, status ON room_reservations
          WHEN NEW.status IN ('approved', 'in_use')
            AND EXISTS (
              SELECT 1 FROM room_reservations
              WHERE id <> NEW.id
                AND meeting_room_id = NEW.meeting_room_id
                AND status IN ('approved', 'in_use')
                AND NEW.start_at < end_at
                AND NEW.end_at > start_at
            )
          BEGIN
            SELECT RAISE(ABORT, 'room_reservation_conflict');
          END;
        `);
      }
    },
    {
      version: "20260727_operation_audit",
      run() {
        database.exec(`
          CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            actor_display_name TEXT NOT NULL DEFAULT '',
            actor_username TEXT NOT NULL DEFAULT '',
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            action TEXT NOT NULL,
            summary_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC, id DESC);
          CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx ON audit_logs(actor_user_id, created_at DESC, id DESC);
        `);
      }
    },
    {
      version: "20260729_meeting_room_availability_guards",
      run() {
        database.exec(`
          DROP TRIGGER IF EXISTS meeting_rooms_protect_future_reservations;
          DROP TRIGGER IF EXISTS room_reservations_require_active_room_insert;
          DROP TRIGGER IF EXISTS room_reservations_require_active_room_update;
          DROP TRIGGER IF EXISTS room_reservations_enforce_capacity_insert;
          DROP TRIGGER IF EXISTS room_reservations_enforce_capacity_update;
          CREATE TRIGGER meeting_rooms_protect_future_reservations
          BEFORE UPDATE OF is_active ON meeting_rooms
          WHEN OLD.is_active = 1 AND NEW.is_active = 0
            AND EXISTS (
              SELECT 1 FROM room_reservations
              WHERE meeting_room_id = OLD.id
                AND status IN ('approved', 'in_use')
                AND end_at > STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
            )
          BEGIN
            SELECT RAISE(ABORT, 'meeting_room_has_future_reservations');
          END;
          CREATE TRIGGER room_reservations_require_active_room_insert
          BEFORE INSERT ON room_reservations
          WHEN NEW.status IN ('approved', 'in_use')
            AND NOT EXISTS (SELECT 1 FROM meeting_rooms WHERE id = NEW.meeting_room_id AND is_active = 1)
          BEGIN
            SELECT RAISE(ABORT, 'meeting_room_unavailable');
          END;
          CREATE TRIGGER room_reservations_require_active_room_update
          BEFORE UPDATE OF meeting_room_id, status ON room_reservations
          WHEN NEW.status IN ('approved', 'in_use')
            AND NOT EXISTS (SELECT 1 FROM meeting_rooms WHERE id = NEW.meeting_room_id AND is_active = 1)
          BEGIN
            SELECT RAISE(ABORT, 'meeting_room_unavailable');
          END;
          CREATE TRIGGER room_reservations_enforce_capacity_insert
          BEFORE INSERT ON room_reservations
          WHEN NOT EXISTS (SELECT 1 FROM meeting_rooms WHERE id = NEW.meeting_room_id AND NEW.people <= capacity)
          BEGIN
            SELECT RAISE(ABORT, 'meeting_room_capacity_exceeded');
          END;
          CREATE TRIGGER room_reservations_enforce_capacity_update
          BEFORE UPDATE OF meeting_room_id, people ON room_reservations
          WHEN NOT EXISTS (SELECT 1 FROM meeting_rooms WHERE id = NEW.meeting_room_id AND NEW.people <= capacity)
          BEGIN
            SELECT RAISE(ABORT, 'meeting_room_capacity_exceeded');
          END;
        `);
      }
    },
    {
      version: "20260729_meeting_room_capacity_guard",
      run() {
        database.exec(`
          DROP TRIGGER IF EXISTS meeting_rooms_protect_reservation_capacity;
          CREATE TRIGGER meeting_rooms_protect_reservation_capacity
          BEFORE UPDATE OF capacity ON meeting_rooms
          WHEN EXISTS (
            SELECT 1 FROM room_reservations
            WHERE meeting_room_id = OLD.id
              AND status IN ('approved', 'in_use')
              AND end_at > STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
              AND people > NEW.capacity
          )
          BEGIN
            SELECT RAISE(ABORT, 'meeting_room_capacity_conflict');
          END;
        `);
      }
    },
    {
      version: "20260802_room_reservation_capacity_status_guard",
      run() {
        database.exec(`
          DROP TRIGGER IF EXISTS room_reservations_enforce_capacity_insert;
          DROP TRIGGER IF EXISTS room_reservations_enforce_capacity_update;
          CREATE TRIGGER room_reservations_enforce_capacity_insert
          BEFORE INSERT ON room_reservations
          WHEN NEW.status IN ('approved', 'in_use')
            AND NOT EXISTS (SELECT 1 FROM meeting_rooms WHERE id = NEW.meeting_room_id AND NEW.people <= capacity)
          BEGIN
            SELECT RAISE(ABORT, 'meeting_room_capacity_exceeded');
          END;
          CREATE TRIGGER room_reservations_enforce_capacity_update
          BEFORE UPDATE OF meeting_room_id, people, status ON room_reservations
          WHEN NEW.status IN ('approved', 'in_use')
            AND NOT EXISTS (SELECT 1 FROM meeting_rooms WHERE id = NEW.meeting_room_id AND NEW.people <= capacity)
          BEGIN
            SELECT RAISE(ABORT, 'meeting_room_capacity_exceeded');
          END;
        `);
      }
    }
  ];

  for (const migration of migrations) {
    if (database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migration.version)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      migration.run();
      database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  const reconciliationTime = new Date().toISOString();
  database.prepare("UPDATE equipment SET status = 'available', updated_at = ? WHERE status = 'reserved'")
    .run(reconciliationTime);
  database.prepare(`
    UPDATE equipment
    SET status = 'maintenance', updated_at = ?
    WHERE status = 'available'
      AND EXISTS (
        SELECT 1 FROM maintenance_records
        WHERE equipment_id = equipment.id
          AND status IN ('open', 'in_progress')
      )
  `).run(reconciliationTime);
}

function seedDatabase(database, { includeUsers = true } = {}) {
  const now = new Date().toISOString();

  database.exec("BEGIN IMMEDIATE");
  try {
    const insertLaboratory = database.prepare(`
      INSERT OR IGNORE INTO laboratories (id, code, name, alias, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    laboratorySeeds.forEach((laboratory, index) => {
      insertLaboratory.run(randomUUID(), laboratory.code, laboratory.name, laboratory.alias, index + 1, now, now);
    });

    if (includeUsers) {
      const insertUser = database.prepare(`
        INSERT OR IGNORE INTO users (
          id, username, display_name, role, laboratory_id, password_hash, password_salt,
          must_change_password, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1, 1, ?, ?)
      `);
      for (const user of userSeeds) {
        const password = hashPassword(INITIAL_PASSWORD);
        insertUser.run(randomUUID(), user.username, user.displayName, user.role, password.hash, password.salt, now, now);
      }
    }

    database.prepare(`
      INSERT OR IGNORE INTO meeting_rooms (id, name, code, capacity, location, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(randomUUID(), "3楼会议室", "MEETING-3F", 12, "3楼", now, now);

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
