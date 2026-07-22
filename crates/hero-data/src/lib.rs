//! Offline content validation, packaging, verification and atomic installation.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};
use tempfile::Builder;
use thiserror::Error;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub const DATA_PACKAGE_SCHEMA: u32 = 1;
pub const REQUIRED_JSON: &[&str] = &[
    "classes.json",
    "heroes.json",
    "quests.json",
    "items.json",
    "skills.json",
    "levels.json",
    "qmodifiers.json",
    "texts_zh.json",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Data,
    Sprite,
    Default,
    Schema,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentManifest {
    pub app_version: String,
    pub schema_version: u32,
    pub game_data_version: String,
    pub simulator_version: String,
    pub asset_version: String,
    pub minimum_app_version: String,
    pub created_at: DateTime<Utc>,
    pub files: Vec<FileEntry>,
    pub statistics: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub files_checked: usize,
    pub json_documents: usize,
    pub total_bytes: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageDiff {
    pub old_game_data_version: String,
    pub new_game_data_version: String,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<String>,
}

#[derive(Debug, Error)]
pub enum DataError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid package: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("missing required file: {0}")]
    Missing(String),
    #[error("unsafe or non-portable path: {0}")]
    UnsafePath(String),
    #[error("checksum mismatch: {0}")]
    Checksum(String),
    #[error("manifest schema {0} is not supported (supported schema: {DATA_PACKAGE_SCHEMA})")]
    UnsupportedSchema(u32),
    #[error("validation failed: {0}")]
    Validation(String),
}
pub type Result<T> = std::result::Result<T, DataError>;

pub fn validate_directory(root: &Path) -> Result<ValidationReport> {
    let text_assets = root.join("TextAsset");
    for required in REQUIRED_JSON {
        let path = text_assets.join(required);
        if !path.is_file() {
            return Err(DataError::Missing(format!("TextAsset/{required}")));
        }
    }
    let mut files_checked = 0;
    let mut json_documents = 0;
    let mut total_bytes = 0;
    let mut warnings = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|e| DataError::Validation(e.to_string()))?;
        if entry.file_type().is_symlink() {
            return Err(DataError::UnsafePath(entry.path().display().to_string()));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|e| DataError::Validation(e.to_string()))?;
        portable_path(relative)?;
        files_checked += 1;
        total_bytes += entry
            .metadata()
            .map_err(|e| DataError::Validation(e.to_string()))?
            .len();
        if entry.path().extension().and_then(|s| s.to_str()) == Some("json") {
            let value: serde_json::Value = serde_json::from_reader(File::open(entry.path())?)?;
            json_documents += 1;
            if value.is_null() {
                warnings.push(format!("{} contains null", relative.display()));
            }
        }
    }
    validate_catalog_references(root)?;
    Ok(ValidationReport {
        files_checked,
        json_documents,
        total_bytes,
        warnings,
    })
}

pub fn build_package(
    input: &Path,
    output: &Path,
    game_data_version: &str,
    simulator_version: &str,
    asset_version: &str,
    app_version: &str,
    minimum_app_version: &str,
) -> Result<ContentManifest> {
    let manifest = create_manifest(
        input,
        game_data_version,
        simulator_version,
        asset_version,
        app_version,
        minimum_app_version,
    )?;
    let paths: Vec<PathBuf> = manifest
        .files
        .iter()
        .map(|entry| entry.path.clone().into())
        .collect();
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = File::create(output)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    zip.start_file("manifest.json", options)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    for relative in paths {
        zip.start_file(portable_path(&relative)?, options)?;
        zip.write_all(&fs::read(input.join(relative))?)?;
    }
    zip.finish()?;
    Ok(manifest)
}

pub fn create_manifest(
    input: &Path,
    game_data_version: &str,
    simulator_version: &str,
    asset_version: &str,
    app_version: &str,
    minimum_app_version: &str,
) -> Result<ContentManifest> {
    for (field, value) in [
        ("gameDataVersion", game_data_version),
        ("simulatorVersion", simulator_version),
        ("assetVersion", asset_version),
        ("appVersion", app_version),
        ("minimumAppVersion", minimum_app_version),
    ] {
        if value.trim().is_empty() {
            return Err(DataError::Validation(format!("{field} must not be empty")));
        }
    }
    validate_directory(input)?;
    let mut paths = collect_files(input)?;
    paths.retain(|p| p != Path::new("manifest.json"));
    let mut entries = Vec::new();
    for relative in &paths {
        let bytes = fs::read(input.join(relative))?;
        entries.push(FileEntry {
            path: portable_path(relative)?,
            kind: file_kind(relative)?,
            size: bytes.len() as u64,
            sha256: digest(&bytes),
        });
    }
    let statistics = content_statistics(input, &paths)?;
    Ok(ContentManifest {
        app_version: app_version.into(),
        schema_version: DATA_PACKAGE_SCHEMA,
        game_data_version: game_data_version.into(),
        simulator_version: simulator_version.into(),
        asset_version: asset_version.into(),
        minimum_app_version: minimum_app_version.into(),
        created_at: Utc::now(),
        files: entries,
        statistics,
    })
}

/// Builds and transactionally replaces `<directory>/manifest.json`.
pub fn write_directory_manifest(
    directory: &Path,
    game_data_version: &str,
    simulator_version: &str,
    asset_version: &str,
    app_version: &str,
    minimum_app_version: &str,
) -> Result<ContentManifest> {
    let manifest = create_manifest(
        directory,
        game_data_version,
        simulator_version,
        asset_version,
        app_version,
        minimum_app_version,
    )?;
    let destination = directory.join("manifest.json");
    let mut temp = Builder::new()
        .prefix(".manifest-staging-")
        .tempfile_in(directory)?;
    temp.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    temp.write_all(b"\n")?;
    temp.as_file().sync_all()?;
    let (file, staged) = temp.keep().map_err(|error| DataError::Io(error.error))?;
    drop(file);
    let backup = directory.join(format!(
        ".manifest-backup-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let had_old = destination.exists();
    if had_old {
        fs::rename(&destination, &backup)?;
    }
    match fs::rename(&staged, &destination) {
        Ok(()) => {
            if had_old {
                fs::remove_file(backup)?;
            }
            Ok(manifest)
        }
        Err(error) => {
            let _ = fs::remove_file(&staged);
            if had_old {
                let _ = fs::rename(&backup, &destination);
            }
            Err(DataError::Io(error))
        }
    }
}

pub fn inspect_package(package: &Path) -> Result<ContentManifest> {
    let mut archive = ZipArchive::new(File::open(package)?)?;
    let manifest = read_manifest(&mut archive)?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn verify_package(package: &Path) -> Result<ValidationReport> {
    let mut archive = ZipArchive::new(File::open(package)?)?;
    let manifest = read_manifest(&mut archive)?;
    validate_manifest(&manifest)?;
    let declared: BTreeSet<_> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    let actual: BTreeSet<_> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_owned()))
        .filter(|p| p != "manifest.json" && !p.ends_with('/'))
        .collect();
    if declared != actual.iter().map(String::as_str).collect() {
        return Err(DataError::Validation(
            "manifest file list does not match archive".into(),
        ));
    }
    let mut total = 0;
    for expected in &manifest.files {
        let mut file = archive.by_name(&expected.path)?;
        if file.enclosed_name().is_none() {
            return Err(DataError::UnsafePath(expected.path.clone()));
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        if bytes.len() as u64 != expected.size || digest(&bytes) != expected.sha256 {
            return Err(DataError::Checksum(expected.path.clone()));
        }
        total += bytes.len() as u64;
    }
    let temp = tempfile::tempdir()?;
    let mut archive = ZipArchive::new(File::open(package)?)?;
    archive.extract(temp.path())?;
    let mut report = validate_directory(temp.path())?;
    report.total_bytes = total;
    Ok(report)
}

pub fn diff_packages(old: &Path, new: &Path) -> Result<PackageDiff> {
    let old_m = inspect_package(old)?;
    let new_m = inspect_package(new)?;
    let old_files: BTreeMap<_, _> = old_m.files.iter().map(|f| (&f.path, &f.sha256)).collect();
    let new_files: BTreeMap<_, _> = new_m.files.iter().map(|f| (&f.path, &f.sha256)).collect();
    Ok(PackageDiff {
        old_game_data_version: old_m.game_data_version,
        new_game_data_version: new_m.game_data_version,
        added: new_files
            .keys()
            .filter(|p| !old_files.contains_key(*p))
            .map(|p| (*p).clone())
            .collect(),
        removed: old_files
            .keys()
            .filter(|p| !new_files.contains_key(*p))
            .map(|p| (*p).clone())
            .collect(),
        changed: new_files
            .iter()
            .filter(|(p, h)| old_files.get(*p).is_some_and(|old| old != *h))
            .map(|(p, _)| (*p).clone())
            .collect(),
    })
}

/// Verifies and atomically replaces `destination`. The previous content is restored on failure.
pub fn install_package(package: &Path, destination: &Path) -> Result<ContentManifest> {
    install_package_checked(package, destination, |_| Ok(()))
}

/// Verifies, extracts and validates a package before atomically replacing `destination`.
///
/// `preflight` runs against the fully extracted staging directory before the current content is
/// moved. Desktop applications can use it for application-specific parsing checks without
/// weakening the generic package validator. Any preflight failure therefore leaves the current
/// installation byte-for-byte untouched.
pub fn install_package_checked<F>(
    package: &Path,
    destination: &Path,
    preflight: F,
) -> Result<ContentManifest>
where
    F: FnOnce(&Path) -> Result<()>,
{
    verify_package(package)?;
    let manifest = inspect_package(package)?;
    let parent = destination
        .parent()
        .ok_or_else(|| DataError::Validation("destination must have a parent directory".into()))?;
    fs::create_dir_all(parent)?;
    let staging = Builder::new()
        .prefix(".hero-data-staging-")
        .tempdir_in(parent)?;
    {
        let mut archive = ZipArchive::new(File::open(package)?)?;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let Some(relative) = file.enclosed_name() else {
                return Err(DataError::UnsafePath(file.name().into()));
            };
            let target = staging.path().join(relative);
            if file.is_dir() {
                fs::create_dir_all(&target)?;
            } else {
                if let Some(p) = target.parent() {
                    fs::create_dir_all(p)?;
                }
                let mut out = File::create(&target)?;
                io::copy(&mut file, &mut out)?;
            }
        }
    }
    validate_directory(staging.path())?;
    preflight(staging.path())?;
    let backup = parent.join(format!(
        ".hero-data-backup-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    if backup.exists() {
        fs::remove_dir_all(&backup)?;
    }
    let had_old = destination.exists();
    if had_old {
        fs::rename(destination, &backup)?;
    }
    match fs::rename(staging.path(), destination) {
        Ok(()) => {
            if had_old {
                // The new directory is already active. A locked file in the old Windows
                // directory must not turn a successful atomic switch into a reported failure;
                // a later maintenance run may remove the uniquely named backup.
                let _ = fs::remove_dir_all(backup);
            }
            Ok(manifest)
        }
        Err(error) => {
            if had_old {
                if let Err(rollback) = fs::rename(&backup, destination) {
                    return Err(DataError::Validation(format!(
                        "content switch failed ({error}); rollback also failed ({rollback}); previous content remains at {}",
                        backup.display()
                    )));
                }
            }
            Err(DataError::Io(error))
        }
    }
}

fn validate_catalog_references(root: &Path) -> Result<()> {
    let text = root.join("TextAsset");
    let classes = object_document(&text.join("classes.json"), "classes")?;
    let heroes = object_document(&text.join("heroes.json"), "heroes")?;
    let quests = object_document(&text.join("quests.json"), "quests")?;
    let items = object_document(&text.join("items.json"), "items")?;
    let skills = object_document(&text.join("skills.json"), "skills")?;
    let modifiers = object_document(&text.join("qmodifiers.json"), "qmodifiers")?;
    let levels: serde_json::Value = serde_json::from_reader(File::open(text.join("levels.json"))?)?;
    if !levels.get("levels").is_some_and(|v| v.is_array()) {
        return Err(DataError::Validation(
            "TextAsset/levels.json must contain a levels array".into(),
        ));
    }

    for (catalog, values) in [
        ("classes", &classes),
        ("heroes", &heroes),
        ("quests", &quests),
        ("items", &items),
        ("skills", &skills),
        ("qmodifiers", &modifiers),
    ] {
        for (key, value) in values {
            let uid = value.get("uid").and_then(|v| v.as_str()).ok_or_else(|| {
                DataError::Validation(format!("{catalog}.{key} is missing string uid"))
            })?;
            if uid != key {
                return Err(DataError::Validation(format!(
                    "{catalog}.{key} uid is {uid}"
                )));
            }
        }
    }
    for (id, hero) in &heroes {
        let class = hero
            .get("class")
            .and_then(|v| v.as_str())
            .ok_or_else(|| DataError::Validation(format!("heroes.{id} is missing class")))?;
        require_key(&classes, class, &format!("heroes.{id}.class"))?;
        for field in ["skill1", "skill2", "skill3", "skill4"] {
            if let Some(reference) = hero.get(field).and_then(|v| v.as_str()) {
                require_key(&modifiers, reference, &format!("heroes.{id}.{field}"))?;
            }
        }
    }
    for (id, class) in &classes {
        if let Some(reference) = class.get("innate").and_then(|v| v.as_str()) {
            require_skill(&skills, reference, &format!("classes.{id}.innate"))?;
        }
        if let Some(references) = class.get("hireItems").and_then(|v| v.as_str()) {
            for reference in references.split(',').filter(|v| !v.is_empty()) {
                require_key(&items, reference, &format!("classes.{id}.hireItems"))?;
            }
        }
    }
    for (id, item) in &items {
        if let Some(reference) = item.get("skill").and_then(|v| v.as_str()) {
            require_skill(&skills, reference, &format!("items.{id}.skill"))?;
        }
    }

    let sprite_dir = root.join("Sprite");
    if !sprite_dir.is_dir() {
        return Err(DataError::Missing("Sprite".into()));
    }
    let sprite_names: BTreeSet<String> = fs::read_dir(&sprite_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.file_name().to_string_lossy().to_lowercase())
        .collect();
    for id in classes.keys() {
        require_any_sprite(
            &sprite_names,
            &[
                format!("icon_global_class_{id}.png"),
                format!("icon_global_class_{id}_128.png"),
            ],
            &format!("class {id}"),
        )?;
    }
    for id in heroes.keys() {
        require_any_sprite(
            &sprite_names,
            &[format!("icon_global_{id}.png")],
            &format!("champion {id}"),
        )?;
    }
    for id in items
        .keys()
        .filter(|id| !matches!(id.as_str(), "uncommon" | "flawless" | "epic" | "legendary"))
    {
        require_any_sprite(&sprite_names, &[format!("{id}.png")], &format!("item {id}"))?;
    }
    for (id, skill) in &skills {
        let family = skill.get("family").and_then(|v| v.as_str()).unwrap_or(id);
        let mut candidates = vec![
            format!("icon_global_skill_{id}.png"),
            format!("icon_global_skill_hero_{id}.png"),
            format!("icon_global_skill_{family}.png"),
            format!("icon_global_skill_hero_{family}.png"),
            format!("{id}.png"),
        ];
        if let Some(item_id) = id.strip_prefix("a_") {
            candidates.push(format!("{item_id}.png"));
        }
        if id.starts_with("q_") {
            candidates.push("icon_global_item_quiver.png".into());
        }
        require_any_sprite(&sprite_names, &candidates, &format!("skill {id}"))?;
    }
    Ok(())
}

fn object_document(path: &Path, label: &str) -> Result<serde_json::Map<String, serde_json::Value>> {
    serde_json::from_reader::<_, serde_json::Value>(File::open(path)?)?
        .as_object()
        .cloned()
        .ok_or_else(|| DataError::Validation(format!("{label} must be a JSON object")))
}

fn require_key(
    values: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    source: &str,
) -> Result<()> {
    if values.contains_key(key) {
        Ok(())
    } else {
        Err(DataError::Validation(format!(
            "{source} references missing id {key}"
        )))
    }
}

fn require_skill(
    skills: &serde_json::Map<String, serde_json::Value>,
    reference: &str,
    source: &str,
) -> Result<()> {
    if skills.contains_key(reference)
        || skills
            .values()
            .any(|skill| skill.get("family").and_then(|v| v.as_str()) == Some(reference))
    {
        Ok(())
    } else {
        Err(DataError::Validation(format!(
            "{source} references missing skill/family {reference}"
        )))
    }
}

fn require_any_sprite(names: &BTreeSet<String>, candidates: &[String], source: &str) -> Result<()> {
    if candidates
        .iter()
        .any(|name| names.contains(&name.to_lowercase()))
    {
        Ok(())
    } else {
        Err(DataError::Validation(format!(
            "{source} has no sprite (tried {})",
            candidates.join(", ")
        )))
    }
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|e| DataError::Validation(e.to_string()))?;
        if entry.file_type().is_file() {
            paths.push(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|e| DataError::Validation(e.to_string()))?
                    .to_path_buf(),
            );
        }
    }
    paths.sort();
    Ok(paths)
}

fn content_statistics(root: &Path, paths: &[PathBuf]) -> Result<BTreeMap<String, u64>> {
    let mut statistics = BTreeMap::from([
        ("files".into(), paths.len() as u64),
        (
            "jsonDocuments".into(),
            paths
                .iter()
                .filter(|path| path.extension().and_then(|v| v.to_str()) == Some("json"))
                .count() as u64,
        ),
        (
            "bytes".into(),
            paths.iter().try_fold(0_u64, |total, path| {
                Ok::<_, io::Error>(total + fs::metadata(root.join(path))?.len())
            })?,
        ),
        (
            "sprites".into(),
            paths
                .iter()
                .filter(|path| path.starts_with("Sprite"))
                .count() as u64,
        ),
    ]);
    for name in [
        "classes",
        "heroes",
        "quests",
        "items",
        "skills",
        "qmodifiers",
        "texts_zh",
        "chestodds",
        "skillTreeNodes",
        "skillTreePoints",
    ] {
        let path = root.join("TextAsset").join(format!("{name}.json"));
        if !path.is_file() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_reader(File::open(path)?)?;
        let count = logical_entry_count(&value);
        statistics.insert(name.into(), count as u64);
    }
    let levels: serde_json::Value =
        serde_json::from_reader(File::open(root.join("TextAsset/levels.json"))?)?;
    statistics.insert(
        "levels".into(),
        levels
            .get("levels")
            .and_then(|value| value.as_array())
            .map(Vec::len)
            .unwrap_or_default() as u64,
    );
    Ok(statistics)
}

fn logical_entry_count(value: &serde_json::Value) -> usize {
    if let Some(object) = value.as_object() {
        if object.len() == 1 {
            if let Some(nested) = object.values().next() {
                if nested.is_object() || nested.is_array() {
                    return logical_entry_count(nested);
                }
            }
        }
        object.len()
    } else {
        value.as_array().map(Vec::len).unwrap_or_default()
    }
}
fn portable_path(path: &Path) -> Result<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(v) => {
                let s = v
                    .to_str()
                    .ok_or_else(|| DataError::UnsafePath(path.display().to_string()))?;
                if !portable_segment(s) {
                    return Err(DataError::UnsafePath(path.display().to_string()));
                }
                parts.push(s);
            }
            _ => return Err(DataError::UnsafePath(path.display().to_string())),
        }
    }
    Ok(parts.join("/"))
}

fn portable_segment(segment: &str) -> bool {
    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.ends_with([' ', '.'])
        || segment.chars().any(|character| {
            character == '\\'
                || character.is_control()
                || matches!(character, '<' | '>' | ':' | '"' | '/' | '|' | '?' | '*')
        })
    {
        return false;
    }
    let stem = segment
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
        && !(stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
}

fn file_kind(path: &Path) -> Result<FileKind> {
    match path.components().next() {
        Some(std::path::Component::Normal(v)) if v == "TextAsset" => Ok(FileKind::Data),
        Some(std::path::Component::Normal(v)) if v == "Sprite" => Ok(FileKind::Sprite),
        Some(std::path::Component::Normal(v)) if v == "defaults" => Ok(FileKind::Default),
        Some(std::path::Component::Normal(v)) if v == "schemas" => Ok(FileKind::Schema),
        _ => Err(DataError::Validation(format!(
            "file must be under TextAsset, Sprite, defaults or schemas: {}",
            path.display()
        ))),
    }
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn read_manifest(archive: &mut ZipArchive<File>) -> Result<ContentManifest> {
    let mut raw = String::new();
    archive
        .by_name("manifest.json")
        .map_err(|_| DataError::Missing("manifest.json".into()))?
        .read_to_string(&mut raw)?;
    Ok(serde_json::from_str(&raw)?)
}

fn validate_manifest(manifest: &ContentManifest) -> Result<()> {
    if manifest.schema_version != DATA_PACKAGE_SCHEMA {
        return Err(DataError::UnsupportedSchema(manifest.schema_version));
    }
    for (field, value) in [
        ("appVersion", manifest.app_version.as_str()),
        ("gameDataVersion", manifest.game_data_version.as_str()),
        ("simulatorVersion", manifest.simulator_version.as_str()),
        ("assetVersion", manifest.asset_version.as_str()),
        ("minimumAppVersion", manifest.minimum_app_version.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(DataError::Validation(format!("{field} must not be empty")));
        }
    }
    let unique: BTreeSet<_> = manifest.files.iter().map(|entry| &entry.path).collect();
    if unique.len() != manifest.files.len() {
        return Err(DataError::Validation(
            "manifest contains duplicate paths".into(),
        ));
    }
    for entry in &manifest.files {
        let path = Path::new(&entry.path);
        portable_path(path)?;
        if file_kind(path)? != entry.kind {
            return Err(DataError::Validation(format!(
                "manifest kind does not match path {}",
                entry.path
            )));
        }
        if entry.sha256.len() != 64
            || !entry
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(DataError::Validation(format!(
                "invalid SHA-256 for {}",
                entry.path
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(root: &Path, suffix: &str) {
        for name in REQUIRED_JSON {
            let path = root.join("TextAsset").join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let body = if *name == "levels.json" {
                format!("{{\"levels\":[{{\"level\":1,\"version\":\"{suffix}\"}}]}}")
            } else {
                "{}".to_owned()
            };
            fs::write(path, body).unwrap();
        }
        fs::create_dir_all(root.join("Sprite")).unwrap();
        fs::write(root.join("Sprite/icon.png"), b"png").unwrap();
    }
    fn build(input: &Path, output: &Path, game: &str, asset: &str) {
        build_package(input, output, game, "sim-1", asset, "0.1.0", "0.1.0").unwrap();
    }
    #[test]
    fn package_verify_diff_and_install_roundtrip() {
        let temp = tempfile::tempdir().unwrap();
        let a = temp.path().join("a");
        let b = temp.path().join("b");
        fixture(&a, "1");
        fixture(&b, "2");
        fs::create_dir_all(b.join("defaults")).unwrap();
        fs::write(b.join("defaults/extra.json"), b"{}").unwrap();
        let pa = temp.path().join("a.zysdata");
        let pb = temp.path().join("b.zysdata");
        build(&a, &pa, "g1", "a1");
        build(&b, &pb, "g2", "a2");
        assert!(verify_package(&pa).unwrap().files_checked >= 9);
        let diff = diff_packages(&pa, &pb).unwrap();
        assert!(diff.added.contains(&"defaults/extra.json".into()));
        assert_eq!(diff.changed.len(), 1);
        let target = temp.path().join("installed");
        install_package(&pb, &target).unwrap();
        assert_eq!(validate_directory(&target).unwrap().json_documents, 10);
    }

    #[test]
    fn rejects_corrupt_archive_and_hash_mismatch() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fixture(&source, "1");
        let valid = temp.path().join("valid.zysdata");
        build(&source, &valid, "g1", "a1");

        let truncated = temp.path().join("truncated.zysdata");
        let mut bytes = fs::read(&valid).unwrap();
        bytes.truncate(bytes.len() / 2);
        fs::write(&truncated, bytes).unwrap();
        assert!(verify_package(&truncated).is_err());

        let bad_hash = temp.path().join("bad-hash.zysdata");
        let mut input = ZipArchive::new(File::open(&valid).unwrap()).unwrap();
        let mut output = ZipWriter::new(File::create(&bad_hash).unwrap());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for index in 0..input.len() {
            let mut entry = input.by_index(index).unwrap();
            let name = entry.name().to_owned();
            let mut content = Vec::new();
            entry.read_to_end(&mut content).unwrap();
            if name == "TextAsset/classes.json" {
                content = b"{\"tampered\":true}".to_vec();
            }
            output.start_file(name, options).unwrap();
            output.write_all(&content).unwrap();
        }
        output.finish().unwrap();
        assert!(matches!(
            verify_package(&bad_hash),
            Err(DataError::Checksum(_))
        ));
    }

    #[test]
    fn failed_install_preserves_previous_content() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fixture(&source, "1");
        let valid = temp.path().join("valid.zysdata");
        build(&source, &valid, "g1", "a1");
        let broken = temp.path().join("broken.zysdata");
        let mut bytes = fs::read(&valid).unwrap();
        bytes.truncate(bytes.len() / 3);
        fs::write(&broken, bytes).unwrap();
        let installed = temp.path().join("installed");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("keep.txt"), "old-data").unwrap();
        assert!(install_package(&broken, &installed).is_err());
        assert_eq!(
            fs::read_to_string(installed.join("keep.txt")).unwrap(),
            "old-data"
        );
    }

    #[test]
    fn failed_application_preflight_preserves_previous_content() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fixture(&source, "1");
        let package = temp.path().join("valid.zysdata");
        build(&source, &package, "g1", "a1");
        let installed = temp.path().join("installed");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("keep.txt"), "old-data").unwrap();

        let result = install_package_checked(&package, &installed, |_| {
            Err(DataError::Validation(
                "desktop catalog rejected package".into(),
            ))
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(installed.join("keep.txt")).unwrap(),
            "old-data"
        );
    }

    #[test]
    fn directory_manifest_is_replaced_and_excludes_itself() {
        let temp = tempfile::tempdir().unwrap();
        fixture(temp.path(), "1");
        fs::write(temp.path().join("manifest.json"), "{}").unwrap();
        let manifest =
            write_directory_manifest(temp.path(), "g1", "s1", "a1", "0.1.0", "0.1.0").unwrap();
        assert!(manifest
            .files
            .iter()
            .all(|entry| entry.path != "manifest.json"));
        assert_eq!(manifest.statistics["files"], 9);
        let disk: ContentManifest =
            serde_json::from_reader(File::open(temp.path().join("manifest.json")).unwrap())
                .unwrap();
        assert_eq!(disk, manifest);
    }

    #[test]
    fn package_paths_reject_windows_incompatible_segments_on_every_platform() {
        for path in [
            "Sprite/C:/icon.png",
            "Sprite/CON.png",
            "Sprite/com1.asset",
            "Sprite/trailing-dot./icon.png",
            "Sprite/question?.png",
        ] {
            assert!(portable_path(Path::new(path)).is_err(), "accepted {path}");
        }
        assert_eq!(
            portable_path(Path::new("Sprite/Icon_Global_英雄.png")).unwrap(),
            "Sprite/Icon_Global_英雄.png"
        );
    }
}
