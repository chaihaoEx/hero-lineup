mod content_manager;

use chrono::Utc;
use content_manager::{ContentPaths, ContentStatus, DataInstallResult};
use hero_domain::{
    decode_backup, decode_lineup_bundle, encode_backup, encode_lineup, ChampionBuild, HeroBuild,
    LineupSystem, Template, Versions,
};
use hero_simulator::{
    simulate_advanced, AdvancedSimulationRequest, BarrierMode, BattleRules, BoosterBonus,
    CalculatedStats, CancellationToken, CombatRule, Combatant, Element, ElementBarrier,
    ElementContribution, EliteKind, QuestEnemy, SimulationRequest as CoreSimulationRequest,
    TitanFloorCorrection,
};
use hero_storage::Storage;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct DesktopState {
    storage: Mutex<Storage>,
    simulation_tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    content_paths: ContentPaths,
    content_install_lock: Mutex<()>,
    active_content_root: Mutex<PathBuf>,
}

const SIMULATOR_VERSION: &str = "hero-simulator-0.1.0";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulationRequest {
    task: Value,
    units: Vec<Value>,
    #[serde(default)]
    system_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SimulationProgress {
    task_id: String,
    completed: u64,
    total: u64,
    phase: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogClass {
    id: String,
    name: String,
    r#type: String,
    innate_skill_family: Option<String>,
    skill_slots: usize,
    skill_unlock_levels: Vec<u16>,
    max_skill_level: u8,
    element: String,
    all_elements: bool,
    color: String,
    sprite_path: Option<String>,
    slots: Vec<Vec<String>>,
    stats: CatalogStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogChampion {
    id: String,
    name: String,
    class_id: String,
    element: String,
    sprite_path: Option<String>,
    team_skill_ids: Vec<String>,
    team_skills: Vec<CatalogTeamSkill>,
    stats: CatalogStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogTeamSkill {
    id: String,
    name: String,
    tier: u64,
    sprite_path: Option<String>,
    effects: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogQuest {
    id: String,
    name: String,
    map_name: String,
    map_label: Option<String>,
    map_key: String,
    category: String,
    difficulty: String,
    difficulty_level: u64,
    variant_order: u64,
    is_boss: bool,
    max_members: u64,
    barrier_elements: Vec<String>,
    barrier_element: Option<String>,
    barrier_power: f64,
    sprite_path: Option<String>,
    map_sprite_path: Option<String>,
    difficulty_sprite_path: Option<String>,
    difficulty_background_path: Option<String>,
    #[serde(skip)]
    map_order: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogItem {
    id: String,
    name: String,
    item_type: String,
    type_name: String,
    tier: u64,
    level: u64,
    source_order: u64,
    restricted_class: Option<String>,
    sprite_path: Option<String>,
    attack: f64,
    defense: f64,
    health: f64,
    evasion: f64,
    critical: f64,
    shiny_multiplier: f64,
    transcend_multiplier: f64,
    transcend_attack: f64,
    transcend_defense: f64,
    transcend_health: f64,
    transcend_evasion: f64,
    transcend_critical: f64,
    elements: Option<String>,
    skill: Option<String>,
    element_affinity: Option<String>,
    spirit_affinity: Option<String>,
    built_in_element_id: Option<String>,
    built_in_spirit_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSkill {
    id: String,
    name: String,
    family: String,
    category: Option<String>,
    tier: u64,
    classes: Vec<String>,
    rarity: u64,
    elements: u64,
    rank: u64,
    source_order: u64,
    sprite_path: Option<String>,
    effects: Vec<String>,
    innate_effects: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogStats {
    attack: u64,
    defense: u64,
    health: u64,
    evasion: f64,
    crit: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogCounts {
    classes: usize,
    champions: usize,
    quests: usize,
    items: usize,
    skills: usize,
    sprites: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    schema_version: u64,
    game_data_version: String,
    asset_version: String,
    classes: Vec<CatalogClass>,
    champions: Vec<CatalogChampion>,
    quests: Vec<CatalogQuest>,
    items: Vec<CatalogItem>,
    skills: Vec<CatalogSkill>,
    counts: CatalogCounts,
}

fn read_json(path: &Path) -> Result<Value, String> {
    let payload = fs::read_to_string(path)
        .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    serde_json::from_str(&payload).map_err(|error| format!("无法解析 {}：{error}", path.display()))
}

fn object_at<'a>(
    value: &'a Value,
    description: &str,
) -> Result<&'a serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{description} 必须是 JSON 对象"))
}

fn localized(texts: &serde_json::Map<String, Value>, keys: &[String], fallback: &str) -> String {
    keys.iter()
        .find_map(|key| texts.get(key).and_then(Value::as_str))
        .unwrap_or(fallback)
        .to_owned()
}

fn cn_element(raw: Option<&str>) -> String {
    match raw.unwrap_or_default() {
        "fire" => "火",
        "water" => "水",
        "earth" => "土",
        "air" => "风",
        "dark" => "暗",
        "light" | "gold" | "all" => "光",
        _ => "光",
    }
    .to_owned()
}

fn element_color(element: &str) -> String {
    match element {
        "火" => "#e96362",
        "水" => "#4594dc",
        "土" => "#9a7a52",
        "风" => "#3fa982",
        "暗" => "#7759c6",
        _ => "#f4b942",
    }
    .to_owned()
}

fn numeric(value: &Value, key: &str) -> f64 {
    value
        .get(key)
        .and_then(|entry| entry.as_f64().or_else(|| entry.as_str()?.parse().ok()))
        .unwrap_or_default()
}

#[derive(Debug, Clone, Copy)]
struct CatalogTranscendStats {
    multiplier: f64,
    attack: f64,
    defense: f64,
    health: f64,
    evasion: f64,
    critical: f64,
}

fn expression_factor(expression: &str, prefix: &str) -> Option<f64> {
    expression
        .strip_prefix(prefix)?
        .parse::<f64>()
        .ok()
        .filter(|value| *value > 0.0)
}

fn shiny_catalog_multiplier(value: &Value) -> f64 {
    (1..=5).fold(1.0, |multiplier, index| {
        value
            .get(format!("upgradeShiny{index}"))
            .and_then(Value::as_str)
            .and_then(|expression| expression_factor(expression, "baseStats*"))
            .map_or(multiplier, |factor| multiplier * factor)
    })
}

fn transcend_catalog_stats(value: &Value) -> CatalogTranscendStats {
    let mut stats = CatalogTranscendStats {
        multiplier: 1.0,
        attack: 0.0,
        defense: 0.0,
        health: 0.0,
        evasion: 0.0,
        critical: 0.0,
    };
    for index in 4..=6 {
        let Some(expression) = value
            .get(format!("supgrade{index}"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if let Some(factor) = expression_factor(expression, "baseStats*") {
            stats.multiplier *= factor;
            continue;
        }
        for (prefix, target) in [
            ("atk+", &mut stats.attack),
            ("def+", &mut stats.defense),
            ("hp+", &mut stats.health),
            ("eva+", &mut stats.evasion),
            ("crit+", &mut stats.critical),
        ] {
            if let Some(value) = expression_factor(expression, prefix) {
                *target += value;
                break;
            }
        }
    }
    stats
}

fn compact_number(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    }
}

fn skill_effects(value: &Value) -> Vec<String> {
    let mut effects = Vec::new();
    let item = numeric(value, "item");
    if item != 0.0 {
        let types = value
            .get("itemTypes")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let label = if types == "*" {
            "所有装备攻防血"
        } else if types == "xs" {
            "盾防御"
        } else if types.split(',').all(|kind| kind.starts_with('w')) {
            "武器攻击"
        } else {
            "装备属性"
        };
        effects.push(format!("{label} +{}%", compact_number(item * 100.0)));
    }
    let elemental_item_multiplier = numeric(value, "elementalItemCoreStatMultiplier");
    if elemental_item_multiplier != 0.0 {
        effects.push(format!(
            "从自带元素的装备上获得+{}%攻防血属性加成",
            compact_number(elemental_item_multiplier * 100.0)
        ));
    }
    for (key, label) in [
        ("atk", "攻击"),
        ("def", "防御"),
        ("hp", "生命"),
        ("evasion", "回避"),
        ("critical", "暴击率"),
        ("critMult", "暴击伤害"),
        ("aggro", "威胁度"),
        ("regen", "回复"),
        ("xp", "经验"),
    ] {
        let amount = numeric(value, key);
        if amount != 0.0 {
            effects.push(format!("{label} +{}%", compact_number(amount * 100.0)));
        }
    }
    for (key, label) in [("atkAbs", "攻击"), ("defAbs", "防御"), ("hpAbs", "生命")] {
        let amount = numeric(value, key);
        if amount != 0.0 {
            effects.push(format!("{label} +{}", compact_number(amount)));
        }
    }
    let heal_multiplier = numeric(value, "healMult");
    if heal_multiplier != 0.0 && heal_multiplier < 1.0 {
        effects.push(format!(
            "休息时间 -{}%",
            compact_number((1.0 - heal_multiplier) * 100.0)
        ));
    }
    if effects.is_empty() {
        effects.push("无效果".to_owned());
    }
    effects
}

fn formatted_percent(value: f64, decimals: usize) -> String {
    format!("{:.decimals$}%", value * 100.0)
}

fn dominant_item_stat(item_types: &str, items: &Map<String, Value>) -> &'static str {
    let first_type = item_types.split(',').next().unwrap_or_default().trim();
    for item in items.values() {
        if item.get("type").and_then(Value::as_str) != Some(first_type)
            || numeric(item, "tier") != 15.0
            || numeric(item, "unlock") <= 0.0
        {
            continue;
        }
        if numeric(item, "atk") > 0.0 {
            return "攻击";
        }
        if numeric(item, "def") > 0.0 {
            return "防御";
        }
        if numeric(item, "hp") > 0.0 {
            return "生命";
        }
    }
    "防御"
}

/// Text shown below the fixed class skill. This mirrors the archived web
/// bundle's separate `tr` (numeric effects) + `sr` (class mechanics) path;
/// ordinary skill cards intentionally keep using `skill_effects` above.
fn innate_effects(value: &Value, items: &Map<String, Value>) -> Vec<String> {
    let mut effects = Vec::new();
    for (key, label) in [
        ("atk", "攻击"),
        ("def", "防御"),
        ("hp", "生命"),
        ("evasion", "回避"),
        ("critical", "暴击率"),
        ("critMult", "暴击伤害"),
    ] {
        let amount = numeric(value, key);
        if amount != 0.0 {
            effects.push(format!(
                "{label} {}{}%",
                if amount > 0.0 { "+" } else { "" },
                compact_number(amount * 100.0)
            ));
        }
    }
    for (key, label) in [("atkAbs", "攻击"), ("defAbs", "防御"), ("hpAbs", "生命")] {
        let amount = numeric(value, key);
        if amount != 0.0 {
            effects.push(format!(
                "{label} {}{}",
                if amount > 0.0 { "+" } else { "" },
                compact_number(amount)
            ));
        }
    }
    let aggro = numeric(value, "aggro");
    if aggro != 0.0 {
        effects.push(format!(
            "威胁度 {}{}",
            if aggro > 0.0 { "+" } else { "" },
            compact_number(aggro)
        ));
    }
    let regen = numeric(value, "regen");
    if regen != 0.0 {
        effects.push(format!(
            "回复 {}{}",
            if regen > 0.0 { "+" } else { "" },
            compact_number(regen)
        ));
    }
    let xp = numeric(value, "xp");
    if xp != 0.0 {
        effects.push(format!(
            "经验 {}{}%",
            if xp > 0.0 { "+" } else { "" },
            compact_number(xp * 100.0)
        ));
    }
    let heal_multiplier = numeric(value, "healMult");
    if heal_multiplier != 0.0 {
        effects.push(format!(
            "休息时间 -{}%",
            compact_number((1.0 - heal_multiplier) * 100.0)
        ));
    }
    let item = numeric(value, "item");
    if item != 0.0 {
        let item_types = value
            .get("itemTypes")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let affect_secondary = value
            .get("affectSecStat")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if affect_secondary {
            effects.push(format!("+{}% 装备攻防血属性", compact_number(item * 100.0)));
        } else {
            effects.push(format!(
                "+{}% {}",
                compact_number(item * 100.0),
                dominant_item_stat(item_types, items)
            ));
        }
    }

    let family = value
        .get("family")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match family {
        "c_soldier" => effects.push("学习技能比其他职业还快。".to_owned()),
        "c_mercenary" => {
            effects.push("学习技能比其他职业还快。".to_owned());
            effects.push("从勇士技能获得的效果+25%。".to_owned());
        }
        "c_chieftain" => effects.push("总威胁的40%增加至攻击力加成系数。".to_owned()),
        "c_lord" => effects.push("为队友抵挡一次强力攻击，每场战斗中可触发一次。".to_owned()),
        "c_swordmaster" => effects.push("武士的第一次攻击必定暴击，且无视元素屏障。".to_owned()),
        "c_daimyo" => effects.push("在第一回合必定回避和暴击，且此攻击无视元素屏障。".to_owned()),
        "c_berserker" => {
            let thresholds = value
                .get("dmgBuf")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .split(',')
                .map(|entry| entry.parse::<f64>().unwrap_or_default())
                .collect::<Vec<_>>();
            let hp1 = thresholds.first().copied().unwrap_or_default();
            let hp2 = thresholds.get(1).copied().unwrap_or_default();
            let hp3 = thresholds.get(2).copied().unwrap_or_default();
            effects.push(format!(
                "生命降至{}以下时，+{}攻击，+{}回避。生命为{}以下时，效果变为两倍；生命为{}以下时，效果变为三倍。",
                formatted_percent(hp1, 0), formatted_percent(numeric(value, "atkBuf"), 0),
                formatted_percent(numeric(value, "evaBuf"), 1), formatted_percent(hp2, 0), formatted_percent(hp3, 0)
            ));
        }
        "c_darkknight" => effects.push("瞬间打败生命低于10%的怪物，并获得永久加成。".to_owned()),
        "c_trickster" => effects.push("波洛尼亚的获取几率+3%，获取物品上限+2。".to_owned()),
        "c_mastermonk" => effects.push("可能习得非常强大的专属技能。".to_owned()),
        "c_conquistador" => effects.push("每次连续暴击增加25%暴击伤害，堆叠最多4层。".to_owned()),
        "c_pathfinder" => effects.push("+3%回避上限".to_owned()),
        "c_ninja" | "c_sensei" => {
            effects.push(format!(
                "+{}回避与{}暴击率，直至受到损伤",
                formatted_percent(numeric(value, "evaBuf"), 0),
                formatted_percent(numeric(value, "critBuf"), 0)
            ));
            if family == "c_sensei" {
                effects.push("在2会合后重获加成".to_owned());
            }
        }
        "c_dancer" => effects.push("闪避攻击后，注定会打出暴击。".to_owned()),
        "c_velite" => effects.push("装备护盾的防御也计入攻击。".to_owned()),
        "c_cleric" | "c_bishop" => effects.push("在一次冒险中承受一次致命打击".to_owned()),
        "c_sorcerer" => effects.push("有机会学习到强力专属技能".to_owned()),
        "c_redmage" | "c_spellknight" => {
            effects.push("可以使用任意元素，但只能对元素屏障造成50%伤害。".to_owned());
            if family == "c_spellknight" {
                effects.push("从自带元素的装备上获得+50%攻防血属性加成".to_owned());
            }
        }
        "c_geomancer" => effects.push("任意每点元素加1%攻击力".to_owned()),
        "c_chronomancer" => effects.push("小队被打败时，可以立即再尝试一次冒险。".to_owned()),
        "c_timekeeper" => effects.push(
            "如果小队落败了，允许立即尝试进行第二次任务并获得初级威力强化品加成。".to_owned(),
        ),
        _ => {}
    }
    if effects.is_empty() {
        effects.push("无效果".to_owned());
    }
    effects
}

fn stats(value: &Value) -> CatalogStats {
    CatalogStats {
        attack: numeric(value, "maxAtk40")
            .max(numeric(value, "maxAtk"))
            .round() as u64,
        defense: numeric(value, "maxDef40")
            .max(numeric(value, "maxDef"))
            .round() as u64,
        health: numeric(value, "maxHp40")
            .max(numeric(value, "maxHp"))
            .round() as u64,
        evasion: numeric(value, "evasion") * 100.0,
        crit: numeric(value, "critical") * 100.0,
    }
}

fn split_slot(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}

fn choose_sprite(sprite_files: &[String], candidates: &[String], prefix: &str) -> Option<String> {
    candidates
        .iter()
        .find_map(|candidate| {
            let wanted = format!("Sprite/{candidate}");
            sprite_files
                .iter()
                .find(|path| path.eq_ignore_ascii_case(&wanted))
                .cloned()
        })
        .or_else(|| {
            let prefix = format!("sprite/{}", prefix.to_ascii_lowercase());
            sprite_files
                .iter()
                .find(|path| path.to_ascii_lowercase().starts_with(&prefix))
                .cloned()
        })
}

fn titan_variant(id: &str) -> (&str, u64) {
    let variant = id.rsplit('_').next().unwrap_or("alpha");
    let order = match variant {
        "alpha" => 0,
        "beta" => 1,
        "gamma" => 2,
        "delta" => 3,
        "epsilon" => 4,
        "terror" => 5,
        _ => u64::MAX,
    };
    (variant, order)
}

fn titan_difficulty_label(variant: &str, tomb: bool) -> &'static str {
    if tomb {
        match variant {
            "alpha" => "阿尔法之墓",
            "beta" => "测试墓穴",
            "gamma" => "伽马墓",
            "delta" => "德尔塔墓穴",
            "epsilon" => "伊普西隆墓",
            "terror" => "恐怖墓穴",
            _ => "泰坦之墓",
        }
    } else {
        match variant {
            "alpha" => "阿尔法",
            "beta" => "贝塔",
            "gamma" => "伽马",
            "delta" => "德尔塔",
            "epsilon" => "艾普斯龙",
            "terror" => "奇异",
            _ => "未知",
        }
    }
}

fn flash_map_order(family: &str) -> u64 {
    const ORDER: &[&str] = &[
        "lcog",
        "enchant",
        "sigil",
        "training",
        "moon",
        "gear",
        "research",
        "rune",
        "repair",
        "chest",
        "ascension",
        "key",
        "fancygear",
        "champion",
        "slimer",
        "cndragon",
        "transcendence",
    ];
    ORDER
        .iter()
        .position(|entry| *entry == family)
        .map_or(u64::MAX, |index| index as u64)
}

fn flash_map_sprite(family: &str) -> Option<&'static str> {
    match family {
        "lcog" => Some("FQ_goldcity_boss.png"),
        "enchant" => Some("FQ_swamp_boss.png"),
        "sigil" => Some("FQ_grotto_boss.png"),
        "training" => Some("FQ_castle_boss.png"),
        "moon" => Some("FQ_goldcity_boss_2.png"),
        "gear" => Some("FQ_ruins_boss_1.png"),
        "research" => Some("FQ_peak_boss.png"),
        "rune" => Some("FQ_goldcity_boss_1.png"),
        "repair" => Some("FQ_forest_boss_2.png"),
        "chest" => Some("FQ_forest_boss_1.png"),
        "ascension" => Some("FQ_volcano_boss.png"),
        "key" => Some("FQ_desert_boss.png"),
        "fancygear" => Some("FQ_ruins_boss_2.png"),
        "champion" => Some("FQ_pyramid_boss.png"),
        "slimer" => Some("FQ_slimer_boss.png"),
        "cndragon" => Some("FQ_temple_boss.png"),
        "transcendence" => Some("FQ_elysiumdark_boss.png"),
        _ => None,
    }
}

fn sprite_files(content_dir: &Path, manifest: &Value) -> Result<Vec<String>, String> {
    let sprite_root = content_dir.join("Sprite");
    if !sprite_root.is_dir() {
        return Err(format!("本地 Sprite 目录不存在：{}", sprite_root.display()));
    }
    // Prefer the checksummed manifest so catalog resolution is deterministic. Fall back to
    // the actual directory for development fixtures and manually maintained data packs.
    let from_manifest: Vec<String> = manifest
        .get("files")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|file| file.get("path").and_then(Value::as_str))
        .filter(|path| path.starts_with("Sprite/"))
        .map(str::to_owned)
        .collect();
    if !from_manifest.is_empty() {
        return Ok(from_manifest);
    }
    fs::read_dir(&sprite_root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .map(|entry| Ok(format!("Sprite/{}", entry.file_name().to_string_lossy())))
        .collect()
}

fn load_catalog_from_content_dir(content_dir: &Path) -> Result<Catalog, String> {
    let text_asset = content_dir.join("TextAsset");
    let manifest = read_json(&content_dir.join("manifest.json"))?;
    let classes_value = read_json(&text_asset.join("classes.json"))?;
    let champions_value = read_json(&text_asset.join("heroes.json"))?;
    let quests_value = read_json(&text_asset.join("quests.json"))?;
    let items_value = read_json(&text_asset.join("items.json"))?;
    let skills_value = read_json(&text_asset.join("skills.json"))?;
    let quest_modifiers_value = read_json(&text_asset.join("qmodifiers.json"))?;
    let type_dict_value = read_json(&text_asset.join("items_type_dict.json"))?;
    let texts_value = read_json(&text_asset.join("texts_zh.json"))?;
    let texts = object_at(
        texts_value.get("texts").ok_or("texts_zh.json 缺少 texts")?,
        "texts",
    )?;
    let sprite_files = sprite_files(content_dir, &manifest)?;

    let mut classes = object_at(&classes_value, "classes")?
        .iter()
        .map(|(id, value)| {
            let raw_element = value.get("element").and_then(Value::as_str);
            let element = cn_element(raw_element);
            CatalogClass {
                id: id.clone(),
                name: localized(texts, &[format!("class_{id}_name")], id),
                r#type: value
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .to_owned(),
                innate_skill_family: value
                    .get("innate")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                skill_slots: (1..=4)
                    .filter(|index| numeric(value, &format!("skl{index}Lv")) > 0.0)
                    .count(),
                skill_unlock_levels: (1..=4)
                    .map(|index| numeric(value, &format!("skl{index}Lv")) as u16)
                    .collect(),
                max_skill_level: if value.get("titanClass").is_some_and(Value::is_null) {
                    4
                } else {
                    3
                },
                color: element_color(&element),
                all_elements: raw_element == Some("all"),
                element,
                sprite_path: choose_sprite(
                    &sprite_files,
                    &[
                        format!("icon_global_class_{id}.png"),
                        format!("icon_global_class_{id}_128.png"),
                    ],
                    id,
                ),
                slots: (1..=6)
                    .map(|index| {
                        split_slot(value.get(format!("slot{index}")).and_then(Value::as_str))
                    })
                    .collect(),
                stats: stats(value),
            }
        })
        .collect::<Vec<_>>();
    const CLASS_ORDER: &[&str] = &[
        "soldier",
        "mercenary",
        "barbarian",
        "chieftain",
        "knight",
        "lord",
        "ranger",
        "warden",
        "swordmaster",
        "daimyo",
        "berserker",
        "jarl",
        "darkknight",
        "deathknight",
        "thief",
        "trickster",
        "monk",
        "mastermonk",
        "musketeer",
        "conquistador",
        "wanderer",
        "pathfinder",
        "ninja",
        "sensei",
        "dancer",
        "acrobat",
        "velite",
        "praetorian",
        "mage",
        "archmage",
        "cleric",
        "bishop",
        "druid",
        "archdruid",
        "sorcerer",
        "warlock",
        "redmage",
        "spellknight",
        "geomancer",
        "astramancer",
        "chronomancer",
        "timekeeper",
    ];
    classes.sort_by_key(|entry| {
        CLASS_ORDER
            .iter()
            .position(|id| *id == entry.id)
            .unwrap_or(usize::MAX)
    });

    let quest_modifiers = object_at(&quest_modifiers_value, "qmodifiers")?;
    let mut champions = object_at(&champions_value, "heroes")?
        .iter()
        .filter(|(id, value)| {
            !value
                .get("isTempHero")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || matches!(id.as_str(), "leather" | "king")
        })
        .map(|(id, value)| CatalogChampion {
            id: id.clone(),
            name: match id.as_str() {
                // The target tool exposes these two game records under their current public names.
                "leather" => "塔马什".to_owned(),
                "king" => "莱茵霍尔德".to_owned(),
                _ => localized(texts, &[format!("{id}_name")], id),
            },
            class_id: value
                .get("class")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            element: cn_element(value.get("element").and_then(Value::as_str)),
            sprite_path: choose_sprite(
                &sprite_files,
                &[format!("icon_global_{id}.png")],
                &format!("icon_global_{id}"),
            ),
            team_skill_ids: (1..=4)
                .filter_map(|index| {
                    value
                        .get(format!("skill{index}"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .collect(),
            team_skills: (1..=4)
                .filter_map(|index| value.get(format!("skill{index}")).and_then(Value::as_str))
                .map(|skill_id| {
                    let modifier = quest_modifiers.get(skill_id).unwrap_or(&Value::Null);
                    CatalogTeamSkill {
                        id: skill_id.to_owned(),
                        name: localized(texts, &[format!("hero_skill_{skill_id}_name")], skill_id),
                        tier: modifier
                            .get("tier")
                            .and_then(Value::as_u64)
                            .unwrap_or_default(),
                        sprite_path: choose_sprite(
                            &sprite_files,
                            &[format!("icon_global_skill_hero_{skill_id}.png")],
                            &format!("icon_global_skill_hero_{skill_id}"),
                        ),
                        effects: vec![localized(
                            texts,
                            &[format!("hero_skill_{skill_id}_effect")],
                            "勇士固定团队效果",
                        )],
                    }
                })
                .collect(),
            stats: stats(value),
        })
        .collect::<Vec<_>>();
    champions.sort_by_key(|entry| {
        object_at(&champions_value, "heroes")
            .ok()
            .and_then(|all| all.get(&entry.id))
            .and_then(|value| value.get("index"))
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX)
    });

    let quest_records = object_at(&quests_value, "quests")?;
    let mut quests = quest_records
        .iter()
        .enumerate()
        .map(|(source_order, (id, value))| {
            let family = value.get("family").and_then(Value::as_str).unwrap_or(id);
            let difficulty_level = value
                .get("difficultyLvl")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            let is_boss = value
                .get("isBoss")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let is_flash = value
                .get("isFlash")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let category = if family == "goldcity" {
                "黄金城"
            } else if family == "titantower"
                || value
                    .get("isTitan")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                "泰坦塔"
            } else if is_flash {
                "快闪"
            } else {
                "普通冒险"
            };
            let map_name_keys = if is_flash {
                vec![format!("fq_{family}_name"), format!("{family}_name")]
            } else {
                vec![format!("{family}_name")]
            };
            let base_map_name = localized(texts, &map_name_keys, family);
            let (map_name, map_label, map_key, difficulty, map_order, variant_order) =
                if category == "泰坦塔" {
                    let tomb = difficulty_level == 30;
                    let map_label = if tomb {
                        "泰坦之墓".to_owned()
                    } else {
                        format!("第{}层", difficulty_level + 1)
                    };
                    let map_name = if tomb {
                        "泰坦之墓".to_owned()
                    } else {
                        format!("泰坦之塔{}层", difficulty_level + 1)
                    };
                    let (variant, variant_order) = titan_variant(id);
                    (
                        map_name,
                        Some(map_label),
                        format!("titantower:{difficulty_level}"),
                        titan_difficulty_label(variant, tomb).to_owned(),
                        difficulty_level,
                        variant_order,
                    )
                } else if category == "黄金城" {
                    (
                        base_map_name,
                        None,
                        format!("{family}:{}", if is_boss { "boss" } else { "normal" }),
                        format!("难度{}", difficulty_level + 1),
                        u64::from(is_boss),
                        difficulty_level,
                    )
                } else {
                    (
                        base_map_name,
                        None,
                        format!("{family}:{}", if is_boss { "boss" } else { "normal" }),
                        match difficulty_level {
                            0 => "简单",
                            1 => "中等",
                            2 => "困难",
                            _ => "究极",
                        }
                        .to_owned(),
                        if is_flash {
                            flash_map_order(family)
                        } else {
                            value
                                .get("index")
                                .and_then(Value::as_u64)
                                .unwrap_or(source_order as u64)
                                * 2
                                + u64::from(is_boss)
                        },
                        difficulty_level,
                    )
                };
            let map_sprite_candidates = if category == "泰坦塔" {
                vec![if difficulty_level == 30 {
                    "icon_global_questarea_titantomb_small.png".to_owned()
                } else {
                    "icon_global_questarea_titantower_small.png".to_owned()
                }]
            } else if let Some(sprite) = is_flash.then(|| flash_map_sprite(family)).flatten() {
                vec![sprite.to_owned()]
            } else if is_boss {
                vec![format!("{family}_boss.png")]
            } else {
                vec![format!("icon_global_questarea_{family}_small.png")]
            };
            let map_sprite_path = choose_sprite(&sprite_files, &map_sprite_candidates, family);
            let difficulty_sprite_path = if category == "泰坦塔" {
                let (variant, _) = titan_variant(id);
                choose_sprite(
                    &sprite_files,
                    &[format!("icon_global_titantower_{variant}_big.png")],
                    &format!("icon_global_titantower_{variant}_big"),
                )
            } else if category == "黄金城" {
                choose_sprite(
                    &sprite_files,
                    &[format!("icon_difficulty_{}.png", difficulty_level + 1)],
                    &format!("icon_difficulty_{}", difficulty_level + 1),
                )
            } else {
                let suffix = match difficulty_level {
                    0 => "easy",
                    1 => "medium",
                    2 => "hard",
                    _ => "extreme",
                };
                choose_sprite(
                    &sprite_files,
                    &[format!("icon_difficulty_{suffix}.png")],
                    &format!("icon_difficulty_{suffix}"),
                )
            };
            let difficulty_background_path = (category == "泰坦塔")
                .then(|| {
                    choose_sprite(
                        &sprite_files,
                        &["icon_global_skill_bg_titan.png".to_owned()],
                        "icon_global_skill_bg_titan",
                    )
                })
                .flatten();
            let explicit = localized(texts, &[format!("{id}_name")], "");
            let display_name = if explicit.is_empty() {
                if category == "泰坦塔" {
                    format!("{map_name} · {difficulty}")
                } else {
                    format!("{map_name}{}", if is_boss { " (Boss)" } else { "" })
                }
            } else {
                explicit
            };
            let barrier_elements = value
                .get("element")
                .and_then(Value::as_str)
                .map(|raw| {
                    raw.split(',')
                        .map(|element| cn_element(Some(element.trim())))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            CatalogQuest {
                id: id.clone(),
                name: display_name,
                map_name,
                map_label,
                map_key,
                category: category.to_owned(),
                difficulty,
                difficulty_level,
                variant_order,
                is_boss,
                max_members: value
                    .get("party")
                    .and_then(Value::as_u64)
                    .unwrap_or(4)
                    .clamp(1, 6),
                barrier_element: barrier_elements.first().cloned(),
                barrier_elements,
                barrier_power: numeric(value, "barrierPower"),
                sprite_path: map_sprite_path.clone(),
                map_sprite_path,
                difficulty_sprite_path,
                difficulty_background_path,
                map_order,
            }
        })
        .collect::<Vec<_>>();
    quests.sort_by(|left, right| {
        let category_order = |category: &str| match category {
            "普通冒险" => 0,
            "黄金城" => 1,
            "泰坦塔" => 2,
            "快闪" => 3,
            _ => u64::MAX,
        };
        category_order(&left.category)
            .cmp(&category_order(&right.category))
            .then(left.map_order.cmp(&right.map_order))
            .then(left.variant_order.cmp(&right.variant_order))
            .then(left.id.cmp(&right.id))
    });

    let type_dict = object_at(&type_dict_value, "items_type_dict")?;
    let raw_items = object_at(&items_value, "items")?;
    let mut items = raw_items
        .iter()
        .enumerate()
        .filter_map(|(source_order, (id, value))| {
            let item_type = value.get("type").and_then(Value::as_str)?;
            let transcend = transcend_catalog_stats(value);
            let translation_key = type_dict
                .get(item_type)
                .and_then(Value::as_str)
                .unwrap_or(item_type);
            Some(CatalogItem {
                id: id.clone(),
                name: localized(texts, &[format!("{id}_name")], id),
                item_type: item_type.to_owned(),
                type_name: localized(texts, &[translation_key.to_owned()], item_type),
                tier: value
                    .get("tier")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
                level: value
                    .get("level")
                    .and_then(Value::as_u64)
                    .unwrap_or_default(),
                source_order: source_order as u64,
                restricted_class: value
                    .get("restrict")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                sprite_path: choose_sprite(&sprite_files, &[format!("{id}.png")], id),
                attack: numeric(value, "atk"),
                defense: numeric(value, "def"),
                health: numeric(value, "hp"),
                evasion: numeric(value, "eva"),
                critical: numeric(value, "crit"),
                shiny_multiplier: shiny_catalog_multiplier(value),
                transcend_multiplier: transcend.multiplier,
                transcend_attack: transcend.attack,
                transcend_defense: transcend.defense,
                transcend_health: transcend.health,
                transcend_evasion: transcend.evasion,
                transcend_critical: transcend.critical,
                elements: value
                    .get("elements")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                skill: value
                    .get("skill")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                element_affinity: value
                    .get("elementAffinity")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                spirit_affinity: value
                    .get("spiritAffinity")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                built_in_element_id: value
                    .get("lTag2")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                built_in_spirit_id: value
                    .get("lTag3")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| left.tier.cmp(&right.tier).then(left.name.cmp(&right.name)));

    let mut skills = object_at(&skills_value, "skills")?
        .iter()
        .enumerate()
        .map(|(source_order, (id, value))| CatalogSkill {
            id: id.clone(),
            name: localized(texts, &[format!("skill_{id}_name")], id),
            family: value
                .get("family")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_owned(),
            category: value
                .get("category")
                .and_then(Value::as_str)
                .map(str::to_owned),
            tier: value
                .get("tier")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            classes: value
                .get("classes")
                .and_then(Value::as_str)
                .map(|classes| split_slot(Some(classes)))
                .unwrap_or_default(),
            rarity: value
                .get("rarity")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            elements: value
                .get("elements")
                .and_then(Value::as_u64)
                .unwrap_or_else(|| numeric(value, "elements") as u64),
            rank: value
                .get("rank")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            source_order: source_order as u64,
            sprite_path: choose_sprite(
                &sprite_files,
                &[format!(
                    "icon_global_skill_{}.png",
                    value.get("family").and_then(Value::as_str).unwrap_or(id)
                )],
                value.get("family").and_then(Value::as_str).unwrap_or(id),
            ),
            effects: skill_effects(value),
            innate_effects: innate_effects(value, raw_items),
        })
        .collect::<Vec<_>>();
    skills.sort_by(|left, right| {
        left.family
            .cmp(&right.family)
            .then(left.tier.cmp(&right.tier))
            .then(left.name.cmp(&right.name))
    });

    let statistics = manifest.get("statistics").unwrap_or(&Value::Null);
    Ok(Catalog {
        schema_version: manifest
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .unwrap_or(1),
        game_data_version: manifest
            .get("gameDataVersion")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned(),
        asset_version: manifest
            .get("assetVersion")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned(),
        counts: CatalogCounts {
            classes: statistics
                .get("classes")
                .and_then(Value::as_u64)
                .map(|n| n as usize)
                .unwrap_or(classes.len()),
            champions: champions.len(),
            quests: statistics
                .get("quests")
                .and_then(Value::as_u64)
                .map(|n| n as usize)
                .unwrap_or(quests.len()),
            items: statistics
                .get("items")
                .and_then(Value::as_u64)
                .map(|n| n as usize)
                .unwrap_or(items.len()),
            skills: statistics
                .get("skills")
                .and_then(Value::as_u64)
                .map(|n| n as usize)
                .unwrap_or(skills.len()),
            sprites: sprite_files.len(),
        },
        classes,
        champions,
        quests,
        items,
        skills,
    })
}

fn active_catalog(
    paths: &ContentPaths,
) -> Result<(Catalog, PathBuf, content_manager::ContentSource), String> {
    paths.load_active(|root| {
        content_manager::ensure_directory_compatible(root, env!("CARGO_PKG_VERSION"))?;
        load_catalog_from_content_dir(root)
    })
}

#[tauri::command]
fn load_catalog(state: State<'_, DesktopState>) -> Result<Catalog, String> {
    let (catalog, root, _) = active_catalog(&state.content_paths)?;
    *state
        .active_content_root
        .lock()
        .map_err(|_| "活动内容路径锁已损坏")? = root;
    Ok(catalog)
}

#[tauri::command]
fn get_content_status(state: State<'_, DesktopState>) -> Result<ContentStatus, String> {
    let (_, root, source) = active_catalog(&state.content_paths)?;
    let status = content_manager::status(&root, source)?;
    *state
        .active_content_root
        .lock()
        .map_err(|_| "活动内容路径锁已损坏")? = root;
    Ok(status)
}

#[tauri::command]
fn resolve_content_asset(
    relative_path: String,
    state: State<'_, DesktopState>,
) -> Result<PathBuf, String> {
    let root = state
        .active_content_root
        .lock()
        .map_err(|_| "活动内容路径锁已损坏")?
        .clone();
    content_manager::resolve_content_file(&root, &relative_path)
}

#[tauri::command]
fn pick_install_data_package(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<DataInstallResult>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("英雄体系离线数据包", &["zysdata"])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let package = file.into_path().map_err(|_| "只支持本地文件路径")?;
    let _install_guard = state
        .content_install_lock
        .lock()
        .map_err(|_| "内容安装锁已损坏")?;
    let (manifest, verification) = content_manager::install(
        &package,
        &state.content_paths.installed,
        env!("CARGO_PKG_VERSION"),
        SIMULATOR_VERSION,
        |root| load_catalog_from_content_dir(root).map(|_| ()),
    )?;
    let stale_simulations = state
        .storage
        .lock()
        .map_err(|_| "数据库锁已损坏")?
        .mark_simulations_stale(&manifest.game_data_version, SIMULATOR_VERSION)
        .map_err(|error| error.to_string())?;
    let content = content_manager::status(
        &state.content_paths.installed,
        content_manager::ContentSource::Installed,
    )?;
    *state
        .active_content_root
        .lock()
        .map_err(|_| "活动内容路径锁已损坏")? = state.content_paths.installed.clone();
    Ok(Some(DataInstallResult {
        content,
        verification,
        stale_simulations,
    }))
}

fn value_id(value: &Value) -> Result<&str, String> {
    value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "体系缺少字符串 id".to_owned())
}

fn requested_seed(task: &Value) -> u64 {
    task.pointer("/config/seed")
        .and_then(Value::as_u64)
        .unwrap_or(1)
}

fn versions(game_data_version: &str, asset_version: &str) -> Versions {
    Versions {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        game_data_version: game_data_version.to_owned(),
        simulator_version: SIMULATOR_VERSION.to_owned(),
        asset_version: asset_version.to_owned(),
    }
}

fn validate_interchange_path(path: &Path, extension: &str) -> Result<(), String> {
    if !matches!(extension, "zyslineup" | "zysbackup") {
        return Err("不支持的文件类型".to_owned());
    }
    if path.extension().and_then(|value| value.to_str()) != Some(extension) {
        return Err(format!("文件扩展名必须是 .{extension}"));
    }
    Ok(())
}

#[tauri::command]
fn read_interchange_file(path: PathBuf, extension: String) -> Result<String, String> {
    validate_interchange_path(&path, &extension)?;
    fs::read_to_string(&path).map_err(|error| format!("无法读取 {}：{error}", path.display()))
}

#[tauri::command]
fn write_interchange_file(path: PathBuf, payload: String, extension: String) -> Result<(), String> {
    validate_interchange_path(&path, &extension)?;
    fs::write(&path, payload).map_err(|error| format!("无法写入 {}：{error}", path.display()))
}

#[tauri::command]
fn pick_read_interchange(app: AppHandle, extension: String) -> Result<Option<String>, String> {
    if !matches!(extension.as_str(), "zyslineup" | "zysbackup") {
        return Err("不支持的文件类型".to_owned());
    }
    let picked = app
        .dialog()
        .file()
        .add_filter("英雄体系数据", &[extension.as_str()])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|_| "只支持本地文件路径")?;
    validate_interchange_path(&path, &extension)?;
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|error| format!("无法读取 {}：{error}", path.display()))
}

#[tauri::command]
fn pick_write_interchange(
    app: AppHandle,
    payload: String,
    suggested_name: String,
    extension: String,
) -> Result<bool, String> {
    if !matches!(extension.as_str(), "zyslineup" | "zysbackup") {
        return Err("不支持的文件类型".to_owned());
    }
    let file_name = if suggested_name.ends_with(&format!(".{extension}")) {
        suggested_name
    } else {
        format!("{suggested_name}.{extension}")
    };
    let picked = app
        .dialog()
        .file()
        .add_filter("英雄体系数据", &[extension.as_str()])
        .set_file_name(file_name)
        .blocking_save_file();
    let Some(file) = picked else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|_| "只支持本地文件路径")?;
    validate_interchange_path(&path, &extension)?;
    fs::write(&path, payload).map_err(|error| format!("无法写入 {}：{error}", path.display()))?;
    Ok(true)
}

#[tauri::command]
fn list_systems(state: State<'_, DesktopState>) -> Result<Vec<LineupSystem>, String> {
    state
        .storage
        .lock()
        .map_err(|_| "数据库锁已损坏")?
        .list_systems()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_system(
    mut system: LineupSystem,
    state: State<'_, DesktopState>,
) -> Result<LineupSystem, String> {
    state
        .storage
        .lock()
        .map_err(|_| "数据库锁已损坏")?
        .save_system(&mut system)
        .map_err(|error| error.to_string())?;
    Ok(system)
}

#[tauri::command]
fn delete_system(id: String, state: State<'_, DesktopState>) -> Result<(), String> {
    let id = id.parse().map_err(|_| "体系 id 不是 UUID")?;
    state
        .storage
        .lock()
        .map_err(|_| "数据库锁已损坏")?
        .delete_system(id)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_template(template: &Template) -> Result<(), String> {
    if template.name.trim().is_empty() {
        return Err("模板名称不能为空".to_owned());
    }
    let object = template
        .build
        .as_object()
        .ok_or_else(|| "模板 build 必须是对象".to_owned())?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| "模板缺少 kind".to_owned())?;
    if !matches!(kind, "hero" | "champion-loadout") || object.get("payload").is_none() {
        return Err("模板类型或 payload 无效".to_owned());
    }
    Ok(())
}

#[tauri::command]
fn list_templates(state: State<'_, DesktopState>) -> Result<Vec<Template>, String> {
    state
        .storage
        .lock()
        .map_err(|_| "数据库锁已损坏")?
        .list_templates()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_template(
    mut template: Template,
    state: State<'_, DesktopState>,
) -> Result<Template, String> {
    validate_template(&template)?;
    template.updated_at = Utc::now();
    state
        .storage
        .lock()
        .map_err(|_| "数据库锁已损坏")?
        .save_template(&template)
        .map_err(|error| error.to_string())?;
    Ok(template)
}

#[tauri::command]
fn delete_template(id: String, state: State<'_, DesktopState>) -> Result<(), String> {
    let id = id.parse().map_err(|_| "模板 id 不是 UUID")?;
    state
        .storage
        .lock()
        .map_err(|_| "数据库锁已损坏")?
        .delete_template(id)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn active_calculation_catalog(
    state: &State<'_, DesktopState>,
) -> Result<hero_catalog::Catalog, String> {
    let root = state
        .active_content_root
        .lock()
        .map_err(|_| "内容目录锁已损坏")?
        .clone();
    hero_catalog::Catalog::load(root).map_err(|error| error.to_string())
}

#[tauri::command]
fn calculate_hero_build(
    build: HeroBuild,
    state: State<'_, DesktopState>,
) -> Result<hero_catalog::CalculatedSheet, String> {
    Ok(active_calculation_catalog(&state)?.calculate_hero(&build))
}

#[tauri::command]
fn calculate_champion_build(
    build: ChampionBuild,
    state: State<'_, DesktopState>,
) -> Result<hero_catalog::CalculatedSheet, String> {
    Ok(active_calculation_catalog(&state)?.calculate_champion(&build))
}

#[tauri::command]
fn export_system(system: LineupSystem, state: State<'_, DesktopState>) -> Result<String, String> {
    let game = if system.game_data_version.is_empty() {
        "unknown"
    } else {
        &system.game_data_version
    };
    let (catalog, _, _) = active_catalog(&state.content_paths)?;
    String::from_utf8(
        encode_lineup(&system, &versions(game, &catalog.asset_version))
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_systems(
    payload: String,
    expected_game_data_version: String,
    state: State<'_, DesktopState>,
) -> Result<Vec<LineupSystem>, String> {
    let decoded = decode_lineup_bundle(payload.as_bytes()).map_err(|error| error.to_string())?;
    if decoded.versions.game_data_version != "legacy-unknown"
        && decoded.versions.game_data_version != expected_game_data_version
    {
        return Err(format!(
            "数据版本不兼容：文件为 {}，当前为 {}",
            decoded.versions.game_data_version, expected_game_data_version
        ));
    }
    let mut storage = state.storage.lock().map_err(|_| "数据库锁已损坏")?;
    let existing = storage.list_systems().map_err(|error| error.to_string())?;
    let mut imported = Vec::new();
    for mut system in decoded.systems {
        if existing.iter().any(|candidate| candidate.id == system.id)
            || imported
                .iter()
                .any(|candidate: &LineupSystem| candidate.id == system.id)
        {
            system.id = uuid::Uuid::new_v4();
            system.name.push_str("（导入）");
        }
        system.game_data_version = expected_game_data_version.clone();
        storage
            .save_system(&mut system)
            .map_err(|error| error.to_string())?;
        imported.push(system);
    }
    Ok(imported)
}

#[tauri::command]
fn export_backup_file(
    game_data_version: String,
    state: State<'_, DesktopState>,
) -> Result<String, String> {
    let backup = state
        .storage
        .lock()
        .map_err(|_| "数据库锁已损坏")?
        .export_backup()
        .map_err(|error| error.to_string())?;
    let (catalog, _, _) = active_catalog(&state.content_paths)?;
    String::from_utf8(
        encode_backup(
            &backup,
            &versions(&game_data_version, &catalog.asset_version),
        )
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn restore_backup_file(
    payload: String,
    confirmed: bool,
    expected_game_data_version: String,
    state: State<'_, DesktopState>,
) -> Result<Vec<LineupSystem>, String> {
    if !confirmed {
        return Err("恢复完整备份需要确认".to_owned());
    }
    let envelope: Value =
        serde_json::from_str(&payload).map_err(|error| format!("无效 JSON：{error}"))?;
    let incoming_game = envelope
        .pointer("/versions/gameDataVersion")
        .and_then(Value::as_str)
        .unwrap_or("");
    if incoming_game != expected_game_data_version {
        return Err(format!(
            "数据版本不兼容：文件为 {incoming_game}，当前为 {expected_game_data_version}"
        ));
    }
    let backup = decode_backup(payload.as_bytes()).map_err(|error| error.to_string())?;
    let mut storage = state.storage.lock().map_err(|_| "数据库锁已损坏")?;
    storage
        .restore_backup(&backup)
        .map_err(|error| error.to_string())?;
    storage.list_systems().map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_simulation(
    request: SimulationRequest,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Value, String> {
    let task_id = request
        .task
        .get("id")
        .and_then(Value::as_str)
        .ok_or("任务缺少 id")?
        .to_owned();
    let iterations = request
        .task
        .pointer("/config/iterations")
        .and_then(Value::as_u64)
        .unwrap_or(10_000)
        .clamp(1, 100_000);
    if request.units.is_empty() {
        return Err("队伍不能为空".to_owned());
    }
    let seed = requested_seed(&request.task);
    let booster = request
        .task
        .pointer("/config/booster")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let booster_level = request
        .task
        .pointer("/config/boosterLevel")
        .and_then(Value::as_u64)
        .unwrap_or(u64::from(booster))
        .min(3) as u8;
    let elite = request
        .task
        .pointer("/config/elite")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let elite_kind = request
        .task
        .pointer("/config/eliteKind")
        .and_then(Value::as_str)
        .unwrap_or(if elite { "epic" } else { "none" });
    let titan_tower = request
        .task
        .pointer("/config/titanTower")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let difficulty = request
        .task
        .get("difficulty")
        .and_then(Value::as_str)
        .unwrap_or("简单");
    let difficulty_factor = match difficulty {
        "究极" => 1.75,
        "困难" => 1.5,
        "中等" => 1.25,
        _ => 1.0,
    };
    let quest_id = request
        .task
        .get("questId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let content_root = state
        .active_content_root
        .lock()
        .map_err(|_| "活动内容路径锁已损坏")?
        .clone();
    let quests = read_json(&content_root.join("TextAsset/quests.json"))?;
    let quest = quests.get(quest_id).unwrap_or(&Value::Null);
    let quest_health = numeric(quest, "monsterHp");
    let quest_attack = numeric(quest, "dmg");
    let quest_defense = numeric(quest, "dmgRed");
    let quest_critical = numeric(quest, "crit");
    let quest_critical_damage = numeric(quest, "critMult");
    let defense_threshold = numeric(quest, "tdef").max(0.0).round() as u64;
    let area_damage = numeric(quest, "aoe");
    let area_chance = numeric(quest, "aoeOdds");
    let enemy_factor = difficulty_factor;
    let party = request
        .units
        .iter()
        .map(|unit| {
            let stats = unit.get("stats").ok_or("队伍成员缺少 stats")?;
            let number = |name: &str| {
                stats
                    .get(name)
                    .and_then(Value::as_f64)
                    .ok_or_else(|| format!("stats 缺少 {name}"))
            };
            let normalize_rate = |value: f64| if value > 1.0 { value / 100.0 } else { value };
            Ok(Combatant {
                id: value_id(unit)?.to_owned(),
                stats: CalculatedStats {
                    health: number("health")?.max(1.0).round() as u64,
                    attack: number("attack")?.max(1.0).round() as u64,
                    defense: number("defense")?.max(0.0).round() as u64,
                    evasion: normalize_rate(number("evasion")?),
                    critical_chance: normalize_rate(number("crit")?),
                    critical_damage: 2.0,
                },
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let core_request = CoreSimulationRequest {
        seed,
        iterations: iterations as u32,
        party,
        enemy: QuestEnemy {
            health: if quest_health > 0.0 {
                quest_health.round() as u64
            } else {
                (22_000.0 * enemy_factor) as u64
            },
            attack: if quest_attack > 0.0 {
                quest_attack.round() as u64
            } else {
                (720.0 * enemy_factor) as u64
            },
            defense: if quest_defense > 0.0 {
                quest_defense.round() as u64
            } else {
                0
            },
            evasion: if elite { 0.12 } else { 0.06 },
            critical_chance: if quest_critical > 0.0 {
                quest_critical
            } else if elite {
                0.2
            } else {
                0.1
            },
            critical_damage: if quest_critical_damage > 0.0 {
                quest_critical_damage
            } else {
                1.75
            },
            max_rounds: if titan_tower { 25 } else { 20 },
        },
    };
    let parse_element = |raw: &str| match raw {
        "火" | "fire" => Element::Fire,
        "水" | "water" => Element::Water,
        "土" | "earth" => Element::Earth,
        "风" | "air" => Element::Air,
        "暗" | "dark" => Element::Dark,
        "全" | "all" => Element::All,
        _ => Element::Light,
    };
    let fighters = request
        .units
        .iter()
        .map(|unit| {
            let stats = unit.get("stats").unwrap_or(&Value::Null);
            ElementContribution {
                fighter_id: value_id(unit).unwrap_or("unknown").to_owned(),
                element: parse_element(unit.get("element").and_then(Value::as_str).unwrap_or("光")),
                power: unit
                    .get("power")
                    .and_then(Value::as_f64)
                    .unwrap_or_else(|| numeric(stats, "element")),
            }
        })
        .collect();
    let barrier_entries = request
        .task
        .get("barrier")
        .and_then(Value::as_object)
        .map(|values| {
            values
                .iter()
                .filter_map(|(element, power)| Some((element.as_str(), power.as_f64()?)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let default_barrier_health = barrier_entries
        .first()
        .map(|(_, power)| *power)
        .unwrap_or(0.0);
    let barrier_candidates = barrier_entries
        .iter()
        .map(|(element, _)| parse_element(element))
        .collect::<Vec<_>>();
    let selected_element = request
        .task
        .pointer("/config/selectedElement")
        .and_then(Value::as_str);
    let barrier_mode = match selected_element {
        Some("force") => BarrierMode::None,
        Some(element) => BarrierMode::Fixed(parse_element(element)),
        None if barrier_candidates.len() > 1 => BarrierMode::Random,
        None if barrier_candidates.len() == 1 => BarrierMode::Fixed(barrier_candidates[0]),
        None => BarrierMode::None,
    };
    let barrier_health = if selected_element == Some("force") {
        0.0
    } else {
        default_barrier_health
    };
    let mut combat_rules = Vec::new();
    if defense_threshold > 0 {
        combat_rules.push(CombatRule::DefenseThreshold {
            threshold: defense_threshold,
        });
    }
    if area_damage > 0.0 && area_chance > 0.0 && quest_attack > 0.0 {
        combat_rules.push(CombatRule::AreaAttack {
            chance: if area_chance > 1.0 {
                area_chance / 100.0
            } else {
                area_chance
            },
            damage_ratio: area_damage / quest_attack,
        });
    }
    let rule_request = AdvancedSimulationRequest {
        battle: core_request,
        quest_rules: BattleRules {
            elements: ElementBarrier {
                mode: if barrier_health > 0.0 {
                    barrier_mode
                } else {
                    BarrierMode::None
                },
                candidates: barrier_candidates,
                health: barrier_health,
                required_power: barrier_health,
                rudo_multiplier: 1.0,
                fighters,
            },
            booster: match booster_level {
                1 => BoosterBonus {
                    attack: 0.20,
                    defense: 0.20,
                    critical_chance: 0.10,
                    critical_damage: 0.0,
                },
                2 => BoosterBonus {
                    attack: 0.40,
                    defense: 0.40,
                    critical_chance: 0.15,
                    critical_damage: 0.0,
                },
                3 => BoosterBonus {
                    attack: 0.80,
                    defense: 0.80,
                    critical_chance: 0.30,
                    critical_damage: 0.50,
                },
                _ => BoosterBonus::default(),
            },
            elite: match elite_kind {
                "agile" => EliteKind::Agile,
                "huge" => EliteKind::Huge,
                "dire" => EliteKind::Dire,
                "wealthy" => EliteKind::Wealthy,
                "epic" => EliteKind::Epic,
                _ => EliteKind::None,
            },
            titan_floor: titan_tower.then(|| TitanFloorCorrection {
                floor: request
                    .task
                    .pointer("/config/titanFloor")
                    .and_then(Value::as_u64)
                    .unwrap_or(1) as u16,
                reduction: 0.0,
            }),
            ..BattleRules::default()
        },
        combat_rules,
    };
    let cancellation = CancellationToken::default();
    state
        .simulation_tokens
        .lock()
        .map_err(|_| "模拟状态锁已损坏")?
        .insert(task_id.clone(), cancellation.clone());
    let tokens = Arc::clone(&state.simulation_tokens);
    let task_for_job = task_id.clone();
    let game_data_version = request
        .task
        .get("gameDataVersion")
        .and_then(Value::as_str)
        .unwrap_or("offline-preview-1")
        .to_owned();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let result = simulate_advanced(&rule_request, &cancellation, |completed, total| {
            let _ = app.emit(&format!("simulation-progress:{task_for_job}"), SimulationProgress { task_id: task_for_job.clone(), completed: u64::from(completed), total: u64::from(total), phase: "running" });
        }).map_err(|error| error.to_string())?;
        tokens.lock().map_err(|_| "模拟状态锁已损坏")?.remove(&task_for_job);
        let member_count = result.members.len().max(1) as f64;
        Ok(json!({
            "successRate": result.success_rate * 100.0, "averageTurns": result.average_rounds,
            "minTurns": result.minimum_rounds, "maxTurns": result.maximum_rounds,
            "survivalRate": result.members.iter().map(|member| member.survival_rate).sum::<f64>() / member_count * 100.0,
            "averageDamage": result.members.iter().map(|member| member.average_damage).sum::<f64>(),
            "averageRemainingHealth": result.members.iter().map(|member| member.average_remaining_health).sum::<f64>(),
            "memberResults": result.members.iter().map(|member| json!({
                "id": member.id,
                "survivalRate": member.survival_rate * 100.0,
                "averageDamage": member.average_damage,
                "averageRemainingHealth": member.average_remaining_health
            })).collect::<Vec<_>>(),
            "seed": result.seed, "iterations": result.iterations,
            "simulatorVersion": SIMULATOR_VERSION, "gameDataVersion": game_data_version,
            "completedAt": Utc::now().to_rfc3339(), "stale": false
        }))
    }).await.map_err(|error| error.to_string())??;
    if let Some(system_id) = request.system_id.and_then(|id| id.parse().ok()) {
        let task_uuid = task_id.parse().map_err(|_| "任务 id 不是 UUID")?;
        let mut storage = state.storage.lock().map_err(|_| "数据库锁已损坏")?;
        storage
            .record_simulation(
                system_id,
                task_uuid,
                result["gameDataVersion"].as_str().unwrap_or("unknown"),
                SIMULATOR_VERSION,
                &result,
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(result)
}

#[tauri::command]
fn cancel_simulation(task_id: String, state: State<'_, DesktopState>) -> Result<(), String> {
    if let Some(token) = state
        .simulation_tokens
        .lock()
        .map_err(|_| "模拟状态锁已损坏")?
        .get(&task_id)
    {
        token.cancel();
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let content_paths = ContentPaths {
                bundled: app.path().resource_dir()?.join("content"),
                installed: data_dir.join("content"),
            };
            let (catalog, active_content_root, _) = active_catalog(&content_paths)
                .map_err(|error| std::io::Error::other(format!("无法载入离线内容：{error}")))?;
            let mut storage = Storage::open(&data_dir.join("user.db"))?;
            storage.mark_simulations_stale(&catalog.game_data_version, SIMULATOR_VERSION)?;
            app.manage(DesktopState {
                storage: Mutex::new(storage),
                simulation_tokens: Arc::new(Mutex::new(HashMap::new())),
                content_paths,
                content_install_lock: Mutex::new(()),
                active_content_root: Mutex::new(active_content_root),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_catalog,
            get_content_status,
            resolve_content_asset,
            pick_install_data_package,
            list_systems,
            save_system,
            delete_system,
            list_templates,
            save_template,
            delete_template,
            calculate_hero_build,
            calculate_champion_build,
            export_system,
            import_systems,
            export_backup_file,
            restore_backup_file,
            read_interchange_file,
            write_interchange_file,
            pick_read_interchange,
            pick_write_interchange,
            start_simulation,
            cancel_simulation
        ])
        .run(tauri::generate_context!())
        .expect("failed to run hero lineup desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn production_content_builds_complete_catalog() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../content");
        let catalog = load_catalog_from_content_dir(&root).expect("production catalog should load");
        assert_eq!(catalog.classes.len(), 42);
        assert_eq!(catalog.champions.len(), 13);
        assert_eq!(catalog.quests.len(), 391);
        assert!(catalog.items.len() >= 1_600);
        assert_eq!(catalog.skills.len(), 544);
        assert_eq!(catalog.counts.skills, 544);
        assert!(catalog.counts.sprites >= 2_200);
        assert_eq!(
            catalog
                .classes
                .iter()
                .map(|class| class.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "soldier",
                "mercenary",
                "barbarian",
                "chieftain",
                "knight",
                "lord",
                "ranger",
                "warden",
                "swordmaster",
                "daimyo",
                "berserker",
                "jarl",
                "darkknight",
                "deathknight",
                "thief",
                "trickster",
                "monk",
                "mastermonk",
                "musketeer",
                "conquistador",
                "wanderer",
                "pathfinder",
                "ninja",
                "sensei",
                "dancer",
                "acrobat",
                "velite",
                "praetorian",
                "mage",
                "archmage",
                "cleric",
                "bishop",
                "druid",
                "archdruid",
                "sorcerer",
                "warlock",
                "redmage",
                "spellknight",
                "geomancer",
                "astramancer",
                "chronomancer",
                "timekeeper",
            ]
        );
        let meteor_zone = catalog
            .quests
            .iter()
            .find(|quest| quest.id == "space04")
            .unwrap();
        assert_eq!(meteor_zone.barrier_elements, vec!["暗", "光", "土"]);
        assert_eq!(meteor_zone.barrier_power, 320.0);
        let mut unique_normal_maps = Vec::new();
        let mut unique_gold_maps = Vec::new();
        let mut unique_titan_maps = Vec::new();
        let mut unique_flash_maps = Vec::new();
        for quest in &catalog.quests {
            let target = match quest.category.as_str() {
                "普通冒险" => &mut unique_normal_maps,
                "黄金城" => &mut unique_gold_maps,
                "泰坦塔" => &mut unique_titan_maps,
                "快闪" => &mut unique_flash_maps,
                _ => continue,
            };
            if !target
                .iter()
                .any(|map_key: &&CatalogQuest| map_key.map_key == quest.map_key)
            {
                target.push(quest);
            }
        }
        assert_eq!(
            unique_normal_maps
                .iter()
                .map(|quest| quest.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "forest01",
                "forest04",
                "grotto01",
                "grotto04",
                "swamp01",
                "swamp04",
                "desert01",
                "desert04",
                "pyramid01",
                "pyramid04",
                "ruins01",
                "ruins04",
                "castle01",
                "castle04",
                "temple01",
                "temple04",
                "peak01",
                "peak04",
                "volcano01",
                "volcano04",
                "rift01",
                "rift04",
                "elysium01",
                "elysium05",
                "jurassic01",
                "jurassic05",
                "space01",
                "space05",
            ]
        );
        assert_eq!(
            unique_gold_maps
                .iter()
                .map(|quest| quest.id.as_str())
                .collect::<Vec<_>>(),
            vec!["goldcity01", "goldcity12"]
        );
        assert_eq!(
            unique_titan_maps
                .iter()
                .map(|quest| quest.map_label.as_deref().unwrap_or(""))
                .collect::<Vec<_>>(),
            (1..=30)
                .map(|floor| format!("第{floor}层"))
                .chain(std::iter::once("泰坦之墓".to_owned()))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            unique_flash_maps
                .iter()
                .map(|quest| (quest.map_name.as_str(), quest.id.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("镶金之墓", "FQlcog01"),
                ("魔法师塔楼", "FQenchant01"),
                ("雪怪藏身处", "FQsigil01"),
                ("训练场", "FQtraining01"),
                ("月色洞穴", "FQmoon01"),
                ("商队", "FQgear01"),
                ("城堡书库", "FQresearch01"),
                ("符文石采集场", "FQrune01"),
                ("岩浆工坊", "FQrepair01"),
                ("沉船", "FQchest01"),
                ("火山核心", "FQascension01"),
                ("藏宝库", "FQkey01"),
                ("将军的秘宝", "FQfancygear01"),
                ("勇士巢穴", "FQchampion01"),
                ("闹鬼地下城", "FQslimer01"),
                ("河之精萃巢穴", "FQcndragon01"),
                ("努利西姆", "FQtranscendence01"),
            ]
        );
        let first_tower = catalog
            .quests
            .iter()
            .filter(|quest| quest.map_key == "titantower:0")
            .collect::<Vec<_>>();
        assert_eq!(
            first_tower
                .iter()
                .map(|quest| quest.difficulty.as_str())
                .collect::<Vec<_>>(),
            vec!["阿尔法", "贝塔", "伽马", "德尔塔", "艾普斯龙", "奇异"]
        );
        assert!(first_tower
            .iter()
            .all(|quest| quest.map_name == "泰坦之塔1层"
                && quest.map_label.as_deref() == Some("第1层")
                && quest.map_sprite_path.as_deref()
                    == Some("Sprite/icon_global_questarea_titantower_small.png")
                && quest.difficulty_background_path.as_deref()
                    == Some("Sprite/icon_global_skill_bg_titan.png")));
        assert_eq!(
            first_tower[0].difficulty_sprite_path.as_deref(),
            Some("Sprite/icon_global_titantower_alpha_big.png")
        );
        let titan_tomb_beta = catalog
            .quests
            .iter()
            .find(|quest| quest.id == "titantower_tomb_beta")
            .unwrap();
        assert_eq!(titan_tomb_beta.map_name, "泰坦之墓");
        assert_eq!(titan_tomb_beta.difficulty, "测试墓穴");
        assert_eq!(
            titan_tomb_beta.map_sprite_path.as_deref(),
            Some("Sprite/icon_global_questarea_titantomb_small.png")
        );
        assert_eq!(
            catalog
                .quests
                .iter()
                .find(|quest| quest.id == "goldcity01")
                .and_then(|quest| quest.difficulty_sprite_path.as_deref()),
            Some("Sprite/icon_difficulty_1.png")
        );
        assert!(catalog.classes.iter().all(|class| class.slots.len() == 6));
        for class in &catalog.classes {
            let unlocks = class
                .skill_unlock_levels
                .iter()
                .copied()
                .filter(|level| *level > 0)
                .collect::<Vec<_>>();
            assert_eq!(
                unlocks.len(),
                class.skill_slots,
                "{} 技能槽数量不一致",
                class.id
            );
            assert!(
                unlocks.windows(2).all(|pair| pair[0] < pair[1]),
                "{} 技能解锁等级不是严格递增",
                class.id
            );
            let family = class
                .innate_skill_family
                .as_deref()
                .unwrap_or_else(|| panic!("{} 缺少自带技能族", class.id));
            assert!(
                catalog
                    .skills
                    .iter()
                    .any(|skill| skill.family == family && skill.tier == 1),
                "{} 缺少一级自带技能 {}",
                class.id,
                family
            );
            assert!(
                catalog.skills.iter().any(|skill| {
                    skill.family == family && skill.tier == u64::from(class.max_skill_level)
                }),
                "{} 缺少职业上限等级自带技能 {}{}",
                class.id,
                family,
                class.max_skill_level
            );
        }
        let innate = |id: &str| {
            catalog
                .skills
                .iter()
                .find(|skill| skill.id == id)
                .unwrap_or_else(|| panic!("缺少技能 {id}"))
                .innate_effects
                .clone()
        };
        assert_eq!(
            innate("c_soldier1"),
            vec!["学习技能比其他职业还快。".to_owned()]
        );
        assert_eq!(
            innate("c_redmage1"),
            [
                "+10% 装备攻防血属性",
                "可以使用任意元素，但只能对元素屏障造成50%伤害。"
            ]
            .map(str::to_owned)
            .to_vec()
        );
        assert_eq!(
            innate("c_spellknight1"),
            [
                "+10% 装备攻防血属性",
                "可以使用任意元素，但只能对元素屏障造成50%伤害。",
                "从自带元素的装备上获得+50%攻防血属性加成",
            ]
            .map(str::to_owned)
            .to_vec()
        );
        assert_eq!(
            innate("c_berserker1"),
            ["生命降至75%以下时，+20%攻击，+10.0%回避。生命为50%以下时，效果变为两倍；生命为25%以下时，效果变为三倍。"]
                .map(str::to_owned)
                .to_vec()
        );
        assert_eq!(
            innate("c_chieftain1"),
            ["威胁度 +30", "总威胁的40%增加至攻击力加成系数。"]
                .map(str::to_owned)
                .to_vec()
        );
        assert!(catalog.classes.iter().all(|class| {
            let family = class.innate_skill_family.as_deref().unwrap_or_default();
            catalog.skills.iter().any(|skill| {
                skill.family == family
                    && skill.tier == 1
                    && !skill.innate_effects.is_empty()
                    && skill
                        .innate_effects
                        .iter()
                        .all(|effect| effect != "职业专属效果" && effect != "无效果")
            })
        }));
        assert_eq!(
            catalog
                .classes
                .iter()
                .find(|class| class.id == "knight")
                .unwrap()
                .name,
            "骑士"
        );
        let knight = catalog
            .classes
            .iter()
            .find(|class| class.id == "knight")
            .unwrap();
        assert_eq!(
            knight.sprite_path.as_deref(),
            Some("Sprite/icon_global_class_knight.png")
        );
        assert_eq!(knight.r#type, "fighter");
        assert_eq!(knight.innate_skill_family.as_deref(), Some("c_knight"));
        assert_eq!(knight.skill_slots, 3);
        assert_eq!(
            catalog
                .skills
                .iter()
                .find(|skill| skill.id == "p_cleave1")
                .unwrap()
                .name,
            "裂痕"
        );
        let cleave = catalog
            .skills
            .iter()
            .find(|skill| skill.id == "p_cleave1")
            .unwrap();
        assert!(cleave.classes.iter().any(|class| class == "fighter"));
        assert!(cleave
            .sprite_path
            .as_deref()
            .is_some_and(|path| path.contains("p_cleave")));
        assert!(cleave.effects.iter().any(|effect| effect == "攻击 +30%"));
        let war_master = catalog
            .skills
            .iter()
            .find(|skill| skill.id == "s_warmaster1")
            .unwrap();
        assert!(war_master.source_order > cleave.source_order);
        let boys_axe = catalog
            .items
            .iter()
            .find(|item| item.id == "boysaxe")
            .unwrap();
        let wood_spear = catalog
            .items
            .iter()
            .find(|item| item.id == "woodspear")
            .unwrap();
        assert_eq!(boys_axe.level, wood_spear.level);
        assert!(boys_axe.source_order < wood_spear.source_order);
        let gold_sword = catalog
            .items
            .iter()
            .find(|item| item.id == "goldsword")
            .unwrap();
        assert_eq!(gold_sword.element_affinity.as_deref(), Some("gold"));
        assert_eq!(
            gold_sword.spirit_affinity.as_deref(),
            Some("luxuriousspirit")
        );
        let spellknight = catalog
            .classes
            .iter()
            .find(|class| class.id == "spellknight")
            .unwrap();
        assert!(spellknight.all_elements);
        let spellknight_innate = catalog
            .skills
            .iter()
            .find(|skill| skill.id == "c_spellknight4")
            .unwrap();
        assert!(spellknight_innate
            .effects
            .iter()
            .any(|effect| effect == "所有装备攻防血 +30%"));
        assert!(spellknight_innate
            .effects
            .iter()
            .any(|effect| effect == "从自带元素的装备上获得+50%攻防血属性加成"));
        assert_eq!(
            catalog
                .champions
                .iter()
                .find(|hero| hero.id == "argon")
                .unwrap()
                .name,
            "阿尔贡"
        );
        let argon = catalog
            .champions
            .iter()
            .find(|hero| hero.id == "argon")
            .unwrap();
        assert_eq!(
            argon.sprite_path.as_deref(),
            Some("Sprite/icon_global_argon.png")
        );
        assert_eq!(argon.team_skills.len(), 4);
        assert_eq!(argon.team_skills[3].name, "圣骑光环");
        assert!(argon.team_skills[3].effects[0].contains("40%"));
        assert_eq!(
            catalog
                .champions
                .iter()
                .find(|hero| hero.id == "leather")
                .unwrap()
                .name,
            "塔马什"
        );
        assert_eq!(
            catalog
                .champions
                .iter()
                .find(|hero| hero.id == "king")
                .unwrap()
                .name,
            "莱茵霍尔德"
        );
        assert_eq!(
            catalog
                .items
                .iter()
                .find(|item| item.id == "shortsword")
                .unwrap()
                .name,
            "学徒短剑"
        );
        let short_sword = catalog
            .items
            .iter()
            .find(|item| item.id == "shortsword")
            .unwrap();
        assert_eq!(short_sword.shiny_multiplier, 1.0);
        assert_eq!(short_sword.transcend_multiplier, 1.1);
        assert_eq!(short_sword.transcend_attack, 2.0);
        assert_eq!(short_sword.transcend_defense, 1.0);
        let forest_dagger = catalog
            .items
            .iter()
            .find(|item| item.id == "forestdagger")
            .unwrap();
        assert_eq!(forest_dagger.built_in_element_id.as_deref(), Some("bubble"));
        assert_eq!(forest_dagger.built_in_spirit_id, None);
        let tier_16_sword = catalog
            .items
            .iter()
            .find(|item| item.id == "t16sword")
            .unwrap();
        assert_eq!(tier_16_sword.shiny_multiplier, 1.25);
        assert_eq!(tier_16_sword.transcend_attack, 142.0);
    }

    #[test]
    fn slot_codes_are_normalized_without_empty_values() {
        assert_eq!(split_slot(Some("ws, wa,,wp")), vec!["ws", "wa", "wp"]);
        assert!(split_slot(None).is_empty());
    }

    #[test]
    fn command_layer_preserves_fixed_simulation_seed() {
        let task = json!({ "config": { "seed": 424242_u64 } });
        assert_eq!(requested_seed(&task), 424242);
        assert_eq!(requested_seed(&json!({})), 1);
    }

    #[test]
    fn interchange_paths_require_exact_supported_extension() {
        assert!(validate_interchange_path(Path::new("team.zyslineup"), "zyslineup").is_ok());
        assert!(validate_interchange_path(Path::new("team.json"), "zyslineup").is_err());
        assert!(validate_interchange_path(Path::new("backup.zysbackup"), "exe").is_err());
    }

    #[test]
    fn templates_require_a_supported_tagged_payload() {
        let base = Template {
            id: uuid::Uuid::new_v4(),
            name: "骑士模板".to_owned(),
            class_id: Some("knight".to_owned()),
            build: json!({ "kind": "hero", "payload": { "id": "fixture" } }),
            updated_at: Utc::now(),
        };
        assert!(validate_template(&base).is_ok());
        let mut invalid = base.clone();
        invalid.build = json!({ "kind": "unknown", "payload": {} });
        assert!(validate_template(&invalid).is_err());
        invalid.name.clear();
        assert!(validate_template(&invalid).is_err());
    }
}
