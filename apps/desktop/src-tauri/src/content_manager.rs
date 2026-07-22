use hero_data::{
    inspect_package, install_package_checked, verify_package, ContentManifest, DataError,
    ValidationReport,
};
use semver::Version;
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone)]
pub(crate) struct ContentPaths {
    pub(crate) bundled: PathBuf,
    pub(crate) installed: PathBuf,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ContentSource {
    Bundled,
    Installed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentStatus {
    pub(crate) source: ContentSource,
    pub(crate) app_version: String,
    pub(crate) schema_version: u32,
    pub(crate) game_data_version: String,
    pub(crate) simulator_version: String,
    pub(crate) asset_version: String,
    pub(crate) minimum_app_version: String,
    pub(crate) created_at: String,
    pub(crate) files: usize,
    pub(crate) total_bytes: u64,
    pub(crate) statistics: std::collections::BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataInstallResult {
    pub(crate) content: ContentStatus,
    pub(crate) verification: ValidationReport,
    pub(crate) stale_simulations: usize,
}

impl ContentPaths {
    /// Loads installed content first and falls back to the immutable bundled snapshot when the
    /// installed directory is absent or fails application-level parsing.
    pub(crate) fn load_active<T, F>(
        &self,
        mut load: F,
    ) -> Result<(T, PathBuf, ContentSource), String>
    where
        F: FnMut(&Path) -> Result<T, String>,
    {
        if self.installed.is_dir() {
            if let Ok(value) = load(&self.installed) {
                return Ok((value, self.installed.clone(), ContentSource::Installed));
            }
        }
        load(&self.bundled).map(|value| (value, self.bundled.clone(), ContentSource::Bundled))
    }
}

pub(crate) fn install<F>(
    package: &Path,
    destination: &Path,
    current_app_version: &str,
    current_simulator_version: &str,
    preflight: F,
) -> Result<(ContentManifest, ValidationReport), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    validate_package_path(package)?;
    let verification = verify_package(package).map_err(data_error)?;
    let inspected = inspect_package(package).map_err(data_error)?;
    ensure_app_compatible(&inspected, current_app_version)?;
    if inspected.simulator_version != current_simulator_version {
        return Err(format!(
            "数据包模拟器版本为 {}，当前应用需要 {}",
            inspected.simulator_version, current_simulator_version
        ));
    }
    let manifest = install_package_checked(package, destination, |root| {
        preflight(root).map_err(DataError::Validation)
    })
    .map_err(data_error)?;
    Ok((manifest, verification))
}

pub(crate) fn status(root: &Path, source: ContentSource) -> Result<ContentStatus, String> {
    let manifest = read_directory_manifest(root)?;
    let total_bytes = manifest.files.iter().map(|entry| entry.size).sum();
    Ok(ContentStatus {
        source,
        app_version: manifest.app_version,
        schema_version: manifest.schema_version,
        game_data_version: manifest.game_data_version,
        simulator_version: manifest.simulator_version,
        asset_version: manifest.asset_version,
        minimum_app_version: manifest.minimum_app_version,
        created_at: manifest.created_at.to_rfc3339(),
        files: manifest.files.len(),
        total_bytes,
        statistics: manifest.statistics,
    })
}

pub(crate) fn ensure_directory_compatible(
    root: &Path,
    current_app_version: &str,
) -> Result<(), String> {
    let manifest = read_directory_manifest(root)?;
    if manifest.schema_version != hero_data::DATA_PACKAGE_SCHEMA {
        return Err(format!(
            "内容清单 schemaVersion {} 不受支持",
            manifest.schema_version
        ));
    }
    ensure_app_compatible(&manifest, current_app_version)
}

pub(crate) fn resolve_content_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = portable_relative_path(relative)?;
    let root = fs::canonicalize(root).map_err(|error| format!("无法解析内容目录：{error}"))?;
    let candidate = fs::canonicalize(root.join(relative))
        .map_err(|error| format!("本地资源不存在：{error}"))?;
    if !candidate.starts_with(&root) || !candidate.is_file() {
        return Err("资源路径超出本地内容目录".to_owned());
    }
    Ok(candidate)
}

fn portable_relative_path(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() || raw.contains('\\') || raw.contains('\0') {
        return Err("资源路径不是安全的相对路径".to_owned());
    }
    let path = Path::new(raw);
    let mut count = 0;
    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err("资源路径不是安全的相对路径".to_owned());
        };
        let segment = segment
            .to_str()
            .ok_or_else(|| "资源路径必须是 UTF-8".to_owned())?;
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment
                .chars()
                .any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        {
            return Err("资源路径包含跨平台不支持的字符".to_owned());
        }
        count += 1;
    }
    if count < 2
        || path.components().next().and_then(|part| match part {
            Component::Normal(value) => value.to_str(),
            _ => None,
        }) != Some("Sprite")
    {
        return Err("只允许访问本地 Sprite 资源".to_owned());
    }
    Ok(path.to_path_buf())
}

fn ensure_app_compatible(
    manifest: &ContentManifest,
    current_app_version: &str,
) -> Result<(), String> {
    let current = Version::parse(current_app_version)
        .map_err(|error| format!("应用版本不是有效的语义版本：{error}"))?;
    let minimum = Version::parse(&manifest.minimum_app_version)
        .map_err(|error| format!("数据包 minimumAppVersion 无效：{error}"))?;
    if current < minimum {
        return Err(format!(
            "数据包要求应用版本至少为 {minimum}，当前版本为 {current}"
        ));
    }
    Ok(())
}

fn read_directory_manifest(root: &Path) -> Result<ContentManifest, String> {
    let raw = fs::read(root.join("manifest.json"))
        .map_err(|error| format!("无法读取内容清单：{error}"))?;
    serde_json::from_slice(&raw).map_err(|error| format!("无法解析内容清单：{error}"))
}

fn validate_package_path(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("所选数据包不是本地文件".to_owned());
    }
    if path.extension().and_then(|value| value.to_str()) != Some("zysdata") {
        return Err("数据包扩展名必须是 .zysdata".to_owned());
    }
    Ok(())
}

fn data_error(error: DataError) -> String {
    format!("数据包校验失败：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use hero_data::{build_package, REQUIRED_JSON};

    fn fixture(root: &Path) {
        for name in REQUIRED_JSON {
            let path = root.join("TextAsset").join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let value = if *name == "levels.json" {
                r#"{"levels":[]}"#
            } else {
                "{}"
            };
            fs::write(path, value).unwrap();
        }
        fs::create_dir_all(root.join("Sprite")).unwrap();
        fs::write(root.join("Sprite/icon.png"), b"png").unwrap();
    }

    #[test]
    fn bad_package_does_not_replace_content_or_touch_user_database() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fixture(&source);
        let package = temp.path().join("content.zysdata");
        build_package(&source, &package, "g2", "s2", "a2", "0.1.0", "0.1.0").unwrap();
        let app_data = temp.path().join("app-data");
        let destination = app_data.join("content");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("old.txt"), b"old-content").unwrap();
        let database = app_data.join("user.db");
        fs::write(&database, b"user-owned-database").unwrap();

        let result = install(&package, &destination, "0.1.0", "s2", |_| {
            Err("catalog preflight failed".to_owned())
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read(destination.join("old.txt")).unwrap(),
            b"old-content"
        );
        assert_eq!(fs::read(database).unwrap(), b"user-owned-database");
    }

    #[test]
    fn rejects_package_requiring_newer_application_before_replacement() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fixture(&source);
        let package = temp.path().join("content.zysdata");
        build_package(&source, &package, "g2", "s2", "a2", "9.0.0", "9.0.0").unwrap();
        let destination = temp.path().join("content");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("old.txt"), b"old-content").unwrap();

        let result = install(&package, &destination, "0.1.0", "s2", |_| Ok(()));

        assert!(result.unwrap_err().contains("至少为 9.0.0"));
        assert_eq!(
            fs::read(destination.join("old.txt")).unwrap(),
            b"old-content"
        );
    }

    #[test]
    fn successful_install_replaces_only_content_directory() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fixture(&source);
        let package = temp.path().join("content.zysdata");
        build_package(&source, &package, "g2", "s2", "a2", "0.1.0", "0.1.0").unwrap();
        let app_data = temp.path().join("app-data");
        let destination = app_data.join("content");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("old.txt"), b"old-content").unwrap();
        let database = app_data.join("user.db");
        fs::write(&database, b"user-owned-database").unwrap();

        let (manifest, report) =
            install(&package, &destination, "0.1.0", "s2", |_| Ok(())).unwrap();

        assert_eq!(manifest.game_data_version, "g2");
        assert!(report.files_checked > REQUIRED_JSON.len());
        assert!(!destination.join("old.txt").exists());
        assert!(destination.join("TextAsset/classes.json").is_file());
        assert_eq!(fs::read(database).unwrap(), b"user-owned-database");
    }

    #[test]
    fn simulator_version_mismatch_is_rejected_before_replacement() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fixture(&source);
        let package = temp.path().join("content.zysdata");
        build_package(&source, &package, "g2", "sim-new", "a2", "0.1.0", "0.1.0").unwrap();
        let destination = temp.path().join("content");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("old.txt"), b"old-content").unwrap();

        let result = install(&package, &destination, "0.1.0", "sim-current", |_| Ok(()));

        assert!(result.unwrap_err().contains("sim-new"));
        assert_eq!(
            fs::read(destination.join("old.txt")).unwrap(),
            b"old-content"
        );
    }

    #[test]
    fn resource_resolution_rejects_traversal_absolute_and_symlink_escape() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("content");
        fs::create_dir_all(root.join("Sprite")).unwrap();
        fs::write(root.join("Sprite/ok.png"), b"png").unwrap();
        fs::write(temp.path().join("secret.png"), b"secret").unwrap();

        assert_eq!(
            resolve_content_file(&root, "Sprite/ok.png").unwrap(),
            fs::canonicalize(root.join("Sprite/ok.png")).unwrap()
        );
        assert!(resolve_content_file(&root, "../secret.png").is_err());
        assert!(resolve_content_file(&root, "/tmp/secret.png").is_err());
        assert!(resolve_content_file(&root, "Sprite\\ok.png").is_err());
        assert!(resolve_content_file(&root, "Sprite/C:/secret.png").is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                temp.path().join("secret.png"),
                root.join("Sprite/link.png"),
            )
            .unwrap();
            assert!(resolve_content_file(&root, "Sprite/link.png").is_err());
        }
    }

    #[test]
    fn installed_content_has_priority_and_invalid_install_falls_back_to_bundle() {
        let temp = tempfile::tempdir().unwrap();
        let bundled = temp.path().join("bundled");
        let installed = temp.path().join("installed");
        fs::create_dir_all(&bundled).unwrap();
        fs::create_dir_all(&installed).unwrap();
        fs::write(bundled.join("marker"), "bundled").unwrap();
        fs::write(installed.join("marker"), "installed").unwrap();
        let paths = ContentPaths {
            bundled: bundled.clone(),
            installed: installed.clone(),
        };

        let (value, root, source) = paths
            .load_active(|root| fs::read_to_string(root.join("marker")).map_err(|e| e.to_string()))
            .unwrap();
        assert_eq!(value, "installed");
        assert_eq!(root, installed);
        assert_eq!(source, ContentSource::Installed);

        fs::remove_file(paths.installed.join("marker")).unwrap();
        let (value, root, source) = paths
            .load_active(|root| fs::read_to_string(root.join("marker")).map_err(|e| e.to_string()))
            .unwrap();
        assert_eq!(value, "bundled");
        assert_eq!(root, bundled);
        assert_eq!(source, ContentSource::Bundled);
    }
}
