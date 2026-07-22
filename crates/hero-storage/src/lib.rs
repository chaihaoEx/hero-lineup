//! Transactional SQLite persistence. The UI never receives raw SQL access.

use chrono::Utc;
use hero_domain::{
    migrate_legacy_system, validate_lineup, Backup, InterchangeError, LineupSystem, Template,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};
use thiserror::Error;
use uuid::Uuid;

const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_initial",
    r#"
        CREATE TABLE systems (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX systems_updated_at ON systems(updated_at DESC);
        CREATE TABLE templates (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            class_id TEXT,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE simulation_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            system_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            game_data_version TEXT NOT NULL,
            simulator_version TEXT NOT NULL,
            payload TEXT NOT NULL,
            stale INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(system_id) REFERENCES systems(id) ON DELETE CASCADE
        );
    "#,
)];

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("SQLite error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid UUID in database: {0}")]
    Uuid(#[from] uuid::Error),
    #[error("database contains invalid timestamp")]
    Timestamp,
    #[error("invalid imported data: {0}")]
    Domain(#[from] InterchangeError),
}

pub type Result<T> = std::result::Result<T, StorageError>;

pub struct Storage {
    connection: Connection,
}

impl Storage {
    pub fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> Result<Self> {
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")?;
        let mut storage = Self { connection };
        storage.migrate()?;
        storage.migrate_legacy_ui_systems()?;
        Ok(storage)
    }

    fn migrate(&mut self) -> Result<()> {
        self.connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);"
        )?;
        for (name, sql) in MIGRATIONS {
            let installed: bool = self.connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=?1)",
                [name],
                |r| r.get(0),
            )?;
            if !installed {
                let tx = self.connection.transaction()?;
                tx.execute_batch(sql)?;
                tx.execute(
                    "INSERT INTO schema_migrations(name, applied_at) VALUES(?1, ?2)",
                    params![name, Utc::now().to_rfc3339()],
                )?;
                tx.commit()?;
            }
        }
        Ok(())
    }

    /// Moves the first desktop prototype's `ui_systems` payloads into the canonical
    /// repository in one transaction. Conversion happens before any write; a bad
    /// legacy row leaves both the old table and canonical tables untouched.
    fn migrate_legacy_ui_systems(&mut self) -> Result<()> {
        let exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='ui_systems')",
            [],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(());
        }
        let converted = {
            let mut statement = self
                .connection
                .prepare("SELECT payload FROM ui_systems ORDER BY updated_at")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            rows.map(|row| {
                let value: Value = serde_json::from_str(&row?)?;
                let system = migrate_legacy_system(&value)?;
                validate_lineup(&system)?;
                Ok(system)
            })
            .collect::<Result<Vec<_>>>()?
        };
        let tx = self.connection.transaction()?;
        for system in &converted {
            insert_system_replace(&tx, system)?;
        }
        tx.execute("DROP TABLE ui_systems", [])?;
        tx.commit()?;
        Ok(())
    }

    pub fn save_system(&mut self, system: &mut LineupSystem) -> Result<()> {
        system.updated_at = Utc::now();
        let payload = serde_json::to_string(system)?;
        self.connection.execute(
            "INSERT INTO systems(id,name,payload,created_at,updated_at) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updated_at=excluded.updated_at",
            params![system.id.to_string(), system.name, payload, system.created_at.to_rfc3339(), system.updated_at.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn get_system(&self, id: Uuid) -> Result<Option<LineupSystem>> {
        let payload: Option<String> = self
            .connection
            .query_row(
                "SELECT payload FROM systems WHERE id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        payload
            .map(|p| serde_json::from_str(&p).map_err(Into::into))
            .transpose()
    }

    pub fn list_systems(&self) -> Result<Vec<LineupSystem>> {
        let mut stmt = self
            .connection
            .prepare("SELECT payload FROM systems ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn delete_system(&mut self, id: Uuid) -> Result<bool> {
        Ok(self
            .connection
            .execute("DELETE FROM systems WHERE id=?1", [id.to_string()])?
            > 0)
    }

    pub fn save_template(&mut self, template: &Template) -> Result<()> {
        self.connection.execute(
            "INSERT INTO templates(id,name,class_id,payload,updated_at) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,class_id=excluded.class_id,payload=excluded.payload,updated_at=excluded.updated_at",
            params![template.id.to_string(), template.name, template.class_id, serde_json::to_string(template)?, template.updated_at.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn list_templates(&self) -> Result<Vec<Template>> {
        let mut stmt = self
            .connection
            .prepare("SELECT payload FROM templates ORDER BY name")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn delete_template(&mut self, id: Uuid) -> Result<bool> {
        Ok(self
            .connection
            .execute("DELETE FROM templates WHERE id=?1", [id.to_string()])?
            > 0)
    }

    pub fn set_setting(&mut self, key: &str, value: &Value) -> Result<()> {
        self.connection.execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, serde_json::to_string(value)?],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<Value>> {
        let raw: Option<String> = self
            .connection
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()?;
        raw.map(|v| serde_json::from_str(&v).map_err(Into::into))
            .transpose()
    }

    pub fn record_simulation(
        &mut self,
        system_id: Uuid,
        task_id: Uuid,
        game_data_version: &str,
        simulator_version: &str,
        payload: &Value,
    ) -> Result<i64> {
        self.connection.execute(
            "INSERT INTO simulation_history(system_id,task_id,game_data_version,simulator_version,payload,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![system_id.to_string(), task_id.to_string(), game_data_version, simulator_version, serde_json::to_string(payload)?, Utc::now().to_rfc3339()],
        )?;
        Ok(self.connection.last_insert_rowid())
    }

    pub fn list_simulation_history(&self, system_id: Uuid) -> Result<Vec<Value>> {
        let mut statement = self.connection.prepare(
            "SELECT json_object('id',id,'systemId',system_id,'taskId',task_id,'gameDataVersion',game_data_version,'simulatorVersion',simulator_version,'payload',json(payload),'stale',json(stale),'createdAt',created_at) FROM simulation_history WHERE system_id=?1 ORDER BY id DESC"
        )?;
        let rows = statement.query_map([system_id.to_string()], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn mark_simulations_stale(
        &mut self,
        current_game_data_version: &str,
        current_simulator_version: &str,
    ) -> Result<usize> {
        Ok(self.connection.execute(
            "UPDATE simulation_history SET stale=1 WHERE game_data_version<>?1 OR simulator_version<>?2",
            params![current_game_data_version, current_simulator_version],
        )?)
    }

    pub fn export_backup(&self) -> Result<Backup> {
        let settings = {
            let mut stmt = self
                .connection
                .prepare("SELECT key,value FROM settings ORDER BY key")?;
            let rows =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            rows.map(|r| {
                let (key, raw) = r?;
                Ok((key, serde_json::from_str(&raw)?))
            })
            .collect::<Result<BTreeMap<_, _>>>()?
        };
        Ok(Backup {
            systems: self.list_systems()?,
            templates: self.list_templates()?,
            settings,
        })
    }

    pub fn restore_backup(&mut self, backup: &Backup) -> Result<()> {
        // Validate the complete graph before opening the destructive transaction.
        // A malformed import therefore cannot erase the current database.
        for system in &backup.systems {
            validate_lineup(system)?;
        }
        let tx = self.connection.transaction()?;
        tx.execute("DELETE FROM simulation_history", [])?;
        tx.execute("DELETE FROM systems", [])?;
        tx.execute("DELETE FROM templates", [])?;
        tx.execute("DELETE FROM settings", [])?;
        for system in &backup.systems {
            insert_system(&tx, system)?;
        }
        for template in &backup.templates {
            insert_template(&tx, template)?;
        }
        for (key, value) in &backup.settings {
            tx.execute(
                "INSERT INTO settings(key,value) VALUES(?1,?2)",
                params![key, serde_json::to_string(value)?],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn insert_system(tx: &Transaction<'_>, s: &LineupSystem) -> Result<()> {
    tx.execute(
        "INSERT INTO systems(id,name,payload,created_at,updated_at) VALUES(?1,?2,?3,?4,?5)",
        params![
            s.id.to_string(),
            s.name,
            serde_json::to_string(s)?,
            s.created_at.to_rfc3339(),
            s.updated_at.to_rfc3339()
        ],
    )?;
    Ok(())
}

fn insert_system_replace(tx: &Transaction<'_>, s: &LineupSystem) -> Result<()> {
    tx.execute(
        "INSERT INTO systems(id,name,payload,created_at,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updated_at=excluded.updated_at",
        params![s.id.to_string(), s.name, serde_json::to_string(s)?, s.created_at.to_rfc3339(), s.updated_at.to_rfc3339()],
    )?;
    Ok(())
}

fn insert_template(tx: &Transaction<'_>, t: &Template) -> Result<()> {
    tx.execute(
        "INSERT INTO templates(id,name,class_id,payload,updated_at) VALUES(?1,?2,?3,?4,?5)",
        params![
            t.id.to_string(),
            t.name,
            t.class_id,
            serde_json::to_string(t)?,
            t.updated_at.to_rfc3339()
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud_persists_across_reopen_and_backup_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("user.db");
        let id;
        {
            let mut db = Storage::open(&path).unwrap();
            let mut system = LineupSystem::new("Alpha");
            id = system.id;
            db.save_system(&mut system).unwrap();
            db.set_setting("locale", &Value::String("zh-CN".into()))
                .unwrap();
        }
        let mut db = Storage::open(&path).unwrap();
        assert_eq!(db.get_system(id).unwrap().unwrap().name, "Alpha");
        let backup = db.export_backup().unwrap();
        assert!(db.delete_system(id).unwrap());
        db.restore_backup(&backup).unwrap();
        assert_eq!(db.list_systems().unwrap().len(), 1);
        assert_eq!(
            db.get_setting("locale").unwrap(),
            Some(Value::String("zh-CN".into()))
        );
    }

    #[test]
    fn invalid_restore_does_not_replace_existing_database() {
        let mut db = Storage::open_in_memory().unwrap();
        let mut existing = LineupSystem::new("keep me");
        db.save_system(&mut existing).unwrap();
        let mut invalid = LineupSystem::new("broken");
        invalid.adventure_tasks.push(hero_domain::AdventureTask {
            id: Uuid::new_v4(),
            quest_id: "forest01".into(),
            name: "Forest".into(),
            map: "Forest".into(),
            group_id: Some(Uuid::new_v4()),
            hero_ids: Vec::new(),
            champion_ids: Vec::new(),
            difficulty: 1,
            max_members: 4,
            barrier: BTreeMap::new(),
            config: hero_domain::SimulationConfig::default(),
            result: None,
            modifiers: Vec::new(),
            simulation: None,
        });
        let backup = Backup {
            systems: vec![invalid],
            templates: Vec::new(),
            settings: BTreeMap::new(),
        };
        assert!(db.restore_backup(&backup).is_err());
        assert_eq!(db.list_systems().unwrap()[0].name, "keep me");
    }

    #[test]
    fn legacy_ui_table_is_migrated_once_without_losing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("user.db");
        let legacy = serde_json::json!({
            "id": Uuid::new_v4(), "name": "旧体系", "description": "d", "localTag": "收藏",
            "schemaVersion": 1, "gameDataVersion": "2026.07", "heroes": [], "championIds": [],
            "championLoadouts": {}, "taskGroups": [], "createdAt": Utc::now(), "updatedAt": Utc::now()
        });
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE ui_systems(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)").unwrap();
        connection
            .execute(
                "INSERT INTO ui_systems VALUES(?1,?2,?3)",
                params![
                    legacy["id"].as_str().unwrap(),
                    legacy.to_string(),
                    Utc::now().to_rfc3339()
                ],
            )
            .unwrap();
        drop(connection);
        let db = Storage::open(&path).unwrap();
        let systems = db.list_systems().unwrap();
        assert_eq!(systems[0].local_tag, "收藏");
        assert_eq!(systems[0].game_data_version, "2026.07");
        let old_table: bool = db
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='ui_systems')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!old_table);
    }

    #[test]
    fn simulation_versions_mark_old_rows_stale() {
        let mut db = Storage::open_in_memory().unwrap();
        let mut system = LineupSystem::new("sim");
        db.save_system(&mut system).unwrap();
        db.record_simulation(
            system.id,
            Uuid::new_v4(),
            "old",
            "sim-1",
            &serde_json::json!({"successRate": 50}),
        )
        .unwrap();
        assert_eq!(db.mark_simulations_stale("new", "sim-2").unwrap(), 1);
        assert_eq!(
            db.list_simulation_history(system.id).unwrap()[0]["stale"],
            1
        );
    }
}
