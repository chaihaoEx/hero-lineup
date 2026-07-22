# Hero Lineup Rust core

This directory is a self-contained Cargo workspace so it can be developed before
the Tauri application workspace is wired up.

* `hero-domain` owns stable, platform-neutral domain and interchange types.
* `hero-catalog` loads local TextAsset data and owns character-sheet calculation
  plus hero/champion equipment legality checks.
* `hero-storage` owns SQLite migrations and repository operations.
* `hero-simulator` owns deterministic, cancellable battle simulation. Its older
  generic sheet helpers remain API-compatible; new desktop code should use
  `hero-catalog` for real local-data calculations.
* `hero-data` owns validation and versioned offline content packages, and provides
  the `hero-data` command-line program.

Run all quality gates with:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The repository root includes these packages as workspace members. All public
filesystem APIs accept `Path`/`PathBuf`; no platform directory is hard-coded.
