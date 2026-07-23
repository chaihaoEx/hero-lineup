//! Deterministic calculation and battle simulation suitable for a background thread.

use hero_domain::{EquipmentSlot, Quality, Stat};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::mpsc::{self, Receiver},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BaseStats {
    pub health: f64,
    pub attack: f64,
    pub defense: f64,
    pub evasion: f64,
    pub critical_chance: f64,
    pub critical_damage: f64,
}

impl Default for BaseStats {
    fn default() -> Self {
        Self {
            health: 100.0,
            attack: 10.0,
            defense: 10.0,
            evasion: 0.0,
            critical_chance: 0.05,
            critical_damage: 2.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatModifier {
    pub stat: Stat,
    pub flat: f64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentSpec {
    pub item_id: String,
    pub slot: EquipmentSlot,
    pub quality: Quality,
    pub required_level: u16,
    pub allowed_classes: BTreeSet<String>,
    pub modifiers: Vec<StatModifier>,
    pub element_modifier: Option<StatModifier>,
    pub spirit_modifier: Option<StatModifier>,
    pub artifact_modifier: Option<StatModifier>,
    pub shiny: bool,
    pub transcended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildInput {
    pub class_id: String,
    pub level: u16,
    pub titan: bool,
    pub seed_points: BTreeMap<Stat, i32>,
    pub base: BaseStats,
    pub equipment: Vec<EquipmentSpec>,
    pub skill_modifiers: Vec<StatModifier>,
    pub class_modifiers: Vec<StatModifier>,
    pub card_modifiers: Vec<StatModifier>,
    pub environment_modifiers: Vec<StatModifier>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalculatedStats {
    pub health: u64,
    pub attack: u64,
    pub defense: u64,
    pub evasion: f64,
    pub critical_chance: f64,
    pub critical_damage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub item_id: String,
    pub code: String,
    pub message: String,
}

pub fn validate_equipment(input: &BuildInput) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let mut occupied = BTreeSet::new();
    for item in &input.equipment {
        if !occupied.insert(item.slot) {
            issues.push(issue(item, "duplicate_slot", "装备槽位已被占用"));
        }
        if input.level < item.required_level {
            issues.push(issue(item, "level_too_low", "英雄等级低于装备要求"));
        }
        if !item.allowed_classes.is_empty() && !item.allowed_classes.contains(&input.class_id) {
            issues.push(issue(item, "class_not_allowed", "职业不能使用此装备"));
        }
    }
    issues
}

fn issue(item: &EquipmentSpec, code: &str, message: &str) -> ValidationIssue {
    ValidationIssue {
        item_id: item.item_id.clone(),
        code: code.into(),
        message: message.into(),
    }
}

pub fn calculate_stats(input: &BuildInput) -> CalculatedStats {
    let level_factor = 1.0 + f64::from(input.level.saturating_sub(1)) * 0.05;
    let titan_factor = if input.titan { 1.1 } else { 1.0 };
    let mut values = BTreeMap::from([
        (
            Stat::Health,
            input.base.health * level_factor * titan_factor,
        ),
        (
            Stat::Attack,
            input.base.attack * level_factor * titan_factor,
        ),
        (
            Stat::Defense,
            input.base.defense * level_factor * titan_factor,
        ),
        (Stat::Evasion, input.base.evasion),
        (Stat::CriticalChance, input.base.critical_chance),
        (Stat::CriticalDamage, input.base.critical_damage),
    ]);
    for (stat, points) in &input.seed_points {
        *values.entry(*stat).or_default() += f64::from(*points);
    }
    for item in &input.equipment {
        let mut multiplier = item.quality.multiplier();
        if item.shiny {
            multiplier *= 1.5;
        }
        if item.transcended {
            multiplier *= 1.25;
        }
        for modifier in item
            .modifiers
            .iter()
            .chain(item.element_modifier.iter())
            .chain(item.spirit_modifier.iter())
            .chain(item.artifact_modifier.iter())
        {
            apply(&mut values, modifier, multiplier);
        }
    }
    for modifier in input
        .skill_modifiers
        .iter()
        .chain(&input.class_modifiers)
        .chain(&input.card_modifiers)
        .chain(&input.environment_modifiers)
    {
        apply(&mut values, modifier, 1.0);
    }
    CalculatedStats {
        health: values[&Stat::Health].max(1.0).round() as u64,
        attack: values[&Stat::Attack].max(0.0).round() as u64,
        defense: values[&Stat::Defense].max(0.0).round() as u64,
        evasion: values[&Stat::Evasion].clamp(0.0, 0.75),
        critical_chance: values[&Stat::CriticalChance].clamp(0.0, 1.0),
        critical_damage: values[&Stat::CriticalDamage].max(1.0),
    }
}

fn apply(values: &mut BTreeMap<Stat, f64>, modifier: &StatModifier, scale: f64) {
    let value = values.entry(modifier.stat).or_default();
    *value = (*value + modifier.flat * scale) * (1.0 + modifier.percent * scale);
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Combatant {
    pub id: String,
    pub stats: CalculatedStats,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestEnemy {
    pub health: u64,
    pub attack: u64,
    pub defense: u64,
    pub evasion: f64,
    pub critical_chance: f64,
    pub critical_damage: f64,
    pub max_rounds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulationRequest {
    pub seed: u64,
    pub iterations: u32,
    pub party: Vec<Combatant>,
    pub enemy: QuestEnemy,
}

/// Inputs which are part of a quest rather than a fighter's calculated sheet.
///
/// This is deliberately separate from [`SimulationRequest`].  The first offline
/// prototype shipped that type before the archived web bundle had been audited;
/// keeping a wrapper preserves its API while making the reconstructed rules
/// explicit and independently testable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BattleRules {
    pub elements: ElementBarrier,
    pub booster: BoosterBonus,
    pub environment: EnvironmentModifier,
    pub elite: EliteKind,
    pub titan_floor: Option<TitanFloorCorrection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleSimulationRequest {
    pub battle: SimulationRequest,
    pub rules: BattleRules,
}

/// Opt-in reconstructed combat behavior. Keeping these rules in a tagged list
/// prevents game IDs from leaking into the round loop and preserves the first
/// offline prototype's public request types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CombatRule {
    /// Online `tdef` threshold used when the monster damages a fighter.
    DefenseThreshold { threshold: u64 },
    /// `mDmg` and `mCrit` entries with a positive `duration`.
    TimedMonsterModifier {
        duration: u32,
        damage_delta: f64,
        critical_chance_delta: f64,
    },
    /// Online `mDmgPerRound`; the first round has no ramp.
    MonsterDamagePerRound { delta: f64 },
    /// Monster AOE odds and the online AOE-to-normal-damage ratio.
    AreaAttack { chance: f64, damage_ratio: f64 },
    /// Fighter threat/aggro. Rules omitted for a fighter fall back to weight 1.
    Threat { fighter_id: String, weight: f64 },
    /// Flat healing at the end of a living fighter's round.
    Regeneration { fighter_id: String, health: f64 },
    /// Once per battle, the protector takes a lethal hit for another fighter.
    LordIntercept { protector_id: String },
    /// Ninja/Sensei are represented by data, not class-name branches. `None`
    /// means the focus never recovers; `Some(2)` matches Sensei's two rounds.
    OpeningFocus {
        fighter_id: String,
        critical_chance: f64,
        evasion: f64,
        recover_after_rounds: Option<u32>,
    },
    /// Three HP thresholds produce stages 1, 2 and 3 of the supplied bonuses.
    BerserkerStages {
        fighter_id: String,
        hp_thresholds: [f64; 3],
        attack_per_stage: f64,
        evasion_per_stage: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSimulationRequest {
    pub battle: SimulationRequest,
    pub quest_rules: BattleRules,
    #[serde(default)]
    pub combat_rules: Vec<CombatRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BoosterBonus {
    /// Additive fraction, e.g. `0.10` means +10%.
    pub attack: f64,
    pub defense: f64,
    pub critical_chance: f64,
    pub critical_damage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EnvironmentModifier {
    /// Additive fractions matching qmodifier fields (`mHp`, `mDmg`, ...).
    pub monster_health: f64,
    pub monster_attack: f64,
    pub monster_defense: f64,
    pub monster_evasion: f64,
    pub monster_critical_chance: f64,
    pub monster_critical_damage: f64,
}

impl EnvironmentModifier {
    /// The online bundle merges quest modifiers additively around a base of 1.
    pub fn combine(&self, other: &Self) -> Self {
        Self {
            monster_health: self.monster_health + other.monster_health,
            monster_attack: self.monster_attack + other.monster_attack,
            monster_defense: self.monster_defense + other.monster_defense,
            monster_evasion: self.monster_evasion + other.monster_evasion,
            monster_critical_chance: self.monster_critical_chance + other.monster_critical_chance,
            monster_critical_damage: self.monster_critical_damage + other.monster_critical_damage,
        }
    }
}

/// Online data calls these five entries miniboss modifiers.  The product UI
/// also describes this choice as an elite encounter, hence the public name.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum EliteKind {
    #[default]
    None,
    Agile,
    Huge,
    Dire,
    Wealthy,
    Epic,
}

impl EliteKind {
    pub fn modifier(self) -> EnvironmentModifier {
        match self {
            Self::None | Self::Wealthy => EnvironmentModifier::default(),
            Self::Agile => EnvironmentModifier {
                monster_evasion: 0.4,
                ..EnvironmentModifier::default()
            },
            Self::Huge => EnvironmentModifier {
                monster_health: 1.0,
                ..EnvironmentModifier::default()
            },
            Self::Dire => EnvironmentModifier {
                monster_health: 0.5,
                monster_critical_chance: 3.0,
                ..EnvironmentModifier::default()
            },
            Self::Epic => EnvironmentModifier {
                monster_health: 0.5,
                monster_attack: 0.25,
                monster_evasion: 0.1,
                monster_critical_chance: 0.5,
                ..EnvironmentModifier::default()
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TitanFloorCorrection {
    pub floor: u16,
    /// Fraction removed from all three floor bonuses; clamped to 0..1.
    pub reduction: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TitanFloorBonuses {
    pub health_percent: f64,
    pub attack_percent: f64,
    pub defense_percent: f64,
}

impl TitanFloorCorrection {
    /// Direct readable port of `QuestSimulationUtils` floor curve (1..=500).
    pub fn bonuses(self) -> TitanFloorBonuses {
        let floor = self.floor.clamp(1, 500);
        let f = f64::from(floor);
        let (health, attack, defense) = if floor >= 31 {
            (
                200.0 + (f - 31.0) * 10.0,
                100.0 + (f - 31.0) * 10.0,
                40.0 + (f - 31.0) * 2.0,
            )
        } else {
            let health = if floor <= 16 {
                5.0 + (f - 1.0) * (19.0 / 3.0)
            } else {
                100.0 + (f - 16.0) * (20.0 / 3.0)
            };
            let attack = if floor <= 16 {
                5.0 + (f - 1.0) * (7.0 / 3.0)
            } else {
                40.0 + (f - 16.0) * 4.0
            };
            let defense = if floor <= 11 {
                5.0 + (f - 1.0) * 1.5
            } else {
                20.0 + (f - 11.0)
            };
            (health, attack, defense)
        };
        let retained = 1.0 - self.reduction.clamp(0.0, 1.0);
        TitanFloorBonuses {
            health_percent: health * retained,
            attack_percent: attack * retained,
            defense_percent: defense * retained,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ElementBarrier {
    pub mode: BarrierMode,
    /// Allowed elements for a random quest barrier. Empty preserves the legacy
    /// all-six-elements behavior.
    pub candidates: Vec<Element>,
    /// Fixed barriers use this value; random barriers use `required_power`.
    pub health: f64,
    pub required_power: f64,
    pub rudo_multiplier: f64,
    pub fighters: Vec<ElementContribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum BarrierMode {
    #[default]
    None,
    Force,
    Random,
    Fixed(Element),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Element {
    Fire,
    Water,
    Earth,
    Air,
    Light,
    Dark,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElementContribution {
    pub fighter_id: String,
    pub element: Element,
    pub power: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BarrierResolution {
    pub broken: bool,
    pub effective_power: f64,
    pub damage_multiplier: f64,
}

/// Reconstructs the bundle's elemental barrier check. `All` contributes half
/// power; an unbroken barrier reduces outgoing party damage to 20%.
pub fn resolve_element_barrier(barrier: &ElementBarrier) -> BarrierResolution {
    if matches!(barrier.mode, BarrierMode::None | BarrierMode::Force) {
        return BarrierResolution {
            broken: true,
            effective_power: barrier.health.max(barrier.required_power),
            damage_multiplier: 1.0,
        };
    }
    let rudo = if barrier.rudo_multiplier > 0.0 {
        barrier.rudo_multiplier
    } else {
        1.0
    };
    let effective = match barrier.mode {
        BarrierMode::Fixed(element) => barrier
            .fighters
            .iter()
            .map(|fighter| match fighter.element {
                candidate if candidate == element => fighter.power,
                Element::All => fighter.power * 0.5,
                _ => 0.0,
            })
            .sum::<f64>(),
        BarrierMode::Random => {
            const BASIC: [Element; 6] = [
                Element::Fire,
                Element::Water,
                Element::Earth,
                Element::Air,
                Element::Light,
                Element::Dark,
            ];
            let candidates = if barrier.candidates.is_empty() {
                BASIC.as_slice()
            } else {
                barrier.candidates.as_slice()
            };
            candidates
                .iter()
                .map(|element| {
                    barrier
                        .fighters
                        .iter()
                        .map(|fighter| match fighter.element {
                            candidate if candidate == *element => fighter.power,
                            Element::All => fighter.power * 0.5,
                            _ => 0.0,
                        })
                        .sum::<f64>()
                })
                .fold(0.0, f64::max)
        }
        BarrierMode::None | BarrierMode::Force => unreachable!(),
    };
    // The bundle floors after applying Rudo's barrier multiplier.
    let effective = (effective * rudo).floor();
    let target = match barrier.mode {
        BarrierMode::Random => barrier.required_power,
        BarrierMode::Fixed(_) => barrier.health,
        BarrierMode::None | BarrierMode::Force => 0.0,
    };
    let broken = target <= 0.0 || effective >= target;
    BarrierResolution {
        broken,
        effective_power: effective,
        damage_multiplier: if broken { 1.0 } else { 0.2 },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemberResult {
    pub id: String,
    pub survival_rate: f64,
    pub average_damage: f64,
    pub average_remaining_health: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulationResult {
    pub seed: u64,
    pub iterations: u32,
    pub success_rate: f64,
    pub average_rounds: f64,
    pub minimum_rounds: u32,
    pub maximum_rounds: u32,
    pub members: Vec<MemberResult>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SimulationError {
    #[error("simulation was cancelled")]
    Cancelled,
    #[error("iterations must be greater than zero")]
    NoIterations,
    #[error("party must contain at least one member")]
    EmptyParty,
}

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);
impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

#[derive(Debug)]
pub enum SimulationEvent {
    Progress { completed: u32, total: u32 },
    Finished(Result<SimulationResult, SimulationError>),
}

/// Owns a native worker thread and reports progress over a channel. Tauri can
/// bridge these events to the WebView without running simulation on its UI thread.
pub struct SimulationJob {
    pub cancellation: CancellationToken,
    pub events: Receiver<SimulationEvent>,
}

pub fn spawn_simulation(request: SimulationRequest) -> SimulationJob {
    let cancellation = CancellationToken::default();
    let worker_cancellation = cancellation.clone();
    let (sender, events) = mpsc::channel();
    std::thread::spawn(move || {
        let result = simulate(&request, &worker_cancellation, |completed, total| {
            let _ = sender.send(SimulationEvent::Progress { completed, total });
        });
        let _ = sender.send(SimulationEvent::Finished(result));
    });
    SimulationJob {
        cancellation,
        events,
    }
}

pub fn simulate<F: FnMut(u32, u32)>(
    request: &SimulationRequest,
    cancel: &CancellationToken,
    mut progress: F,
) -> Result<SimulationResult, SimulationError> {
    simulate_internal(request, cancel, &mut progress, 1.0)
}

/// Applies the archived quest-level rules and then runs the deterministic core.
pub fn simulate_with_rules<F: FnMut(u32, u32)>(
    request: &RuleSimulationRequest,
    cancel: &CancellationToken,
    mut progress: F,
) -> Result<SimulationResult, SimulationError> {
    let mut battle = request.battle.clone();
    apply_booster(&mut battle.party, &request.rules.booster);
    let environment = request
        .rules
        .environment
        .combine(&request.rules.elite.modifier());
    apply_environment(&mut battle.enemy, &environment);
    if let Some(titan) = request.rules.titan_floor {
        apply_titan_floor(&mut battle.enemy, titan.bonuses());
    }
    let barrier = resolve_element_barrier(&request.rules.elements);
    simulate_internal(&battle, cancel, &mut progress, barrier.damage_multiplier)
}

fn apply_booster(party: &mut [Combatant], booster: &BoosterBonus) {
    for fighter in party {
        fighter.stats.attack = scale_u64(fighter.stats.attack, 1.0 + booster.attack);
        fighter.stats.defense = scale_u64(fighter.stats.defense, 1.0 + booster.defense);
        fighter.stats.critical_chance =
            (fighter.stats.critical_chance + booster.critical_chance).clamp(0.0, 1.0);
        fighter.stats.critical_damage =
            (fighter.stats.critical_damage + booster.critical_damage).max(1.0);
    }
}

fn apply_environment(enemy: &mut QuestEnemy, modifier: &EnvironmentModifier) {
    enemy.health = scale_u64(enemy.health, 1.0 + modifier.monster_health);
    enemy.attack = scale_u64(enemy.attack, 1.0 + modifier.monster_attack);
    enemy.defense = scale_u64(enemy.defense, 1.0 + modifier.monster_defense);
    enemy.evasion = (enemy.evasion + modifier.monster_evasion).clamp(0.0, 0.75);
    // `mCrit` is a multiplier in the online helper, not percentage points.
    enemy.critical_chance =
        (enemy.critical_chance * (1.0 + modifier.monster_critical_chance)).clamp(0.0, 1.0);
    enemy.critical_damage = (enemy.critical_damage + modifier.monster_critical_damage).max(1.0);
}

fn apply_titan_floor(enemy: &mut QuestEnemy, bonus: TitanFloorBonuses) {
    enemy.health = scale_u64(enemy.health, 1.0 + bonus.health_percent / 100.0);
    enemy.attack = scale_u64(enemy.attack, 1.0 + bonus.attack_percent / 100.0);
    enemy.defense = scale_u64(enemy.defense, 1.0 + bonus.defense_percent / 100.0);
}

fn scale_u64(value: u64, multiplier: f64) -> u64 {
    ((value as f64) * multiplier.max(0.0)).round() as u64
}

/// Exact readable port of the archived bundle's normal `tdef` function
/// (`utils-B4Bv7ofN.js`, exported as `a1`).
pub fn normal_damage_after_tdef(defense: u64, damage: f64, threshold: u64) -> f64 {
    let defense = defense as f64;
    let threshold = threshold as f64;
    let multiplier = if threshold > 0.0 && defense <= threshold {
        lerp_clamped(1.5, 1.0, defense / threshold)
    } else if threshold > 0.0 && defense <= 2.0 * threshold {
        lerp_clamped(1.0, 0.5, (defense - threshold) / threshold)
    } else if threshold > 0.0 && defense <= 4.0 * threshold {
        lerp_clamped(0.5, 0.3, (defense - 2.0 * threshold) / (2.0 * threshold))
    } else if threshold > 0.0 && defense <= 12.0 * threshold {
        lerp_clamped(0.3, 0.25, (defense - 4.0 * threshold) / (8.0 * threshold))
    } else {
        0.25
    };
    (multiplier * damage).round()
}

/// Exact readable port of the bundle's critical `tdef` function (export `a2`).
/// Unlike normal damage, only defense at or below the threshold receives an
/// additional 1.5 -> 1.0 multiplier.
pub fn critical_damage_after_tdef(
    defense: u64,
    threshold: u64,
    damage: f64,
    critical_multiplier: f64,
    critical_multiplier_bonus: f64,
) -> f64 {
    let threshold = threshold as f64;
    let defense = defense as f64;
    let defense_multiplier = if threshold > 0.0 && defense <= threshold {
        lerp_clamped(1.5, 1.0, defense / threshold)
    } else if threshold <= 0.0 && defense <= 0.0 {
        1.5
    } else {
        1.0
    };
    (damage * critical_multiplier * (1.0 + critical_multiplier_bonus) * defense_multiplier).round()
}

fn lerp_clamped(start: f64, end: f64, ratio: f64) -> f64 {
    let ratio = ratio.clamp(0.0, 1.0);
    start + (end - start) * ratio
}

/// Bundle helper `Ho`: timed delta and per-round ramp multiply each other.
pub fn monster_round_damage_multiplier(per_round: f64, round: u32, timed_damage_delta: f64) -> f64 {
    (1.0 + per_round * f64::from(round.saturating_sub(1))) * (1.0 + timed_damage_delta)
}

/// Cumulative target boundaries used by the online reverse scan. Dead entries
/// are zero, and the last living entry has the smallest positive boundary.
pub fn threat_target_boundaries(weights: &[f64], living: &[bool]) -> Vec<f64> {
    let total: f64 = weights
        .iter()
        .zip(living)
        .filter_map(|(weight, alive)| (*alive).then_some(weight.max(0.0)))
        .sum();
    if total <= 0.0 {
        return vec![0.0; weights.len()];
    }
    (0..weights.len())
        .map(|index| {
            if !living.get(index).copied().unwrap_or(false) {
                return 0.0;
            }
            weights[index..]
                .iter()
                .zip(&living[index..])
                .filter_map(|(weight, alive)| (*alive).then_some(weight.max(0.0)))
                .sum::<f64>()
                / total
        })
        .collect()
}

pub fn berserker_stage(health: f64, maximum_health: f64, thresholds: [f64; 3]) -> u8 {
    if health <= 0.0 || maximum_health <= 0.0 || health >= thresholds[0] * maximum_health {
        0
    } else if health >= thresholds[1] * maximum_health {
        1
    } else if health >= thresholds[2] * maximum_health {
        2
    } else {
        3
    }
}

#[derive(Default)]
struct AdvancedRules {
    threshold: Option<u64>,
    timed: Vec<(u32, f64, f64)>,
    damage_per_round: f64,
    area: Option<(f64, f64)>,
    threat: BTreeMap<String, f64>,
    regeneration: BTreeMap<String, f64>,
    protector: Option<String>,
    focus: BTreeMap<String, (f64, f64, Option<u32>)>,
    berserker: BTreeMap<String, ([f64; 3], f64, f64)>,
}

impl AdvancedRules {
    fn from_rules(rules: &[CombatRule]) -> Self {
        let mut parsed = Self::default();
        for rule in rules {
            match rule {
                CombatRule::DefenseThreshold { threshold } => parsed.threshold = Some(*threshold),
                CombatRule::TimedMonsterModifier {
                    duration,
                    damage_delta,
                    critical_chance_delta,
                } => parsed
                    .timed
                    .push((*duration, *damage_delta, *critical_chance_delta)),
                CombatRule::MonsterDamagePerRound { delta } => parsed.damage_per_round += delta,
                CombatRule::AreaAttack {
                    chance,
                    damage_ratio,
                } => parsed.area = Some((*chance, *damage_ratio)),
                CombatRule::Threat { fighter_id, weight } => {
                    parsed.threat.insert(fighter_id.clone(), *weight);
                }
                CombatRule::Regeneration { fighter_id, health } => {
                    parsed.regeneration.insert(fighter_id.clone(), *health);
                }
                CombatRule::LordIntercept { protector_id } => {
                    parsed.protector = Some(protector_id.clone())
                }
                CombatRule::OpeningFocus {
                    fighter_id,
                    critical_chance,
                    evasion,
                    recover_after_rounds,
                } => {
                    parsed.focus.insert(
                        fighter_id.clone(),
                        (*critical_chance, *evasion, *recover_after_rounds),
                    );
                }
                CombatRule::BerserkerStages {
                    fighter_id,
                    hp_thresholds,
                    attack_per_stage,
                    evasion_per_stage,
                } => {
                    parsed.berserker.insert(
                        fighter_id.clone(),
                        (*hp_thresholds, *attack_per_stage, *evasion_per_stage),
                    );
                }
            }
        }
        parsed
    }
}

/// Runs the evidence-backed round model while leaving `simulate` and
/// `simulate_with_rules` byte-for-byte compatible for existing callers.
pub fn simulate_advanced<F: FnMut(u32, u32)>(
    request: &AdvancedSimulationRequest,
    cancel: &CancellationToken,
    mut progress: F,
) -> Result<SimulationResult, SimulationError> {
    let mut battle = request.battle.clone();
    apply_booster(&mut battle.party, &request.quest_rules.booster);
    let environment = request
        .quest_rules
        .environment
        .combine(&request.quest_rules.elite.modifier());
    apply_environment(&mut battle.enemy, &environment);
    if let Some(titan) = request.quest_rules.titan_floor {
        apply_titan_floor(&mut battle.enemy, titan.bonuses());
    }
    let barrier = resolve_element_barrier(&request.quest_rules.elements);
    let rules = AdvancedRules::from_rules(&request.combat_rules);
    simulate_advanced_internal(
        &battle,
        cancel,
        &mut progress,
        barrier.damage_multiplier,
        &rules,
    )
}

fn simulate_advanced_internal<F: FnMut(u32, u32)>(
    request: &SimulationRequest,
    cancel: &CancellationToken,
    progress: &mut F,
    party_damage_multiplier: f64,
    rules: &AdvancedRules,
) -> Result<SimulationResult, SimulationError> {
    if request.iterations == 0 {
        return Err(SimulationError::NoIterations);
    }
    if request.party.is_empty() {
        return Err(SimulationError::EmptyParty);
    }
    let mut rng = ChaCha8Rng::seed_from_u64(request.seed);
    let mut wins = 0_u32;
    let mut total_rounds = 0_u64;
    let mut min_rounds = u32::MAX;
    let mut max_rounds = 0;
    let mut survived = vec![0_u32; request.party.len()];
    let mut damages = vec![0_f64; request.party.len()];
    let mut remaining = vec![0_f64; request.party.len()];
    let report_every = (request.iterations / 100).max(1);
    for iteration in 0..request.iterations {
        if cancel.is_cancelled() {
            return Err(SimulationError::Cancelled);
        }
        let (win, rounds, state) =
            run_once_advanced(request, &mut rng, party_damage_multiplier, rules);
        wins += u32::from(win);
        total_rounds += u64::from(rounds);
        min_rounds = min_rounds.min(rounds);
        max_rounds = max_rounds.max(rounds);
        for (index, (hp, damage)) in state.into_iter().enumerate() {
            survived[index] += u32::from(hp > 0.0);
            remaining[index] += hp.max(0.0);
            damages[index] += damage;
        }
        if (iteration + 1) % report_every == 0 || iteration + 1 == request.iterations {
            progress(iteration + 1, request.iterations);
        }
    }
    let count = f64::from(request.iterations);
    Ok(SimulationResult {
        seed: request.seed,
        iterations: request.iterations,
        success_rate: f64::from(wins) / count,
        average_rounds: total_rounds as f64 / count,
        minimum_rounds: min_rounds,
        maximum_rounds: max_rounds,
        members: request
            .party
            .iter()
            .enumerate()
            .map(|(index, member)| MemberResult {
                id: member.id.clone(),
                survival_rate: f64::from(survived[index]) / count,
                average_damage: damages[index] / count,
                average_remaining_health: remaining[index] / count,
            })
            .collect(),
    })
}

fn run_once_advanced(
    request: &SimulationRequest,
    rng: &mut ChaCha8Rng,
    party_damage_multiplier: f64,
    rules: &AdvancedRules,
) -> (bool, u32, Vec<(f64, f64)>) {
    let mut enemy_hp = request.enemy.health as f64;
    let maximum_hp: Vec<f64> = request
        .party
        .iter()
        .map(|member| member.stats.health as f64)
        .collect();
    let mut member_hp = maximum_hp.clone();
    let mut damage_done = vec![0.0; request.party.len()];
    let mut focus_lost_round: Vec<Option<u32>> = vec![None; request.party.len()];
    let protector = rules
        .protector
        .as_ref()
        .and_then(|id| request.party.iter().position(|member| &member.id == id));
    let mut protector_available = protector.is_some();
    let weights: Vec<f64> = request
        .party
        .iter()
        .map(|member| rules.threat.get(&member.id).copied().unwrap_or(1.0))
        .collect();

    for round in 1..=request.enemy.max_rounds.max(1) {
        for (index, member) in request.party.iter().enumerate() {
            if let (Some(lost), Some((_, _, Some(recovery)))) =
                (focus_lost_round[index], rules.focus.get(&member.id))
            {
                if round >= lost.saturating_add(*recovery) {
                    focus_lost_round[index] = None;
                }
            }
        }

        let living: Vec<bool> = member_hp.iter().map(|health| *health > 0.0).collect();
        let living_count = living.iter().filter(|alive| **alive).count();
        if living_count == 0 {
            return (
                false,
                round,
                member_hp.into_iter().zip(damage_done).collect(),
            );
        }
        let timed_damage: f64 = rules
            .timed
            .iter()
            .filter_map(|(duration, damage, _)| (round <= *duration).then_some(*damage))
            .sum();
        let timed_critical: f64 = rules
            .timed
            .iter()
            .filter_map(|(duration, _, critical)| (round <= *duration).then_some(*critical))
            .sum();
        let round_multiplier =
            monster_round_damage_multiplier(rules.damage_per_round, round, timed_damage);
        let is_area = rules
            .area
            .is_some_and(|(chance, _)| living_count > 1 && rng.gen::<f64>() < chance);
        let targets: Vec<usize> = if is_area {
            living
                .iter()
                .enumerate()
                .filter_map(|(index, alive)| (*alive).then_some(index))
                .collect()
        } else {
            let boundaries = threat_target_boundaries(&weights, &living);
            let roll = rng.gen::<f64>();
            let selected = (0..living.len())
                .rev()
                .find(|index| living[*index] && roll <= boundaries[*index])
                .or_else(|| living.iter().position(|alive| *alive))
                .unwrap_or(0);
            vec![selected]
        };

        for target in targets {
            let member = &request.party[target];
            let stage = rules
                .berserker
                .get(&member.id)
                .map(|(thresholds, _, _)| {
                    berserker_stage(member_hp[target], maximum_hp[target], *thresholds)
                })
                .unwrap_or(0);
            let berserker_evasion = rules
                .berserker
                .get(&member.id)
                .map(|(_, _, bonus)| *bonus * f64::from(stage))
                .unwrap_or(0.0);
            let focus_evasion = rules
                .focus
                .get(&member.id)
                .filter(|_| focus_lost_round[target].is_none())
                .map(|(_, evasion, _)| *evasion)
                .unwrap_or(0.0);
            if rng.gen::<f64>()
                < (member.stats.evasion + berserker_evasion + focus_evasion).clamp(0.0, 0.75)
            {
                continue;
            }
            let threshold = rules.threshold.unwrap_or(0);
            let normal = if rules.threshold.is_some() {
                normal_damage_after_tdef(
                    member.stats.defense,
                    request.enemy.attack as f64,
                    threshold,
                )
            } else {
                request.enemy.attack as f64 * 100.0 / (100.0 + member.stats.defense as f64)
            };
            let critical = if rules.threshold.is_some() {
                critical_damage_after_tdef(
                    member.stats.defense,
                    threshold,
                    request.enemy.attack as f64,
                    request.enemy.critical_damage,
                    0.0,
                )
            } else {
                normal * request.enemy.critical_damage
            };
            let damage = if is_area {
                let ratio = rules.area.map(|(_, ratio)| ratio).unwrap_or(1.0);
                (normal * ratio).ceil()
            } else if rng.gen::<f64>()
                < (request.enemy.critical_chance * (1.0 + timed_critical)).clamp(0.0, 1.0)
            {
                (critical * round_multiplier).round()
            } else {
                (normal * round_multiplier).round()
            };
            let previous = member_hp[target];
            member_hp[target] = (member_hp[target] - damage).max(0.0);
            if damage > 0.0 && rules.focus.contains_key(&member.id) {
                focus_lost_round[target] = Some(round);
            }
            if member_hp[target] <= 0.0
                && protector_available
                && protector.is_some_and(|index| index != target && member_hp[index] > 0.0)
            {
                let protector_index = protector.unwrap_or(target);
                protector_available = false;
                member_hp[target] = previous;
                member_hp[protector_index] = (member_hp[protector_index] - damage).max(0.0);
                if damage > 0.0 && rules.focus.contains_key(&request.party[protector_index].id) {
                    focus_lost_round[protector_index] = Some(round);
                }
            }
        }

        if member_hp.iter().all(|health| *health <= 0.0) {
            return (
                false,
                round,
                member_hp.into_iter().zip(damage_done).collect(),
            );
        }

        for (index, member) in request.party.iter().enumerate() {
            if member_hp[index] <= 0.0 || rng.gen::<f64>() < request.enemy.evasion.clamp(0.0, 0.75)
            {
                continue;
            }
            let stage = rules
                .berserker
                .get(&member.id)
                .map(|(thresholds, _, _)| {
                    berserker_stage(member_hp[index], maximum_hp[index], *thresholds)
                })
                .unwrap_or(0);
            let attack_bonus = rules
                .berserker
                .get(&member.id)
                .map(|(_, bonus, _)| *bonus * f64::from(stage))
                .unwrap_or(0.0);
            let focus_critical = rules
                .focus
                .get(&member.id)
                .filter(|_| focus_lost_round[index].is_none())
                .map(|(critical, _, _)| *critical)
                .unwrap_or(0.0);
            let critical =
                rng.gen::<f64>() < (member.stats.critical_chance + focus_critical).clamp(0.0, 1.0);
            let raw = member.stats.attack as f64
                * (1.0 + attack_bonus)
                * if critical {
                    member.stats.critical_damage
                } else {
                    1.0
                };
            let dealt =
                raw * 100.0 / (100.0 + request.enemy.defense as f64) * party_damage_multiplier;
            enemy_hp -= dealt;
            damage_done[index] += dealt;
        }
        if enemy_hp <= 0.0 {
            return (
                true,
                round,
                member_hp.into_iter().zip(damage_done).collect(),
            );
        }
        for (index, member) in request.party.iter().enumerate() {
            if member_hp[index] > 0.0 {
                let healing = rules.regeneration.get(&member.id).copied().unwrap_or(0.0);
                member_hp[index] = (member_hp[index] + healing).min(maximum_hp[index]);
            }
        }
    }
    (
        enemy_hp <= 0.0,
        request.enemy.max_rounds.max(1),
        member_hp.into_iter().zip(damage_done).collect(),
    )
}

fn simulate_internal<F: FnMut(u32, u32)>(
    request: &SimulationRequest,
    cancel: &CancellationToken,
    progress: &mut F,
    party_damage_multiplier: f64,
) -> Result<SimulationResult, SimulationError> {
    if request.iterations == 0 {
        return Err(SimulationError::NoIterations);
    }
    if request.party.is_empty() {
        return Err(SimulationError::EmptyParty);
    }
    let mut rng = ChaCha8Rng::seed_from_u64(request.seed);
    let mut wins = 0_u32;
    let mut total_rounds = 0_u64;
    let mut min_rounds = u32::MAX;
    let mut max_rounds = 0;
    let mut survived = vec![0_u32; request.party.len()];
    let mut damages = vec![0_f64; request.party.len()];
    let mut remaining = vec![0_f64; request.party.len()];
    let report_every = (request.iterations / 100).max(1);
    for iteration in 0..request.iterations {
        if cancel.is_cancelled() {
            return Err(SimulationError::Cancelled);
        }
        let (win, rounds, state) = run_once(request, &mut rng, party_damage_multiplier);
        wins += u32::from(win);
        total_rounds += u64::from(rounds);
        min_rounds = min_rounds.min(rounds);
        max_rounds = max_rounds.max(rounds);
        for (idx, (hp, damage)) in state.into_iter().enumerate() {
            survived[idx] += u32::from(hp > 0.0);
            remaining[idx] += hp.max(0.0);
            damages[idx] += damage;
        }
        if (iteration + 1) % report_every == 0 || iteration + 1 == request.iterations {
            progress(iteration + 1, request.iterations);
        }
    }
    let count = f64::from(request.iterations);
    Ok(SimulationResult {
        seed: request.seed,
        iterations: request.iterations,
        success_rate: f64::from(wins) / count,
        average_rounds: total_rounds as f64 / count,
        minimum_rounds: min_rounds,
        maximum_rounds: max_rounds,
        members: request
            .party
            .iter()
            .enumerate()
            .map(|(i, m)| MemberResult {
                id: m.id.clone(),
                survival_rate: f64::from(survived[i]) / count,
                average_damage: damages[i] / count,
                average_remaining_health: remaining[i] / count,
            })
            .collect(),
    })
}

fn run_once(
    request: &SimulationRequest,
    rng: &mut ChaCha8Rng,
    party_damage_multiplier: f64,
) -> (bool, u32, Vec<(f64, f64)>) {
    let mut enemy_hp = request.enemy.health as f64;
    let mut member_hp: Vec<f64> = request
        .party
        .iter()
        .map(|m| m.stats.health as f64)
        .collect();
    let mut damage_done = vec![0.0; request.party.len()];
    for round in 1..=request.enemy.max_rounds.max(1) {
        for (idx, member) in request.party.iter().enumerate() {
            if member_hp[idx] <= 0.0 || rng.gen::<f64>() < request.enemy.evasion.clamp(0.0, 0.75) {
                continue;
            }
            let crit = rng.gen::<f64>() < member.stats.critical_chance;
            let raw = member.stats.attack as f64
                * if crit {
                    member.stats.critical_damage
                } else {
                    1.0
                };
            let dealt =
                raw * 100.0 / (100.0 + request.enemy.defense as f64) * party_damage_multiplier;
            enemy_hp -= dealt;
            damage_done[idx] += dealt;
        }
        if enemy_hp <= 0.0 {
            return (
                true,
                round,
                member_hp.into_iter().zip(damage_done).collect(),
            );
        }
        let living: Vec<usize> = member_hp
            .iter()
            .enumerate()
            .filter_map(|(i, h)| (*h > 0.0).then_some(i))
            .collect();
        if living.is_empty() {
            return (
                false,
                round,
                member_hp.into_iter().zip(damage_done).collect(),
            );
        }
        let target = living[rng.gen_range(0..living.len())];
        if rng.gen::<f64>() >= request.party[target].stats.evasion {
            let crit = rng.gen::<f64>() < request.enemy.critical_chance;
            let raw = request.enemy.attack as f64
                * if crit {
                    request.enemy.critical_damage
                } else {
                    1.0
                };
            member_hp[target] -= raw * 100.0 / (100.0 + request.party[target].stats.defense as f64);
        }
    }
    (
        enemy_hp <= 0.0,
        request.enemy.max_rounds.max(1),
        member_hp.into_iter().zip(damage_done).collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    fn stats() -> CalculatedStats {
        CalculatedStats {
            health: 100,
            attack: 50,
            defense: 20,
            evasion: 0.1,
            critical_chance: 0.2,
            critical_damage: 2.0,
        }
    }
    #[test]
    fn simulation_is_seeded_and_reports_progress() {
        let req = SimulationRequest {
            seed: 42,
            iterations: 1000,
            party: vec![Combatant {
                id: "h1".into(),
                stats: stats(),
            }],
            enemy: QuestEnemy {
                health: 100,
                attack: 10,
                defense: 10,
                evasion: 0.0,
                critical_chance: 0.0,
                critical_damage: 1.0,
                max_rounds: 10,
            },
        };
        let mut progress = Vec::new();
        let a = simulate(&req, &CancellationToken::default(), |d, _| progress.push(d)).unwrap();
        let b = simulate(&req, &CancellationToken::default(), |_, _| {}).unwrap();
        assert_eq!(a, b);
        assert_eq!(progress.last(), Some(&1000));
        assert_eq!(a.success_rate, 1.0);
    }
    #[test]
    fn cancellation_is_observed() {
        let token = CancellationToken::default();
        token.cancel();
        let req = SimulationRequest {
            seed: 1,
            iterations: 1,
            party: vec![Combatant {
                id: "h".into(),
                stats: stats(),
            }],
            enemy: QuestEnemy {
                health: 1,
                attack: 1,
                defense: 1,
                evasion: 0.0,
                critical_chance: 0.0,
                critical_damage: 1.0,
                max_rounds: 1,
            },
        };
        assert_eq!(
            simulate(&req, &token, |_, _| {}),
            Err(SimulationError::Cancelled)
        );
    }
    #[test]
    fn background_job_finishes_off_thread() {
        let req = SimulationRequest {
            seed: 9,
            iterations: 10,
            party: vec![Combatant {
                id: "h".into(),
                stats: stats(),
            }],
            enemy: QuestEnemy {
                health: 1,
                attack: 1,
                defense: 1,
                evasion: 0.0,
                critical_chance: 0.0,
                critical_damage: 1.0,
                max_rounds: 1,
            },
        };
        let job = spawn_simulation(req);
        let events: Vec<_> = job.events.iter().collect();
        assert!(
            matches!(events.last(), Some(SimulationEvent::Finished(Ok(result))) if result.iterations == 10)
        );
    }
    #[test]
    fn validation_finds_duplicates_and_restrictions() {
        let item = EquipmentSpec {
            item_id: "x".into(),
            slot: EquipmentSlot::Weapon,
            quality: Quality::Normal,
            required_level: 5,
            allowed_classes: BTreeSet::from(["mage".into()]),
            modifiers: vec![],
            element_modifier: None,
            spirit_modifier: None,
            artifact_modifier: None,
            shiny: false,
            transcended: false,
        };
        let input = BuildInput {
            class_id: "knight".into(),
            level: 1,
            titan: false,
            seed_points: BTreeMap::new(),
            base: BaseStats::default(),
            equipment: vec![item.clone(), item],
            skill_modifiers: vec![],
            class_modifiers: vec![],
            card_modifiers: vec![],
            environment_modifiers: vec![],
        };
        assert_eq!(validate_equipment(&input).len(), 5);
    }

    #[test]
    fn fixed_and_random_element_barriers_match_bundle_rules() {
        let fighters = vec![
            ElementContribution {
                fighter_id: "fire".into(),
                element: Element::Fire,
                power: 200.0,
            },
            ElementContribution {
                fighter_id: "all".into(),
                element: Element::All,
                power: 100.0,
            },
        ];
        let fixed = resolve_element_barrier(&ElementBarrier {
            mode: BarrierMode::Fixed(Element::Fire),
            candidates: vec![],
            health: 250.0,
            required_power: 0.0,
            rudo_multiplier: 1.0,
            fighters: fighters.clone(),
        });
        assert_eq!(fixed.effective_power, 250.0);
        assert!(fixed.broken);

        let random = resolve_element_barrier(&ElementBarrier {
            mode: BarrierMode::Random,
            candidates: vec![Element::Fire, Element::Water],
            health: 0.0,
            required_power: 251.0,
            rudo_multiplier: 1.0,
            fighters,
        });
        assert_eq!(random.effective_power, 250.0);
        assert_eq!(random.damage_multiplier, 0.2);
    }

    #[test]
    fn titan_floor_curve_has_exact_boundary_values() {
        let floor_1 = TitanFloorCorrection {
            floor: 1,
            reduction: 0.0,
        }
        .bonuses();
        assert_eq!(floor_1.health_percent, 5.0);
        assert_eq!(floor_1.attack_percent, 5.0);
        assert_eq!(floor_1.defense_percent, 5.0);
        let floor_31 = TitanFloorCorrection {
            floor: 31,
            reduction: 0.0,
        }
        .bonuses();
        assert_eq!(floor_31.health_percent, 200.0);
        assert_eq!(floor_31.attack_percent, 100.0);
        assert_eq!(floor_31.defense_percent, 40.0);
        let reduced = TitanFloorCorrection {
            floor: 31,
            reduction: 0.25,
        }
        .bonuses();
        assert_eq!(reduced.health_percent, 150.0);
        assert_eq!(reduced.attack_percent, 75.0);
        assert_eq!(reduced.defense_percent, 30.0);
    }

    #[test]
    fn elite_presets_are_data_exact_for_supported_combat_fields() {
        assert_eq!(EliteKind::Agile.modifier().monster_evasion, 0.4);
        assert_eq!(EliteKind::Huge.modifier().monster_health, 1.0);
        assert_eq!(EliteKind::Dire.modifier().monster_critical_chance, 3.0);
        assert_eq!(
            EliteKind::Wealthy.modifier(),
            EnvironmentModifier::default()
        );
        let epic = EliteKind::Epic.modifier();
        assert_eq!(epic.monster_health, 0.5);
        assert_eq!(epic.monster_attack, 0.25);
        assert_eq!(epic.monster_critical_chance, 0.5);
        assert_eq!(epic.monster_evasion, 0.1);
    }

    #[test]
    fn tdef_formula_has_exact_segment_boundaries() {
        let threshold = 100;
        assert_eq!(normal_damage_after_tdef(0, 100.0, threshold), 150.0);
        assert_eq!(normal_damage_after_tdef(100, 100.0, threshold), 100.0);
        assert_eq!(normal_damage_after_tdef(200, 100.0, threshold), 50.0);
        assert_eq!(normal_damage_after_tdef(400, 100.0, threshold), 30.0);
        assert_eq!(normal_damage_after_tdef(1200, 100.0, threshold), 25.0);
        assert_eq!(normal_damage_after_tdef(1201, 100.0, threshold), 25.0);
        assert_eq!(
            critical_damage_after_tdef(0, threshold, 100.0, 2.0, 0.0),
            300.0
        );
        assert_eq!(
            critical_damage_after_tdef(100, threshold, 100.0, 2.0, 0.0),
            200.0
        );
        assert_eq!(
            critical_damage_after_tdef(101, threshold, 100.0, 2.0, 0.0),
            200.0
        );
    }

    #[test]
    fn timed_damage_and_threat_boundaries_match_bundle_helpers() {
        assert_eq!(monster_round_damage_multiplier(0.1, 1, 0.25), 1.25);
        assert_eq!(monster_round_damage_multiplier(0.1, 3, 0.25), 1.5);
        assert_eq!(
            threat_target_boundaries(&[1.0, 2.0, 3.0], &[true, true, true]),
            vec![1.0, 5.0 / 6.0, 0.5]
        );
        assert_eq!(
            threat_target_boundaries(&[1.0, 2.0, 3.0], &[true, false, true]),
            vec![1.0, 0.0, 0.75]
        );
    }

    #[test]
    fn berserker_stage_thresholds_are_inclusive_like_the_bundle() {
        let thresholds = [0.75, 0.5, 0.25];
        assert_eq!(berserker_stage(75.0, 100.0, thresholds), 0);
        assert_eq!(berserker_stage(74.0, 100.0, thresholds), 1);
        assert_eq!(berserker_stage(50.0, 100.0, thresholds), 1);
        assert_eq!(berserker_stage(49.0, 100.0, thresholds), 2);
        assert_eq!(berserker_stage(25.0, 100.0, thresholds), 2);
        assert_eq!(berserker_stage(24.0, 100.0, thresholds), 3);
        assert_eq!(berserker_stage(0.0, 100.0, thresholds), 0);
    }

    #[test]
    fn advanced_rules_are_seeded_and_do_not_change_legacy_api() {
        let request = AdvancedSimulationRequest {
            battle: SimulationRequest {
                seed: 73,
                iterations: 128,
                party: vec![
                    Combatant {
                        id: "protector".into(),
                        stats: stats(),
                    },
                    Combatant {
                        id: "focused".into(),
                        stats: stats(),
                    },
                ],
                enemy: QuestEnemy {
                    health: 600,
                    attack: 25,
                    defense: 40,
                    evasion: 0.0,
                    critical_chance: 0.1,
                    critical_damage: 1.5,
                    max_rounds: 12,
                },
            },
            quest_rules: BattleRules::default(),
            combat_rules: vec![
                CombatRule::DefenseThreshold { threshold: 20 },
                CombatRule::TimedMonsterModifier {
                    duration: 2,
                    damage_delta: 0.2,
                    critical_chance_delta: 0.5,
                },
                CombatRule::MonsterDamagePerRound { delta: 0.05 },
                CombatRule::AreaAttack {
                    chance: 0.2,
                    damage_ratio: 0.5,
                },
                CombatRule::Threat {
                    fighter_id: "protector".into(),
                    weight: 3.0,
                },
                CombatRule::Regeneration {
                    fighter_id: "focused".into(),
                    health: 2.0,
                },
                CombatRule::LordIntercept {
                    protector_id: "protector".into(),
                },
                CombatRule::OpeningFocus {
                    fighter_id: "focused".into(),
                    critical_chance: 0.2,
                    evasion: 0.1,
                    recover_after_rounds: Some(2),
                },
                CombatRule::BerserkerStages {
                    fighter_id: "protector".into(),
                    hp_thresholds: [0.75, 0.5, 0.25],
                    attack_per_stage: 0.1,
                    evasion_per_stage: 0.02,
                },
            ],
        };
        let first = simulate_advanced(&request, &CancellationToken::default(), |_, _| {}).unwrap();
        let second = simulate_advanced(&request, &CancellationToken::default(), |_, _| {}).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.iterations, 128);
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenFixture {
        request: RuleSimulationRequest,
        expected: GoldenExpected,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenExpected {
        success_rate: f64,
        average_rounds: f64,
        minimum_rounds: u32,
        maximum_rounds: u32,
        members: Vec<MemberResult>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AdvancedGoldenFixture {
        request: AdvancedSimulationRequest,
        expected: SimulationResult,
    }

    #[test]
    fn public_preview_shaped_fixture_is_a_seeded_golden_case() {
        let fixture: GoldenFixture = serde_json::from_str(include_str!(
            "../../../tests/golden/public-preview-jurassic04.json"
        ))
        .unwrap();
        let result =
            simulate_with_rules(&fixture.request, &CancellationToken::default(), |_, _| {})
                .unwrap();
        assert_eq!(result.success_rate, fixture.expected.success_rate);
        assert_eq!(result.average_rounds, fixture.expected.average_rounds);
        assert_eq!(result.minimum_rounds, fixture.expected.minimum_rounds);
        assert_eq!(result.maximum_rounds, fixture.expected.maximum_rounds);
        assert_eq!(result.members, fixture.expected.members);
    }

    #[test]
    fn advanced_combat_rules_have_a_seeded_golden_case() {
        let fixture: AdvancedGoldenFixture = serde_json::from_str(include_str!(
            "../../../tests/golden/advanced-combat-rules.json"
        ))
        .unwrap();
        let result =
            simulate_advanced(&fixture.request, &CancellationToken::default(), |_, _| {}).unwrap();
        assert_eq!(result, fixture.expected);
    }
}
