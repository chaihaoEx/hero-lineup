//! Stable domain types and portable import/export formats.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path};
use thiserror::Error;
use uuid::Uuid;

pub const LINEUP_SCHEMA_VERSION: u32 = 1;
pub const BACKUP_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Versions {
    pub app_version: String,
    pub game_data_version: String,
    pub simulator_version: String,
    pub asset_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LineupSystem {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub local_public: bool,
    /// UI-only provenance label. It is deliberately persisted so exports can be
    /// imported without silently turning samples/favourites into ordinary data.
    #[serde(default = "default_local_tag")]
    pub local_tag: String,
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub game_data_version: String,
    #[serde(default)]
    pub groups: Vec<LineupGroup>,
    #[serde(default)]
    pub heroes: Vec<HeroBuild>,
    #[serde(default)]
    pub champions: Vec<ChampionBuild>,
    #[serde(default)]
    pub equipment_owned_counts: EquipmentOwnedCounts,
    #[serde(default)]
    pub adventure_tasks: Vec<AdventureTask>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl LineupSystem {
    pub fn new(name: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            description: String::new(),
            local_public: false,
            local_tag: default_local_tag(),
            schema_version: LINEUP_SCHEMA_VERSION,
            game_data_version: String::new(),
            groups: Vec::new(),
            heroes: Vec::new(),
            champions: Vec::new(),
            equipment_owned_counts: EquipmentOwnedCounts::default(),
            adventure_tasks: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentOwnedCounts {
    #[serde(default)]
    pub hero: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub champion: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineupGroup {
    pub id: Uuid,
    pub name: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeroBuild {
    pub id: Uuid,
    pub class_id: String,
    pub name: String,
    pub level: u16,
    #[serde(default = "default_one_u8")]
    pub rank: u8,
    #[serde(default)]
    pub seed: u32,
    #[serde(default)]
    pub card_level: u8,
    #[serde(default)]
    pub class_name: String,
    #[serde(default)]
    pub sprite_path: Option<String>,
    #[serde(default)]
    pub element: String,
    #[serde(default)]
    pub stats: UnitStats,
    #[serde(default)]
    pub titan: bool,
    #[serde(default)]
    pub seed_points: BTreeMap<Stat, i32>,
    #[serde(default)]
    pub equipment: Vec<Equipment>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub card_levels: BTreeMap<String, u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChampionBuild {
    pub id: String,
    #[serde(default)]
    pub loadout_present: bool,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub class_id: Option<String>,
    #[serde(default)]
    pub sprite_path: Option<String>,
    #[serde(default)]
    pub element: String,
    pub level: u16,
    pub rank: u8,
    #[serde(default)]
    pub seed: u32,
    #[serde(default)]
    pub card_level: u8,
    #[serde(default)]
    pub titan: bool,
    #[serde(default)]
    pub familiar_id: String,
    #[serde(default)]
    pub aura_song_id: String,
    #[serde(default)]
    pub stats: UnitStats,
    #[serde(default)]
    pub familiar: Option<Equipment>,
    #[serde(default)]
    pub aura_song: Option<Equipment>,
    #[serde(default)]
    pub card_levels: BTreeMap<String, u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Equipment {
    #[serde(default)]
    pub item_id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub slot: EquipmentSlot,
    pub quality: Quality,
    #[serde(default)]
    pub element: Option<String>,
    #[serde(default)]
    pub spirit: Option<String>,
    #[serde(default)]
    pub shiny: bool,
    #[serde(default)]
    pub transcended: bool,
    #[serde(default)]
    pub transcendence: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UnitStats {
    pub attack: f64,
    pub defense: f64,
    pub health: f64,
    pub evasion: f64,
    pub crit: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum EquipmentSlot {
    Weapon,
    Head,
    Body,
    Hands,
    Feet,
    Accessory,
    Familiar,
    AuraSong,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    Normal,
    Superior,
    Flawless,
    Epic,
    Legendary,
}

impl Quality {
    pub fn multiplier(self) -> f64 {
        match self {
            Self::Normal => 1.0,
            Self::Superior => 1.1,
            Self::Flawless => 1.2,
            Self::Epic => 1.35,
            Self::Legendary => 1.5,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "camelCase")]
pub enum Stat {
    Health,
    Attack,
    Defense,
    Evasion,
    CriticalChance,
    CriticalDamage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdventureTask {
    pub id: Uuid,
    pub quest_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub map: String,
    pub group_id: Option<Uuid>,
    #[serde(default)]
    pub hero_ids: Vec<Uuid>,
    #[serde(default)]
    pub champion_ids: Vec<String>,
    pub difficulty: u8,
    #[serde(default = "default_max_members")]
    pub max_members: u8,
    #[serde(default)]
    pub barrier: BTreeMap<String, f64>,
    #[serde(default)]
    pub config: SimulationConfig,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub modifiers: Vec<String>,
    #[serde(default)]
    pub simulation: Option<SimulationSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulationSnapshot {
    pub simulator_version: String,
    pub game_data_version: String,
    pub seed: u64,
    pub iterations: u32,
    pub result: serde_json::Value,
    pub completed_at: DateTime<Utc>,
    #[serde(default)]
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SimulationConfig {
    pub iterations: u32,
    pub seed: u64,
    pub booster: bool,
    pub booster_level: u8,
    pub elite: bool,
    #[serde(default)]
    pub elite_kind: Option<String>,
    #[serde(default)]
    pub selected_element: Option<String>,
    pub titan_tower: bool,
}

impl Default for SimulationConfig {
    fn default() -> Self {
        Self {
            iterations: 10_000,
            seed: 1,
            booster: false,
            booster_level: 0,
            elite: false,
            elite_kind: None,
            selected_element: None,
            titan_tower: false,
        }
    }
}

fn default_local_tag() -> String {
    "本地".to_owned()
}
fn default_schema_version() -> u32 {
    LINEUP_SCHEMA_VERSION
}
fn default_one_u8() -> u8 {
    1
}
fn default_max_members() -> u8 {
    4
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: Uuid,
    pub name: String,
    pub class_id: Option<String>,
    pub build: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub systems: Vec<LineupSystem>,
    pub templates: Vec<Template>,
    #[serde(default)]
    pub settings: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortableEnvelope<T> {
    pub format: String,
    pub schema_version: u32,
    pub exported_at: DateTime<Utc>,
    pub versions: Versions,
    pub checksum_sha256: String,
    pub payload: T,
}

#[derive(Debug, Error)]
pub enum InterchangeError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported format {0}")]
    UnsupportedFormat(String),
    #[error("unsupported schema version {actual}; maximum supported is {supported}")]
    UnsupportedSchema { actual: u32, supported: u32 },
    #[error("checksum mismatch")]
    ChecksumMismatch,
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("legacy lineup bundle contains {0} systems; import it with decode_lineup_bundle")]
    MultipleSystems(usize),
}

fn checksum<T: Serialize>(payload: &T) -> Result<String, serde_json::Error> {
    let bytes = serde_json::to_vec(payload)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

/// Result of reading either the canonical single-system format or a legacy UI bundle.
/// New writers must always emit one system through [`encode_lineup`].
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedLineupBundle {
    pub versions: Versions,
    pub systems: Vec<LineupSystem>,
    pub migrated_from_legacy: bool,
}

pub fn validate_versions(versions: &Versions) -> Result<(), InterchangeError> {
    for (field, value) in [
        ("appVersion", versions.app_version.as_str()),
        ("gameDataVersion", versions.game_data_version.as_str()),
        ("simulatorVersion", versions.simulator_version.as_str()),
        ("assetVersion", versions.asset_version.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(InterchangeError::Validation(format!(
                "{field} must not be empty"
            )));
        }
    }
    Ok(())
}

pub fn validate_lineup(lineup: &LineupSystem) -> Result<(), InterchangeError> {
    if lineup.name.trim().is_empty() {
        return Err(InterchangeError::Validation("system name is empty".into()));
    }
    let groups: BTreeMap<_, _> = lineup.groups.iter().map(|g| (g.id, g)).collect();
    if groups.len() != lineup.groups.len() {
        return Err(InterchangeError::Validation("duplicate group id".into()));
    }
    let heroes: BTreeMap<_, _> = lineup.heroes.iter().map(|h| (h.id, h)).collect();
    if heroes.len() != lineup.heroes.len() {
        return Err(InterchangeError::Validation("duplicate hero id".into()));
    }
    let champions: BTreeMap<_, _> = lineup.champions.iter().map(|c| (&c.id, c)).collect();
    if champions.len() != lineup.champions.len() {
        return Err(InterchangeError::Validation("duplicate champion id".into()));
    }
    for hero in &lineup.heroes {
        if hero.class_id.trim().is_empty() || hero.name.trim().is_empty() || hero.level == 0 {
            return Err(InterchangeError::Validation(format!(
                "hero {} has invalid name, class or level",
                hero.id
            )));
        }
        let slots: BTreeMap<_, _> = hero.equipment.iter().map(|e| (e.slot, e)).collect();
        if slots.len() != hero.equipment.len() {
            return Err(InterchangeError::Validation(format!(
                "hero {} has duplicate equipment slots",
                hero.id
            )));
        }
    }
    let mut task_ids = BTreeMap::new();
    for task in &lineup.adventure_tasks {
        if task_ids.insert(task.id, ()).is_some() {
            return Err(InterchangeError::Validation("duplicate task id".into()));
        }
        if task.quest_id.trim().is_empty() || task.difficulty == 0 {
            return Err(InterchangeError::Validation(format!(
                "task {} has invalid quest or difficulty",
                task.id
            )));
        }
        if task.group_id.is_some_and(|id| !groups.contains_key(&id)) {
            return Err(InterchangeError::Validation(format!(
                "task {} references a missing group",
                task.id
            )));
        }
        if task.champion_ids.len() > 1 {
            return Err(InterchangeError::Validation(format!(
                "task {} may contain at most one champion",
                task.id
            )));
        }
        if task.hero_ids.len() + task.champion_ids.len() > task.max_members as usize {
            return Err(InterchangeError::Validation(format!(
                "task {} exceeds its maximum party size",
                task.id
            )));
        }
        if task
            .hero_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != task.hero_ids.len()
            || task
                .champion_ids
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != task.champion_ids.len()
        {
            return Err(InterchangeError::Validation(format!(
                "task {} contains duplicate members",
                task.id
            )));
        }
        if let Some(missing) = task.hero_ids.iter().find(|id| !heroes.contains_key(id)) {
            return Err(InterchangeError::Validation(format!(
                "task {} references missing hero {missing}",
                task.id
            )));
        }
        if let Some(missing) = task
            .champion_ids
            .iter()
            .find(|id| !champions.contains_key(id))
        {
            return Err(InterchangeError::Validation(format!(
                "task {} references missing champion {missing}",
                task.id
            )));
        }
    }
    Ok(())
}

/// Reads the canonical v1 format and the two pre-release formats used by the
/// first TypeScript shell (`systems`) and early schema draft (`system`).
pub fn decode_lineup_bundle(bytes: &[u8]) -> Result<DecodedLineupBundle, InterchangeError> {
    let value: serde_json::Value = serde_json::from_slice(bytes)?;
    if value.get("format").and_then(serde_json::Value::as_str) != Some("zyslineup") {
        return Err(InterchangeError::UnsupportedFormat(
            value
                .get("format")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("<missing>")
                .to_owned(),
        ));
    }
    let schema = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default() as u32;
    if schema > LINEUP_SCHEMA_VERSION {
        return Err(InterchangeError::UnsupportedSchema {
            actual: schema,
            supported: LINEUP_SCHEMA_VERSION,
        });
    }
    if value.get("payload").is_some() {
        let envelope: PortableEnvelope<LineupSystem> = serde_json::from_value(value)?;
        validate_versions(&envelope.versions)?;
        if checksum(&envelope.payload)? != envelope.checksum_sha256 {
            return Err(InterchangeError::ChecksumMismatch);
        }
        validate_lineup(&envelope.payload)?;
        return Ok(DecodedLineupBundle {
            versions: envelope.versions,
            systems: vec![envelope.payload],
            migrated_from_legacy: false,
        });
    }

    let versions = legacy_versions(&value);
    validate_versions(&versions)?;
    let raw_systems = if let Some(systems) = value.get("systems").and_then(|v| v.as_array()) {
        systems.clone()
    } else if let Some(system) = value.get("system") {
        vec![system.clone()]
    } else {
        return Err(InterchangeError::Validation(
            "legacy file lacks system or systems".into(),
        ));
    };
    let systems = raw_systems
        .iter()
        .map(migrate_legacy_system)
        .collect::<Result<Vec<_>, _>>()?;
    for system in &systems {
        validate_lineup(system)?;
    }
    Ok(DecodedLineupBundle {
        versions,
        systems,
        migrated_from_legacy: true,
    })
}

fn legacy_versions(value: &serde_json::Value) -> Versions {
    let first = value
        .get("systems")
        .and_then(|v| v.as_array())
        .and_then(|v| v.first());
    let get = |key: &str| {
        value
            .get(key)
            .or_else(|| first.and_then(|v| v.get(key)))
            .and_then(|v| v.as_str())
            .unwrap_or("legacy-unknown")
            .to_owned()
    };
    Versions {
        app_version: get("appVersion"),
        game_data_version: get("gameDataVersion"),
        simulator_version: get("simulatorVersion"),
        asset_version: get("assetVersion"),
    }
}

/// Converts the pre-canonical TypeScript workspace shape without dropping UI fields.
/// This is public solely for the one-time SQLite migration in `hero-storage`.
pub fn migrate_legacy_system(value: &serde_json::Value) -> Result<LineupSystem, InterchangeError> {
    if value.get("adventureTasks").is_some() && value.get("groups").is_some() {
        if let Ok(system) = serde_json::from_value::<LineupSystem>(value.clone()) {
            return Ok(system);
        }
    }
    let id = parse_uuid(value, "id")?;
    let created_at = parse_time(value, "createdAt").unwrap_or_else(Utc::now);
    let updated_at = parse_time(value, "updatedAt").unwrap_or(created_at);
    let task_groups = value
        .get("taskGroups")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let groups = task_groups
        .iter()
        .enumerate()
        .map(|(index, group)| {
            Ok(LineupGroup {
                id: parse_uuid(group, "id")?,
                name: string_field(group, "name", "任务分组"),
                sort_order: index as i32,
            })
        })
        .collect::<Result<Vec<_>, InterchangeError>>()?;
    let heroes = value
        .get("heroes")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .map(migrate_legacy_hero)
        .collect::<Result<Vec<_>, _>>()?;
    let hero_ids: BTreeMap<_, _> = heroes.iter().map(|h| (h.id, ())).collect();
    let champions = migrate_legacy_champions(value);
    let champion_ids: BTreeMap<_, _> = champions.iter().map(|c| (c.id.clone(), ())).collect();
    let mut adventure_tasks = Vec::new();
    for (group, canonical_group) in task_groups.iter().zip(&groups) {
        for task in group
            .get("tasks")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let mut task_heroes = Vec::new();
            let mut task_champions = Vec::new();
            for member in task
                .get("memberIds")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str())
            {
                if let Ok(uuid) = Uuid::parse_str(member) {
                    if hero_ids.contains_key(&uuid) {
                        task_heroes.push(uuid);
                    }
                } else if champion_ids.contains_key(member) {
                    task_champions.push(member.to_owned());
                }
            }
            let difficulty = match task.get("difficulty").and_then(|v| v.as_str()) {
                Some("究极") => 4,
                // Legacy TypeScript envelopes used three labels where “困难” meant tier 2.
                // New four-tier desktop systems are converted through the canonical bridge.
                Some("困难") => 2,
                Some("中等") => 2,
                _ => 1,
            };
            adventure_tasks.push(AdventureTask {
                id: parse_uuid(task, "id")?,
                quest_id: task
                    .get("questId")
                    .or_else(|| task.get("map"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("legacy-quest")
                    .to_owned(),
                name: string_field(task, "name", "导入任务"),
                map: string_field(task, "map", ""),
                group_id: Some(canonical_group.id),
                hero_ids: task_heroes,
                champion_ids: task_champions,
                difficulty,
                max_members: task.get("maxMembers").and_then(|v| v.as_u64()).unwrap_or(4) as u8,
                barrier: task
                    .get("barrier")
                    .cloned()
                    .and_then(|v| serde_json::from_value(v).ok())
                    .unwrap_or_default(),
                config: task
                    .get("config")
                    .cloned()
                    .and_then(|v| serde_json::from_value(v).ok())
                    .unwrap_or_default(),
                result: task.get("result").cloned(),
                modifiers: Vec::new(),
                simulation: migrate_legacy_simulation(task, &legacy_versions(value)),
            });
        }
    }
    Ok(LineupSystem {
        id,
        name: string_field(value, "name", "导入体系"),
        description: string_field(value, "description", ""),
        local_public: value
            .get("localPublic")
            .or_else(|| value.get("isPublic"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        local_tag: string_field(value, "localTag", "本地"),
        schema_version: value
            .get("schemaVersion")
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32,
        game_data_version: string_field(value, "gameDataVersion", "legacy-unknown"),
        groups,
        heroes,
        champions,
        equipment_owned_counts: value
            .get("equipmentOwnedCounts")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        adventure_tasks,
        created_at,
        updated_at,
    })
}

fn migrate_legacy_hero(value: &serde_json::Value) -> Result<HeroBuild, InterchangeError> {
    let equipment = value
        .get("equipment")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let item_id = e.get("itemId")?.as_str()?.to_owned();
            let slot = match e.get("slot")?.as_str()? {
                "武器" => EquipmentSlot::Weapon,
                "头部" => EquipmentSlot::Head,
                "身体" => EquipmentSlot::Body,
                "手部" => EquipmentSlot::Hands,
                "脚部" => EquipmentSlot::Feet,
                _ => EquipmentSlot::Accessory,
            };
            let quality = match e.get("quality").and_then(|v| v.as_str()) {
                Some("传说") => Quality::Legendary,
                Some("史诗") => Quality::Epic,
                Some("高级") => Quality::Flawless,
                Some("优质") => Quality::Superior,
                _ => Quality::Normal,
            };
            Some(Equipment {
                item_id,
                name: e.get("name").and_then(|v| v.as_str()).map(str::to_owned),
                slot,
                quality,
                element: e.get("element").and_then(|v| v.as_str()).map(str::to_owned),
                spirit: e.get("spirit").and_then(|v| v.as_str()).map(str::to_owned),
                shiny: e.get("shiny").and_then(|v| v.as_bool()).unwrap_or(false),
                transcended: e
                    .get("transcended")
                    .and_then(|v| v.as_bool())
                    .unwrap_or_else(|| {
                        e.get("transcendence")
                            .and_then(|v| v.as_u64())
                            .unwrap_or_default()
                            > 0
                    }),
                transcendence: e
                    .get("transcendence")
                    .and_then(|v| v.as_u64())
                    .unwrap_or_default() as u8,
            })
        })
        .collect();
    Ok(HeroBuild {
        id: parse_uuid(value, "id")?,
        class_id: string_field(value, "classId", "legacy-class"),
        name: string_field(value, "name", "导入英雄"),
        level: value.get("level").and_then(|v| v.as_u64()).unwrap_or(1) as u16,
        rank: value.get("rank").and_then(|v| v.as_u64()).unwrap_or(1) as u8,
        seed: value
            .get("seed")
            .and_then(|v| v.as_u64())
            .unwrap_or_default() as u32,
        card_level: value
            .get("cardLevel")
            .and_then(|v| v.as_u64())
            .unwrap_or_default() as u8,
        class_name: string_field(value, "className", ""),
        sprite_path: value
            .get("spritePath")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
        element: string_field(value, "element", ""),
        stats: value
            .get("stats")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        titan: value
            .get("titan")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        seed_points: BTreeMap::new(),
        equipment,
        skill_ids: value
            .get("skills")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        card_levels: BTreeMap::new(),
    })
}

fn migrate_legacy_champions(value: &serde_json::Value) -> Vec<ChampionBuild> {
    let loadouts = value.get("championLoadouts");
    value
        .get("championIds")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .map(|id| {
            let loadout = loadouts.and_then(|v| v.get(id));
            ChampionBuild {
                id: id.to_owned(),
                loadout_present: loadout.is_some(),
                name: loadout
                    .and_then(|v| v.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(id)
                    .to_owned(),
                class_id: loadout
                    .and_then(|v| v.get("classId"))
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                sprite_path: loadout
                    .and_then(|v| v.get("spritePath"))
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                element: loadout
                    .and_then(|v| v.get("element"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned(),
                level: loadout
                    .and_then(|v| v.get("level"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1) as u16,
                rank: loadout
                    .and_then(|v| v.get("rank"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1) as u8,
                seed: loadout
                    .and_then(|v| v.get("seed"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or_default() as u32,
                card_level: loadout
                    .and_then(|v| v.get("cardLevel"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or_default() as u8,
                titan: loadout
                    .and_then(|v| v.get("titan"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                familiar_id: loadout
                    .and_then(|v| v.get("familiar"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned(),
                aura_song_id: loadout
                    .and_then(|v| v.get("aurasong"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned(),
                stats: loadout
                    .and_then(|v| v.get("stats"))
                    .cloned()
                    .and_then(|v| serde_json::from_value(v).ok())
                    .unwrap_or_default(),
                familiar: None,
                aura_song: None,
                card_levels: BTreeMap::new(),
            }
        })
        .collect()
}

fn migrate_legacy_simulation(
    task: &serde_json::Value,
    versions: &Versions,
) -> Option<SimulationSnapshot> {
    let result = task.get("result")?.clone();
    let config = task.get("config");
    Some(SimulationSnapshot {
        simulator_version: result
            .get("simulatorVersion")
            .and_then(|v| v.as_str())
            .unwrap_or(&versions.simulator_version)
            .to_owned(),
        game_data_version: result
            .get("gameDataVersion")
            .and_then(|v| v.as_str())
            .unwrap_or(&versions.game_data_version)
            .to_owned(),
        seed: config
            .and_then(|v| v.get("seed"))
            .and_then(|v| v.as_u64())
            .unwrap_or_default(),
        iterations: config
            .and_then(|v| v.get("iterations"))
            .and_then(|v| v.as_u64())
            .unwrap_or_default() as u32,
        completed_at: result
            .get("completedAt")
            .and_then(|v| v.as_str())
            .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
            .map(|v| v.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
        stale: result
            .get("stale")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        result,
    })
}

fn parse_uuid(value: &serde_json::Value, field: &str) -> Result<Uuid, InterchangeError> {
    value
        .get(field)
        .and_then(|v| v.as_str())
        .ok_or_else(|| InterchangeError::Validation(format!("missing {field}")))?
        .parse()
        .map_err(|_| InterchangeError::Validation(format!("invalid UUID in {field}")))
}

fn parse_time(value: &serde_json::Value, field: &str) -> Option<DateTime<Utc>> {
    value
        .get(field)
        .and_then(|v| v.as_str())
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|v| v.with_timezone(&Utc))
}

fn string_field(value: &serde_json::Value, field: &str, default: &str) -> String {
    value
        .get(field)
        .and_then(|v| v.as_str())
        .unwrap_or(default)
        .to_owned()
}

pub fn encode_lineup(
    lineup: &LineupSystem,
    versions: &Versions,
) -> Result<Vec<u8>, InterchangeError> {
    validate_versions(versions)?;
    validate_lineup(lineup)?;
    let envelope = PortableEnvelope {
        format: "zyslineup".to_owned(),
        schema_version: LINEUP_SCHEMA_VERSION,
        exported_at: Utc::now(),
        versions: versions.clone(),
        checksum_sha256: checksum(lineup)?,
        payload: lineup.clone(),
    };
    Ok(serde_json::to_vec_pretty(&envelope)?)
}

pub fn decode_lineup(bytes: &[u8]) -> Result<LineupSystem, InterchangeError> {
    let mut systems = decode_lineup_bundle(bytes)?.systems;
    if systems.len() != 1 {
        return Err(InterchangeError::MultipleSystems(systems.len()));
    }
    Ok(systems.remove(0))
}

pub fn write_lineup(
    path: &Path,
    lineup: &LineupSystem,
    versions: &Versions,
) -> Result<(), InterchangeError> {
    fs::write(path, encode_lineup(lineup, versions)?)?;
    Ok(())
}

pub fn read_lineup(path: &Path) -> Result<LineupSystem, InterchangeError> {
    decode_lineup(&fs::read(path)?)
}

pub fn encode_backup(backup: &Backup, versions: &Versions) -> Result<Vec<u8>, InterchangeError> {
    validate_versions(versions)?;
    for system in &backup.systems {
        validate_lineup(system)?;
    }
    let envelope = PortableEnvelope {
        format: "zysbackup".to_owned(),
        schema_version: BACKUP_SCHEMA_VERSION,
        exported_at: Utc::now(),
        versions: versions.clone(),
        checksum_sha256: checksum(backup)?,
        payload: backup.clone(),
    };
    Ok(serde_json::to_vec_pretty(&envelope)?)
}

pub fn decode_backup(bytes: &[u8]) -> Result<Backup, InterchangeError> {
    let envelope: PortableEnvelope<Backup> = serde_json::from_slice(bytes)?;
    if envelope.format != "zysbackup" {
        return Err(InterchangeError::UnsupportedFormat(envelope.format));
    }
    if envelope.schema_version > BACKUP_SCHEMA_VERSION {
        return Err(InterchangeError::UnsupportedSchema {
            actual: envelope.schema_version,
            supported: BACKUP_SCHEMA_VERSION,
        });
    }
    if checksum(&envelope.payload)? != envelope.checksum_sha256 {
        return Err(InterchangeError::ChecksumMismatch);
    }
    validate_versions(&envelope.versions)?;
    for system in &envelope.payload.systems {
        validate_lineup(system)?;
    }
    Ok(envelope.payload)
}

pub fn write_backup(
    path: &Path,
    backup: &Backup,
    versions: &Versions,
) -> Result<(), InterchangeError> {
    fs::write(path, encode_backup(backup, versions)?)?;
    Ok(())
}

pub fn read_backup(path: &Path) -> Result<Backup, InterchangeError> {
    decode_backup(&fs::read(path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn versions() -> Versions {
        Versions {
            app_version: "1.0.0".into(),
            game_data_version: "2026.07".into(),
            simulator_version: "1.0.0".into(),
            asset_version: "sha256:assets".into(),
        }
    }

    #[test]
    fn lineup_roundtrip_and_tamper_detection() {
        let original = LineupSystem::new("离线体系");
        let encoded = encode_lineup(&original, &versions()).unwrap();
        assert_eq!(decode_lineup(&encoded).unwrap(), original);

        let mut value: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
        value["payload"]["name"] = serde_json::Value::String("tampered".into());
        let altered = serde_json::to_vec(&value).unwrap();
        assert!(matches!(
            decode_lineup(&altered),
            Err(InterchangeError::ChecksumMismatch)
        ));
    }

    #[test]
    fn full_backup_roundtrips() {
        let backup = Backup {
            systems: vec![LineupSystem::new("A")],
            templates: Vec::new(),
            settings: BTreeMap::new(),
        };
        assert_eq!(
            decode_backup(&encode_backup(&backup, &versions()).unwrap()).unwrap(),
            backup
        );
    }

    #[test]
    fn online_selected_element_roundtrips_in_simulation_config() {
        let config = SimulationConfig {
            selected_element: Some("force".into()),
            ..SimulationConfig::default()
        };
        let encoded = serde_json::to_value(&config).unwrap();
        assert_eq!(encoded["selectedElement"], "force");
        assert_eq!(
            serde_json::from_value::<SimulationConfig>(encoded).unwrap(),
            config
        );
    }

    #[test]
    fn migrates_legacy_typescript_systems_envelope() {
        let raw = include_bytes!("../../../tests/fixtures/legacy-typescript-lineup-v0.json");
        let decoded = decode_lineup_bundle(raw).unwrap();
        assert!(decoded.migrated_from_legacy);
        assert_eq!(decoded.systems[0].adventure_tasks[0].difficulty, 2);
        assert_eq!(
            decoded.systems[0].adventure_tasks[0].champion_ids,
            ["argon"]
        );
    }

    #[test]
    fn rejects_dangling_references() {
        let mut system = LineupSystem::new("bad");
        system.adventure_tasks.push(AdventureTask {
            id: Uuid::new_v4(),
            quest_id: "forest01".into(),
            name: "Forest".into(),
            map: "Forest".into(),
            group_id: Some(Uuid::new_v4()),
            hero_ids: vec![],
            champion_ids: vec![],
            difficulty: 1,
            max_members: 4,
            barrier: BTreeMap::new(),
            config: SimulationConfig::default(),
            result: None,
            modifiers: vec![],
            simulation: None,
        });
        assert!(matches!(
            validate_lineup(&system),
            Err(InterchangeError::Validation(_))
        ));
    }

    #[test]
    fn rejects_more_than_one_champion_in_an_adventure_task() {
        let mut system = LineupSystem::new("bad party");
        let champion = |id: &str| ChampionBuild {
            id: id.into(),
            loadout_present: false,
            name: id.into(),
            class_id: None,
            sprite_path: None,
            element: String::new(),
            level: 1,
            rank: 1,
            seed: 0,
            card_level: 0,
            titan: false,
            familiar_id: String::new(),
            aura_song_id: String::new(),
            stats: UnitStats::default(),
            familiar: None,
            aura_song: None,
            card_levels: BTreeMap::new(),
        };
        system.champions = vec![champion("argon"), champion("lilu")];
        system.adventure_tasks.push(AdventureTask {
            id: Uuid::new_v4(),
            quest_id: "forest01".into(),
            name: "Forest".into(),
            map: "Forest".into(),
            group_id: None,
            hero_ids: vec![],
            champion_ids: vec!["argon".into(), "lilu".into()],
            difficulty: 1,
            max_members: 4,
            barrier: BTreeMap::new(),
            config: SimulationConfig::default(),
            result: None,
            modifiers: vec![],
            simulation: None,
        });
        assert!(matches!(
            validate_lineup(&system),
            Err(InterchangeError::Validation(message)) if message.contains("at most one champion")
        ));
    }
}
