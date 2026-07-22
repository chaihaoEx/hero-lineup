use hero_catalog::{Catalog, SheetStats};
use hero_domain::{ChampionBuild, Equipment, EquipmentSlot, HeroBuild, Quality, UnitStats};
use serde::Deserialize;
use std::{collections::BTreeMap, path::Path};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    knight: SheetStats,
    argon: SheetStats,
}

fn catalog() -> Catalog {
    Catalog::load(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content"))
        .expect("bundled catalog")
}

fn equipment(id: &str, slot: EquipmentSlot, quality: Quality) -> Equipment {
    Equipment {
        item_id: id.to_owned(),
        name: None,
        slot,
        quality,
        element: None,
        spirit: None,
        shiny: false,
        transcended: false,
        transcendence: 0,
    }
}

#[test]
fn real_text_asset_knight_and_champion_loadout_match_golden() {
    let expected: Fixture = serde_json::from_str(include_str!("fixtures/sheets.json")).unwrap();
    let knight = HeroBuild {
        id: Uuid::nil(),
        class_id: "knight".to_owned(),
        name: "金装测试".to_owned(),
        level: 40,
        rank: 1,
        seed: 0,
        card_level: 0,
        class_name: "骑士".to_owned(),
        sprite_path: None,
        element: "light".to_owned(),
        stats: UnitStats::default(),
        titan: false,
        seed_points: BTreeMap::new(),
        equipment: vec![
            equipment("pike", EquipmentSlot::Weapon, Quality::Normal),
            equipment("breastplate", EquipmentSlot::Body, Quality::Normal),
            equipment("knightgauntlets", EquipmentSlot::Hands, Quality::Normal),
            equipment("knighthelm", EquipmentSlot::Head, Quality::Normal),
            equipment("knightboots", EquipmentSlot::Feet, Quality::Normal),
            equipment("oakshield", EquipmentSlot::Accessory, Quality::Normal),
        ],
        skill_ids: vec![],
        card_levels: BTreeMap::new(),
    };
    let argon = ChampionBuild {
        id: "argon".to_owned(),
        loadout_present: true,
        name: "阿尔贡".to_owned(),
        class_id: Some("knight".to_owned()),
        sprite_path: None,
        element: "light".to_owned(),
        level: 40,
        rank: 11,
        seed: 0,
        card_level: 0,
        titan: false,
        familiar_id: "troblin".to_owned(),
        aura_song_id: "t3aura".to_owned(),
        stats: UnitStats::default(),
        familiar: Some(equipment(
            "troblin",
            EquipmentSlot::Familiar,
            Quality::Normal,
        )),
        aura_song: Some(equipment(
            "t3aura",
            EquipmentSlot::AuraSong,
            Quality::Superior,
        )),
        card_levels: BTreeMap::new(),
    };

    let catalog = catalog();
    let knight_result = catalog.calculate_hero(&knight);
    let argon_result = catalog.calculate_champion(&argon);
    assert!(
        knight_result.issues.is_empty(),
        "{:?}",
        knight_result.issues
    );
    assert!(argon_result.issues.is_empty(), "{:?}", argon_result.issues);
    assert_eq!(knight_result.stats, expected.knight);
    assert_eq!(argon_result.stats, expected.argon);
}
