//! Offline, data-driven character sheet calculation.
//!
//! The arithmetic in this crate is reconstructed from the archived web bundle
//! and consumes the bundled `TextAsset` JSON files. It intentionally reports
//! unsupported or ambiguous inputs instead of silently inventing values.

use hero_domain::{ChampionBuild, Equipment, EquipmentSlot, HeroBuild, Quality, Stat, UnitStats};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    path::{Path, PathBuf},
};
use thiserror::Error;

const HERO_SLOTS: [EquipmentSlot; 6] = [
    EquipmentSlot::Weapon,
    EquipmentSlot::Body,
    EquipmentSlot::Hands,
    EquipmentSlot::Head,
    EquipmentSlot::Feet,
    EquipmentSlot::Accessory,
];

#[derive(Debug, Error)]
pub enum CatalogError {
    #[error("cannot read {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("invalid JSON in {path}: {source}")]
    Json {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("{path} must contain a JSON object")]
    ExpectedObject { path: PathBuf },
    #[error("levels.json must contain a levels array")]
    ExpectedLevels,
}

#[derive(Debug, Clone)]
pub struct Catalog {
    classes: Map<String, Value>,
    champions: Map<String, Value>,
    items: Map<String, Value>,
    skills: Map<String, Value>,
    levels: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalculatedSheet {
    pub stats: SheetStats,
    pub issues: Vec<CalculationIssue>,
    pub applied: AppliedRules,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetStats {
    pub health: u64,
    pub attack: u64,
    pub defense: u64,
    /// Percent, matching the archived web UI (for example `5.0`).
    pub evasion: f64,
    /// Percent, matching the archived web UI (for example `5.0`).
    pub critical: f64,
    pub critical_damage: f64,
    pub aggro: f64,
    pub element_value: u32,
}

impl SheetStats {
    pub fn unit_stats(&self) -> UnitStats {
        UnitStats {
            attack: self.attack as f64,
            defense: self.defense as f64,
            health: self.health as f64,
            evasion: self.evasion,
            crit: self.critical,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalculationIssue {
    pub severity: IssueSeverity,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<EquipmentSlot>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IssueSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppliedRules {
    pub level_curve: String,
    pub equipment_formula: String,
    pub class_or_champion_id: String,
    pub equipment_count: usize,
    pub skill_ids: Vec<String>,
    pub titan_applied: bool,
}

/// Options which exist in the archived champion editor but are not yet fields
/// on [`ChampionBuild`]. Keeping them explicit avoids overloading an unrelated
/// portable field.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ChampionCalculationOptions {
    pub titan: bool,
}

#[derive(Clone, Copy)]
struct Core {
    hp: f64,
    atk: f64,
    def: f64,
    eva: f64,
    crit: f64,
    crit_mult: f64,
    aggro: f64,
}

#[derive(Default, Clone, Copy)]
struct Bonus {
    hp: f64,
    atk: f64,
    def: f64,
    eva: f64,
    crit: f64,
    crit_mult: f64,
    aggro: f64,
}

struct Resolved<'a> {
    build: &'a Equipment,
    item: &'a Value,
}

impl Catalog {
    /// Load either a package root containing `TextAsset/` or the `TextAsset/`
    /// directory itself. No network fallback exists.
    pub fn load(root: impl AsRef<Path>) -> Result<Self, CatalogError> {
        let root = root.as_ref();
        let text = if root.join("TextAsset").is_dir() {
            root.join("TextAsset")
        } else {
            root.to_path_buf()
        };
        let classes = read_object(&text.join("classes.json"))?;
        let champions = read_object(&text.join("heroes.json"))?;
        let items = read_object(&text.join("items.json"))?;
        let skills = read_object(&text.join("skills.json"))?;
        let levels_path = text.join("levels.json");
        let levels_json = read_json(&levels_path)?;
        let levels = levels_json
            .get("levels")
            .and_then(Value::as_array)
            .cloned()
            .ok_or(CatalogError::ExpectedLevels)?;
        Ok(Self {
            classes,
            champions,
            items,
            skills,
            levels,
        })
    }

    pub fn calculate_hero(&self, build: &HeroBuild) -> CalculatedSheet {
        let Some(class) = self.classes.get(&build.class_id) else {
            return empty_sheet(
                build.class_id.clone(),
                issue_error("missing_class", "本地数据中不存在该职业", None, None),
            );
        };
        let mut issues = Vec::new();
        validate_level(build.level, &mut issues);
        let resolved = self.resolve_hero_equipment(build, class, &mut issues);
        let class_element = text(class, "element").unwrap_or("fire");
        let element_value = resolved
            .iter()
            .map(|entry| self.element_value(entry.item, entry.build, class_element))
            .sum();
        let innate = text(class, "innate")
            .and_then(|family| self.skill_for_family(family, element_value, class));
        let selected_skills =
            self.resolve_skills(&build.skill_ids, element_value, class, &mut issues);

        let mut base = level_core(class, build.level);
        apply_hero_seeds(&mut base, build.seed, &build.seed_points);
        let mut equipment = Bonus::default();
        for entry in &resolved {
            let mut item = self.item_stats(entry.item, entry.build);
            self.apply_tomb_spirit(&mut item, entry.item, entry.build, build.titan);
            apply_item_skill_modifier(&mut item, entry.item, innate);
            for skill in &selected_skills {
                apply_item_skill_modifier(&mut item, entry.item, Some(skill));
            }
            equipment.add(item);
            self.apply_spirit_flat(&mut equipment, entry.item, entry.build);
        }
        base.add(equipment);

        let mut core_percent = Bonus::default();
        if let Some(skill) = innate {
            add_general_skill(skill, &mut core_percent);
        }
        for skill in &selected_skills {
            add_general_skill(skill, &mut core_percent);
        }
        apply_percent(&mut base, core_percent);
        apply_card(&mut base, build.card_level);

        CalculatedSheet {
            stats: finish(base, element_value),
            issues,
            applied: AppliedRules {
                level_curve: "archived-bundle-segmented-1-50".to_owned(),
                equipment_formula: "archived-bundle-quality-element-spirit-shiny-transcend"
                    .to_owned(),
                class_or_champion_id: build.class_id.clone(),
                equipment_count: resolved.len(),
                skill_ids: selected_skills
                    .iter()
                    .filter_map(|v| text(v, "uid").map(str::to_owned))
                    .collect(),
                titan_applied: build.titan,
            },
        }
    }

    pub fn calculate_champion(&self, build: &ChampionBuild) -> CalculatedSheet {
        self.calculate_champion_with_options(
            build,
            ChampionCalculationOptions { titan: build.titan },
        )
    }

    /// Calculate a champion with editor-only options. The archived bundle's
    /// `isTitan` path is exact; the option is separate solely because the
    /// current portable `ChampionBuild` type has no such field.
    pub fn calculate_champion_with_options(
        &self,
        build: &ChampionBuild,
        options: ChampionCalculationOptions,
    ) -> CalculatedSheet {
        let Some(champion) = self.champions.get(&build.id) else {
            return empty_sheet(
                build.id.clone(),
                issue_error("missing_champion", "本地数据中不存在该勇士", None, None),
            );
        };
        let mut issues = Vec::new();
        validate_level(build.level, &mut issues);
        if build.rank == 0 {
            issues.push(issue_error(
                "invalid_rank",
                "勇士阶级必须至少为 1",
                None,
                None,
            ));
        }
        let resolved = self.resolve_champion_equipment(build, &mut issues);
        let mut base = champion_rank_core(champion, build.level, build.rank, options.titan);
        apply_hero_seeds(&mut base, build.seed, &BTreeMap::new());
        let mut equipment = Bonus::default();
        for entry in &resolved {
            let mut item = self.item_stats(entry.item, entry.build);
            self.apply_tomb_spirit(&mut item, entry.item, entry.build, false);
            equipment.add(item);
            self.apply_spirit_flat(&mut equipment, entry.item, entry.build);
        }
        base.add(equipment);
        apply_card(&mut base, build.card_level);
        let element_value = champion_element_value(build.rank);

        CalculatedSheet {
            stats: finish(base, element_value),
            issues,
            applied: AppliedRules {
                level_curve: "archived-bundle-champion-level-rank-1-50".to_owned(),
                equipment_formula: "archived-bundle-familiar-aura-loadout".to_owned(),
                class_or_champion_id: build.id.clone(),
                equipment_count: resolved.len(),
                skill_ids: Vec::new(),
                titan_applied: options.titan,
            },
        }
    }

    pub fn validate_hero_equipment(&self, build: &HeroBuild) -> Vec<CalculationIssue> {
        let mut issues = Vec::new();
        let Some(class) = self.classes.get(&build.class_id) else {
            issues.push(issue_error(
                "missing_class",
                "本地数据中不存在该职业",
                None,
                None,
            ));
            return issues;
        };
        self.resolve_hero_equipment(build, class, &mut issues);
        issues
    }

    pub fn validate_champion_loadout(&self, build: &ChampionBuild) -> Vec<CalculationIssue> {
        let mut issues = Vec::new();
        self.resolve_champion_equipment(build, &mut issues);
        issues
    }

    fn resolve_hero_equipment<'a>(
        &'a self,
        build: &'a HeroBuild,
        class: &'a Value,
        issues: &mut Vec<CalculationIssue>,
    ) -> Vec<Resolved<'a>> {
        let mut seen = BTreeSet::new();
        let mut out = Vec::new();
        for equipment in &build.equipment {
            if !HERO_SLOTS.contains(&equipment.slot) {
                issues.push(issue_error(
                    "invalid_hero_slot",
                    "英雄只支持六个标准装备槽",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                continue;
            }
            if !seen.insert(equipment.slot) {
                issues.push(issue_error(
                    "duplicate_slot",
                    "装备槽位重复",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                continue;
            }
            let Some(item) = self.items.get(&equipment.item_id) else {
                issues.push(issue_error(
                    "missing_item",
                    "本地数据中不存在该装备 ID",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                continue;
            };
            let mut valid = true;
            let slot_number = hero_slot_number(equipment.slot);
            let allowed = text(class, &format!("slot{slot_number}"))
                .map(split_list)
                .unwrap_or_default();
            if !item_matches_types(item, &allowed) {
                issues.push(issue_error(
                    "slot_type_not_allowed",
                    "装备类型不在职业槽位代码中",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                valid = false;
            }
            if !restriction_allows(item, &build.class_id, text(class, "type").unwrap_or("")) {
                issues.push(issue_error(
                    "class_restricted",
                    "装备 restrict 字段不允许该职业",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                valid = false;
            }
            // items.json `level` is the shop/crafting progression level, not a hero
            // equip requirement. The web editor gates hero equipment by its tier
            // curve (a level-40 hero can use T16), so only that rule belongs here.
            let max_tier = self.equipment_tier(build.level);
            if number(item, "tier") > max_tier {
                issues.push(issue_error(
                    "tier_locked",
                    "装备阶数高于当前英雄等级可用阶数",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                valid = false;
            }
            self.validate_attachments(equipment, issues);
            if valid {
                out.push(Resolved {
                    build: equipment,
                    item,
                });
            }
        }
        out
    }

    fn resolve_champion_equipment<'a>(
        &'a self,
        build: &'a ChampionBuild,
        issues: &mut Vec<CalculationIssue>,
    ) -> Vec<Resolved<'a>> {
        let mut out = Vec::new();
        for (expected, equipment) in [
            (EquipmentSlot::Familiar, build.familiar.as_ref()),
            (EquipmentSlot::AuraSong, build.aura_song.as_ref()),
        ] {
            let Some(equipment) = equipment else { continue };
            if equipment.slot != expected {
                issues.push(issue_error(
                    "loadout_slot_mismatch",
                    "勇士装备不在对应的随从/光环槽",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                continue;
            }
            let Some(item) = self.items.get(&equipment.item_id) else {
                issues.push(issue_error(
                    "missing_item",
                    "本地数据中不存在该装备 ID",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                continue;
            };
            let expected_type = if expected == EquipmentSlot::Familiar {
                "xf"
            } else {
                "xx"
            };
            if text(item, "type") != Some(expected_type) {
                issues.push(issue_error(
                    "loadout_type_not_allowed",
                    "装备类型不适用于该勇士槽",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                continue;
            }
            if number(item, "level") > f64::from(build.level) {
                issues.push(issue_error(
                    "level_too_low",
                    "勇士等级低于装备等级",
                    Some(&equipment.item_id),
                    Some(equipment.slot),
                ));
                continue;
            }
            self.validate_attachments(equipment, issues);
            out.push(Resolved {
                build: equipment,
                item,
            });
        }
        out
    }

    fn validate_attachments(&self, equipment: &Equipment, issues: &mut Vec<CalculationIssue>) {
        for (id, code, expected_field, message) in [
            (
                equipment.element.as_deref(),
                "missing_element_core",
                "elements",
                "本地数据中不存在有效的元素核心 ID",
            ),
            (
                equipment.spirit.as_deref(),
                "missing_spirit_core",
                "skill",
                "本地数据中不存在有效的精魂 ID",
            ),
        ] {
            let Some(id) = id else { continue };
            if !self.items.get(id).is_some_and(|value| {
                value
                    .get(expected_field)
                    .is_some_and(|value| !value.is_null())
            }) {
                issues.push(issue_error(code, message, Some(id), Some(equipment.slot)));
            }
        }
    }

    fn equipment_tier(&self, level: u16) -> f64 {
        self.levels
            .iter()
            .find(|entry| number(entry, "level") == f64::from(level))
            .map(|entry| number(entry, "etier"))
            .unwrap_or(1.0)
    }

    fn resolve_skills<'a>(
        &'a self,
        ids: &[String],
        element_value: u32,
        class: &Value,
        issues: &mut Vec<CalculationIssue>,
    ) -> Vec<&'a Value> {
        let mut out = Vec::new();
        let mut families = BTreeSet::new();
        for id in ids {
            let Some(skill) = self.skills.get(id) else {
                issues.push(issue_warning(
                    "missing_skill",
                    "本地数据中不存在该技能 ID",
                    Some(id),
                    None,
                ));
                continue;
            };
            let family = text(skill, "family").unwrap_or(id);
            if !families.insert(family.to_owned()) {
                issues.push(issue_warning(
                    "duplicate_skill_family",
                    "同一技能族只应用一次",
                    Some(id),
                    None,
                ));
                continue;
            }
            out.push(
                self.skill_for_family(family, element_value, class)
                    .unwrap_or(skill),
            );
        }
        out
    }

    fn skill_for_family<'a>(
        &'a self,
        family: &str,
        element_value: u32,
        class: &Value,
    ) -> Option<&'a Value> {
        let max_tier = if class.get("titanClass").is_some_and(Value::is_null) {
            4
        } else {
            3
        };
        (1..=max_tier).rev().find_map(|tier| {
            let skill = self.skills.get(&format!("{family}{tier}"))?;
            (element_value as f64 >= number(skill, "elements")).then_some(skill)
        })
    }

    fn element_value(&self, item: &Value, build: &Equipment, unit_element: &str) -> u32 {
        let Some(element_id) = build.element.as_deref() else {
            return 0;
        };
        let Some(core) = self.items.get(element_id) else {
            return 0;
        };
        let Some((element, value)) = parse_element(text(core, "elements")) else {
            return 0;
        };
        if element != unit_element && unit_element != "all" {
            return 0;
        }
        let affinities = text(item, "elementAffinity")
            .map(split_list)
            .unwrap_or_default();
        let bonus = if affinities.iter().any(|it| it == element) {
            if number(core, "tier") < 12.0 {
                5
            } else {
                10
            }
        } else if affinities.iter().any(|it| it == "all") {
            5
        } else {
            0
        };
        value + bonus
    }

    fn item_stats(&self, item: &Value, build: &Equipment) -> Bonus {
        let transcend = build.transcended || build.transcendence > 0;
        let upgrades = if transcend {
            transcend_bonus(item)
        } else {
            Bonus::default()
        };
        let raw = Bonus {
            atk: number(item, "atk") + upgrades.atk,
            def: number(item, "def") + upgrades.def,
            hp: number(item, "hp") + upgrades.hp,
            eva: number(item, "eva") + upgrades.eva,
            crit: number(item, "crit") + upgrades.crit,
            ..Bonus::default()
        };
        let quality = quality_multiplier(build.quality);
        let mut result = Bonus {
            atk: (raw.atk * quality).round(),
            def: (raw.def * quality).round(),
            hp: (raw.hp * quality).round(),
            eva: raw.eva,
            crit: raw.crit,
            ..Bonus::default()
        };
        if let Some(element) = build.element.as_deref().and_then(|id| self.items.get(id)) {
            add_core_attachment(&mut result, &raw, item, element, true);
        }
        if let Some(spirit) = build.spirit.as_deref().and_then(|id| self.items.get(id)) {
            add_core_attachment(&mut result, &raw, item, spirit, false);
        }
        // The portable domain currently stores only the shiny flag, not the
        // archived UI's optional shinyLevel. A true flag therefore means the
        // fully unlocked five-step shiny track, matching the web default.
        let shiny_multiplier = shiny_multiplier(item, build.shiny, 0);
        let trans_multiplier = if transcend { upgrades.crit_mult } else { 1.0 };
        let multiplier = 1.0 + (shiny_multiplier - 1.0) + (trans_multiplier - 1.0);
        result.atk = (result.atk * multiplier).round();
        result.def = (result.def * multiplier).round();
        result.hp = (result.hp * multiplier).round();
        result
    }

    fn apply_spirit_flat(&self, bonus: &mut Bonus, item: &Value, build: &Equipment) {
        let Some(spirit) = build.spirit.as_deref().and_then(|id| self.items.get(id)) else {
            return;
        };
        let Some(family) = text(spirit, "skill") else {
            return;
        };
        let affinity = text(item, "spiritAffinity")
            .map(split_list)
            .is_some_and(|ids| ids.iter().any(|id| id == text(spirit, "uid").unwrap_or("")));
        let skill_id = if affinity {
            format!("{family}_plus")
        } else {
            family.to_owned()
        };
        let Some(skill) = self.skills.get(&skill_id) else {
            return;
        };
        let scale = if text(item, "type") == Some("xi") {
            2.0
        } else {
            1.0
        };
        bonus.atk += number(skill, "atkAbs") * scale;
        bonus.def += number(skill, "defAbs") * scale;
        bonus.hp += number(skill, "hpAbs") * scale;
        bonus.eva += number(skill, "evasion") * scale;
        bonus.crit += number(skill, "critical") * scale;
        bonus.crit_mult += number(skill, "critMult") * scale;
        bonus.aggro += number(skill, "aggro") * scale;
    }

    fn apply_tomb_spirit(
        &self,
        item_stats: &mut Bonus,
        item: &Value,
        build: &Equipment,
        titan_tower_or_tomb: bool,
    ) {
        let Some(spirit) = build.spirit.as_deref().and_then(|id| self.items.get(id)) else {
            return;
        };
        if text(spirit, "skill") != Some("i_tomb") {
            return;
        }
        let affinity = text(item, "spiritAffinity")
            .map(split_list)
            .is_some_and(|ids| ids.iter().any(|id| id == text(spirit, "uid").unwrap_or("")));
        let skill_id = if affinity { "i_tomb_plus" } else { "i_tomb" };
        let Some(skill) = self.skills.get(skill_id) else {
            return;
        };
        let multiplier = 1.0 + number(skill, "item") * if titan_tower_or_tomb { 2.0 } else { 1.0 };
        item_stats.atk = (item_stats.atk * multiplier).round();
        item_stats.def = (item_stats.def * multiplier).round();
        item_stats.hp = (item_stats.hp * multiplier).round();
    }
}

fn read_json(path: &Path) -> Result<Value, CatalogError> {
    serde_json::from_reader(File::open(path).map_err(|source| CatalogError::Io {
        path: path.to_path_buf(),
        source,
    })?)
    .map_err(|source| CatalogError::Json {
        path: path.to_path_buf(),
        source,
    })
}

fn read_object(path: &Path) -> Result<Map<String, Value>, CatalogError> {
    read_json(path)?
        .as_object()
        .cloned()
        .ok_or_else(|| CatalogError::ExpectedObject {
            path: path.to_path_buf(),
        })
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn number(value: &Value, key: &str) -> f64 {
    value
        .get(key)
        .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
        .unwrap_or(0.0)
}

fn split_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}

fn parse_element(value: Option<&str>) -> Option<(&str, u32)> {
    let (element, amount) = value?.split_once('+')?;
    Some((element, amount.parse().ok()?))
}

fn item_matches_types(item: &Value, allowed: &[String]) -> bool {
    if allowed.is_empty() {
        return false;
    }
    let item_type = text(item, "type").unwrap_or("");
    if allowed.iter().any(|candidate| candidate == item_type) {
        return true;
    }
    text(item, "multiType")
        .map(split_list)
        .is_some_and(|types| types.iter().any(|kind| allowed.contains(kind)))
}

fn restriction_allows(item: &Value, class_id: &str, class_type: &str) -> bool {
    let Some(restrict) = text(item, "restrict") else {
        return true;
    };
    let entries = split_list(restrict);
    entries.is_empty()
        || entries
            .iter()
            .any(|entry| entry == class_id || entry == class_type || entry == "*")
}

fn hero_slot_number(slot: EquipmentSlot) -> usize {
    match slot {
        EquipmentSlot::Weapon => 1,
        EquipmentSlot::Body => 2,
        EquipmentSlot::Hands => 3,
        EquipmentSlot::Head => 4,
        EquipmentSlot::Feet => 5,
        EquipmentSlot::Accessory => 6,
        EquipmentSlot::Familiar | EquipmentSlot::AuraSong => 0,
    }
}

fn level_value(start: f64, at_40: f64, at_50: f64, level: u16) -> f64 {
    if level <= 1 {
        return start.round();
    }
    let level = level.clamp(1, 50);
    if level <= 40 {
        let increment = (at_40 - start) / 100.0;
        let steps = f64::from(level - 1);
        let weighted = steps.min(8.0)
            + 2.0 * (steps.min(19.0) - 8.0).max(0.0)
            + 3.0 * (steps.min(29.0) - 19.0).max(0.0)
            + 4.0 * (steps - 29.0).max(0.0);
        (start + increment * weighted).round()
    } else {
        let ratio = f64::from(level - 40) / 10.0;
        (at_40 + (at_50 - at_40) * ratio).round()
    }
}

fn level_core(record: &Value, level: u16) -> Core {
    Core {
        hp: level_value(
            number(record, "hp"),
            number(record, "maxHp40"),
            number(record, "maxHp50"),
            level,
        ),
        atk: level_value(
            number(record, "atk"),
            number(record, "maxAtk40"),
            number(record, "maxAtk50"),
            level,
        ),
        def: level_value(
            number(record, "def"),
            number(record, "maxDef40"),
            number(record, "maxDef50"),
            level,
        ),
        eva: number(record, "evasion"),
        crit: number(record, "critical"),
        crit_mult: number(record, "critMult"),
        aggro: number(record, "aggro"),
    }
}

fn champion_rank_core(record: &Value, level: u16, rank: u8, titan: bool) -> Core {
    let mut core = level_core(record, level);
    let story = Bonus {
        hp: number(record, "storyHp"),
        atk: number(record, "storyAtk"),
        def: number(record, "storyDef"),
        ..Bonus::default()
    };
    let mut rank_bonus = Bonus::default();
    for index in 1..=11 {
        if u16::from(rank) > index {
            if let Some(multiplier) = stat_upgrade(record, &format!("upg{index:02}")) {
                rank_bonus.hp += story.hp * multiplier;
                rank_bonus.atk += story.atk * multiplier;
                rank_bonus.def += story.def * multiplier;
            }
        }
    }
    if rank > 12 {
        if let Some(multiplier) = stat_upgrade(record, "upg11") {
            let repeated = f64::from(rank - 12);
            rank_bonus.hp += story.hp * multiplier * repeated;
            rank_bonus.atk += story.atk * multiplier * repeated;
            rank_bonus.def += story.def * multiplier * repeated;
        }
    }
    rank_bonus.hp = rank_bonus.hp.floor();
    rank_bonus.atk = rank_bonus.atk.floor();
    rank_bonus.def = rank_bonus.def.floor();
    if titan {
        let titan_bonus = stat_upgrade(record, "upgTitan").unwrap_or(0.0);
        rank_bonus.hp = ((rank_bonus.hp + (story.hp * titan_bonus).floor()) * 1.5).floor();
        rank_bonus.atk = ((rank_bonus.atk + (story.atk * titan_bonus).floor()) * 1.5).floor();
        rank_bonus.def = ((rank_bonus.def + (story.def * titan_bonus).floor()) * 1.5).floor();
    }
    core.add(rank_bonus);
    core
}

fn stat_upgrade(record: &Value, key: &str) -> Option<f64> {
    let value = text(record, key)?;
    value.strip_prefix("stat+")?.parse().ok()
}

fn champion_element_value(rank: u8) -> u32 {
    match rank {
        0..=4 => 0,
        5 => 15,
        6..=7 => 30,
        8 => 45,
        9 => 60,
        10..=11 => 80,
        12..=13 => 90,
        14..=15 => 100,
        16..=19 => 110,
        _ => 125,
    }
}

fn transcend_bonus(item: &Value) -> Bonus {
    let mut bonus = Bonus {
        crit_mult: 1.0,
        ..Bonus::default()
    };
    for index in 4..=6 {
        let Some(upgrade) = text(item, &format!("supgrade{index}")) else {
            continue;
        };
        if let Some(value) = upgrade.strip_prefix("baseStats*") {
            if let Ok(multiplier) = value.parse::<f64>() {
                bonus.crit_mult *= multiplier;
            }
            continue;
        }
        for (prefix, target) in [
            ("atk+", &mut bonus.atk),
            ("def+", &mut bonus.def),
            ("hp+", &mut bonus.hp),
            ("eva+", &mut bonus.eva),
            ("crit+", &mut bonus.crit),
        ] {
            if let Some(value) = upgrade.strip_prefix(prefix) {
                if let Ok(value) = value.parse::<f64>() {
                    *target += value;
                }
                break;
            }
        }
    }
    bonus
}

fn shiny_multiplier(item: &Value, shiny: bool, shiny_level: u8) -> f64 {
    let levels = if shiny_level > 0 {
        shiny_level.min(5)
    } else if shiny {
        5
    } else {
        0
    };
    let mut multiplier = 1.0;
    for index in 1..=levels {
        let Some(value) = text(item, &format!("upgradeShiny{index}")) else {
            continue;
        };
        if let Some(value) = value.strip_prefix("baseStats*") {
            if let Ok(value) = value.parse::<f64>() {
                multiplier *= value;
            }
        }
    }
    multiplier
}

fn quality_multiplier(quality: Quality) -> f64 {
    match quality {
        Quality::Normal => 1.0,
        Quality::Superior => 1.25,
        Quality::Flawless => 1.5,
        Quality::Epic => 2.0,
        Quality::Legendary => 3.0,
    }
}

fn add_core_attachment(
    result: &mut Bonus,
    base: &Bonus,
    item: &Value,
    core: &Value,
    elemental: bool,
) {
    let affinity_key = if elemental {
        "elementAffinity"
    } else {
        "spiritAffinity"
    };
    let core_id = text(core, "uid").unwrap_or("");
    let affinity = text(item, affinity_key).map(split_list).is_some_and(|ids| {
        ids.iter()
            .any(|id| id == core_id || (elemental && id == "all"))
    });
    let multiplier = if affinity { 1.5 } else { 1.0 };
    result.atk += (number(core, "atk") * multiplier).floor().min(base.atk);
    result.def += (number(core, "def") * multiplier).floor().min(base.def);
    result.hp += (number(core, "hp") * multiplier).floor().min(base.hp);
}

fn primary_stat(item: &Value) -> &'static str {
    let atk = number(item, "atk");
    let def = number(item, "def");
    let hp = number(item, "hp");
    if atk > 0.0 && atk >= def && atk >= hp {
        "atk"
    } else if hp > def {
        "hp"
    } else {
        "def"
    }
}

fn apply_item_skill_modifier(item_stats: &mut Bonus, item: &Value, skill: Option<&Value>) {
    let Some(skill) = skill else { return };
    let Some(types) = text(skill, "itemTypes") else {
        return;
    };
    let types = split_list(types);
    if !item_matches_types(item, &types) && !types.iter().any(|it| it == "*") {
        return;
    }
    let percent = number(skill, "item");
    if percent == 0.0 {
        return;
    }
    if skill
        .get("affectSecStat")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        item_stats.atk = (item_stats.atk * (1.0 + percent)).round();
        item_stats.def = (item_stats.def * (1.0 + percent)).round();
        item_stats.hp = (item_stats.hp * (1.0 + percent)).round();
    } else {
        match primary_stat(item) {
            "atk" => item_stats.atk = (item_stats.atk * (1.0 + percent)).round(),
            "hp" => item_stats.hp = (item_stats.hp * (1.0 + percent)).round(),
            _ => item_stats.def = (item_stats.def * (1.0 + percent)).round(),
        }
    }
}

fn add_general_skill(skill: &Value, bonus: &mut Bonus) {
    bonus.atk += number(skill, "atk");
    bonus.def += number(skill, "def");
    bonus.hp += number(skill, "hp");
    bonus.eva += number(skill, "evasion");
    bonus.crit += number(skill, "critical");
    bonus.crit_mult += number(skill, "critMult");
    bonus.aggro += number(skill, "aggro");
}

fn apply_hero_seeds(core: &mut Core, uniform_seed: u32, seeds: &BTreeMap<Stat, i32>) {
    // The archived editor's single seed control writes the same value to
    // seedHp/seedAtk/seedDef. Per-stat seed_points, when present, override the
    // portable scalar for that stat rather than double-counting it.
    let uniform = f64::from(uniform_seed);
    core.hp += seeds
        .get(&Stat::Health)
        .map_or(uniform, |value| f64::from(*value));
    core.atk += seeds
        .get(&Stat::Attack)
        .map_or(uniform, |value| f64::from(*value))
        * 4.0;
    core.def += seeds
        .get(&Stat::Defense)
        .map_or(uniform, |value| f64::from(*value))
        * 4.0;
    core.eva += f64::from(*seeds.get(&Stat::Evasion).unwrap_or(&0));
    core.crit += f64::from(*seeds.get(&Stat::CriticalChance).unwrap_or(&0));
    core.crit_mult += f64::from(*seeds.get(&Stat::CriticalDamage).unwrap_or(&0));
}

fn apply_percent(core: &mut Core, percent: Bonus) {
    core.atk = (core.atk * (1.0 + percent.atk)).floor();
    core.def = (core.def * (1.0 + percent.def)).floor();
    core.hp = (core.hp * (1.0 + percent.hp)).round();
    core.eva += percent.eva;
    core.crit += percent.crit;
    core.crit_mult += percent.crit_mult;
    core.aggro += percent.aggro;
}

fn apply_card(core: &mut Core, card_level: u8) {
    let multiplier = match card_level.min(3) {
        1 => 0.05,
        2 => 0.10,
        3 => 0.25,
        _ => 0.0,
    };
    core.atk *= 1.0 + multiplier;
    core.def *= 1.0 + multiplier;
    core.hp *= 1.0 + multiplier;
}

impl Core {
    fn add(&mut self, bonus: Bonus) {
        self.hp += bonus.hp;
        self.atk += bonus.atk;
        self.def += bonus.def;
        self.eva += bonus.eva;
        self.crit += bonus.crit;
        self.crit_mult += bonus.crit_mult;
        self.aggro += bonus.aggro;
    }
}

impl Bonus {
    fn add(&mut self, other: Bonus) {
        self.hp += other.hp;
        self.atk += other.atk;
        self.def += other.def;
        self.eva += other.eva;
        self.crit += other.crit;
        self.crit_mult += other.crit_mult;
        self.aggro += other.aggro;
    }
}

fn finish(core: Core, element_value: u32) -> SheetStats {
    SheetStats {
        health: core.hp.max(1.0).round() as u64,
        attack: core.atk.max(0.0).floor() as u64,
        defense: core.def.max(0.0).floor() as u64,
        evasion: core.eva * 100.0,
        critical: core.crit * 100.0,
        critical_damage: core.crit_mult,
        aggro: core.aggro,
        element_value,
    }
}

fn validate_level(level: u16, issues: &mut Vec<CalculationIssue>) {
    if !(1..=50).contains(&level) {
        issues.push(issue_error(
            "invalid_level",
            "等级必须在 1–50 之间；计算时会按归档规则钳制",
            None,
            None,
        ));
    }
}

fn issue_error(
    code: &str,
    message: &str,
    item_id: Option<&str>,
    slot: Option<EquipmentSlot>,
) -> CalculationIssue {
    CalculationIssue {
        severity: IssueSeverity::Error,
        code: code.to_owned(),
        message: message.to_owned(),
        item_id: item_id.map(str::to_owned),
        slot,
    }
}

fn issue_warning(
    code: &str,
    message: &str,
    item_id: Option<&str>,
    slot: Option<EquipmentSlot>,
) -> CalculationIssue {
    CalculationIssue {
        severity: IssueSeverity::Warning,
        code: code.to_owned(),
        message: message.to_owned(),
        item_id: item_id.map(str::to_owned),
        slot,
    }
}

fn empty_sheet(id: String, issue: CalculationIssue) -> CalculatedSheet {
    CalculatedSheet {
        stats: SheetStats {
            health: 0,
            attack: 0,
            defense: 0,
            evasion: 0.0,
            critical: 0.0,
            critical_damage: 0.0,
            aggro: 0.0,
            element_value: 0,
        },
        issues: vec![issue],
        applied: AppliedRules {
            level_curve: "not-applied".to_owned(),
            equipment_formula: "not-applied".to_owned(),
            class_or_champion_id: id,
            equipment_count: 0,
            skill_ids: Vec::new(),
            titan_applied: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use uuid::Uuid;

    fn catalog() -> Catalog {
        Catalog::load(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content"))
            .expect("bundled catalog")
    }

    fn equipment(id: &str, slot: EquipmentSlot) -> Equipment {
        Equipment {
            item_id: id.to_owned(),
            name: None,
            slot,
            quality: Quality::Normal,
            element: None,
            spirit: None,
            shiny: false,
            transcended: false,
            transcendence: 0,
        }
    }

    fn knight(level: u16, equipment: Vec<Equipment>) -> HeroBuild {
        HeroBuild {
            id: Uuid::nil(),
            class_id: "knight".to_owned(),
            name: "fixture".to_owned(),
            level,
            rank: 1,
            seed: 0,
            card_level: 0,
            class_name: String::new(),
            sprite_path: None,
            element: "light".to_owned(),
            stats: UnitStats::default(),
            titan: false,
            seed_points: BTreeMap::new(),
            equipment,
            skill_ids: Vec::new(),
            card_levels: BTreeMap::new(),
        }
    }

    #[test]
    fn validation_covers_missing_duplicate_slot_type_tier_and_restrict() {
        let mut catalog = catalog();
        catalog.items.get_mut("longsword").unwrap()["restrict"] = Value::String("mage".to_owned());
        let build = knight(
            1,
            vec![
                equipment("missing", EquipmentSlot::Weapon),
                equipment("longsword", EquipmentSlot::Weapon),
                equipment("longsword", EquipmentSlot::Weapon),
                equipment("longsword", EquipmentSlot::Head),
                equipment("troblin", EquipmentSlot::Familiar),
            ],
        );
        let codes: BTreeSet<_> = catalog
            .validate_hero_equipment(&build)
            .into_iter()
            .map(|issue| issue.code)
            .collect();
        assert!(codes.contains("missing_item"));
        assert!(codes.contains("duplicate_slot"));
        assert!(codes.contains("slot_type_not_allowed"));
        assert!(codes.contains("tier_locked"));
        assert!(codes.contains("class_restricted"));
        assert!(codes.contains("invalid_hero_slot"));
    }

    #[test]
    fn archived_level_curve_has_exact_boundaries() {
        assert_eq!(level_value(42.0, 420.0, 630.0, 1), 42.0);
        assert_eq!(level_value(42.0, 420.0, 630.0, 40), 420.0);
        assert_eq!(level_value(42.0, 420.0, 630.0, 50), 630.0);
    }

    #[test]
    fn level_40_hero_can_equip_tier_16_items_despite_crafting_level_47() {
        let catalog = catalog();
        let mut build = knight(
            40,
            vec![
                equipment("spacestaff", EquipmentSlot::Weapon),
                equipment("lucky7roguearmor", EquipmentSlot::Body),
            ],
        );
        build.class_id = "spellknight".to_owned();
        let sheet = catalog.calculate_hero(&build);
        assert!(!sheet
            .issues
            .iter()
            .any(|issue| issue.code == "level_too_low"));
        assert!(!sheet
            .issues
            .iter()
            .any(|issue| issue.code == "slot_type_not_allowed"));
        assert_eq!(sheet.applied.equipment_count, 2);
    }

    #[test]
    fn quality_mapping_matches_archived_bundle_not_domain_legacy_multiplier() {
        assert_eq!(quality_multiplier(Quality::Normal), 1.0);
        assert_eq!(quality_multiplier(Quality::Superior), 1.25);
        assert_eq!(quality_multiplier(Quality::Flawless), 1.5);
        assert_eq!(quality_multiplier(Quality::Epic), 2.0);
        assert_eq!(quality_multiplier(Quality::Legendary), 3.0);
    }

    #[test]
    fn transcend_expression_and_attachment_validation_are_data_driven() {
        let catalog = catalog();
        let mut pike = equipment("pike", EquipmentSlot::Weapon);
        pike.transcended = true;
        pike.element = Some("not-an-element".to_owned());
        pike.spirit = Some("not-a-spirit".to_owned());
        let item = catalog.items.get("pike").unwrap();
        let stats = catalog.item_stats(item, &pike);
        assert_eq!(stats.atk, 254.0); // (210 + 21) * 1.10
        assert_eq!(stats.def, 23.0); // (0 + 21) * 1.10

        let issues = catalog.validate_hero_equipment(&knight(40, vec![pike]));
        let codes: BTreeSet<_> = issues.into_iter().map(|issue| issue.code).collect();
        assert!(codes.contains("missing_element_core"));
        assert!(codes.contains("missing_spirit_core"));
    }

    #[test]
    fn champion_titan_option_matches_archived_rank_formula() {
        let catalog = catalog();
        let build = ChampionBuild {
            id: "argon".to_owned(),
            loadout_present: false,
            name: String::new(),
            class_id: None,
            sprite_path: None,
            element: "light".to_owned(),
            level: 40,
            rank: 11,
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
        let result = catalog
            .calculate_champion_with_options(&build, ChampionCalculationOptions { titan: true });
        assert_eq!(result.stats.health, 934);
        assert_eq!(result.stats.attack, 3942);
        assert_eq!(result.stats.defense, 5502);
        assert!(result.applied.titan_applied);
    }

    #[test]
    fn portable_uniform_seed_matches_archived_editor_three_field_write() {
        let catalog = catalog();
        let mut build = knight(40, vec![]);
        build.seed = 3;
        let result = catalog.calculate_hero(&build);
        assert_eq!(result.stats.health, 423);
        assert_eq!(result.stats.attack, 362);
        assert_eq!(result.stats.defense, 512);

        build.seed_points.insert(Stat::Attack, 1);
        let overridden = catalog.calculate_hero(&build);
        assert_eq!(overridden.stats.health, 423);
        assert_eq!(overridden.stats.attack, 354);
        assert_eq!(overridden.stats.defense, 512);
    }
}
