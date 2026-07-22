use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "hero-data",
    about = "Validate and maintain offline Hero Lineup content"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Validate {
        directory: PathBuf,
    },
    Build {
        input: PathBuf,
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long)]
        game_data_version: String,
        #[arg(long)]
        simulator_version: String,
        #[arg(long)]
        asset_version: String,
        #[arg(long, default_value = env!("CARGO_PKG_VERSION"))]
        app_version: String,
        #[arg(long, default_value = "0.1.0")]
        minimum_app_version: String,
    },
    Manifest {
        directory: PathBuf,
        #[arg(long)]
        game_data_version: String,
        #[arg(long)]
        simulator_version: String,
        #[arg(long)]
        asset_version: String,
        #[arg(long, default_value = env!("CARGO_PKG_VERSION"))]
        app_version: String,
        #[arg(long, default_value = "0.1.0")]
        minimum_app_version: String,
    },
    Inspect {
        package: PathBuf,
    },
    Diff {
        old_package: PathBuf,
        new_package: PathBuf,
    },
    Install {
        package: PathBuf,
        destination: PathBuf,
    },
    Verify {
        package: PathBuf,
    },
}
fn main() -> Result<()> {
    let cli = Cli::parse();
    let value = match cli.command {
        Command::Validate { directory } => {
            serde_json::to_value(hero_data::validate_directory(&directory)?)?
        }
        Command::Build {
            input,
            output,
            game_data_version,
            simulator_version,
            asset_version,
            app_version,
            minimum_app_version,
        } => serde_json::to_value(hero_data::build_package(
            &input,
            &output,
            &game_data_version,
            &simulator_version,
            &asset_version,
            &app_version,
            &minimum_app_version,
        )?)?,
        Command::Manifest {
            directory,
            game_data_version,
            simulator_version,
            asset_version,
            app_version,
            minimum_app_version,
        } => serde_json::to_value(hero_data::write_directory_manifest(
            &directory,
            &game_data_version,
            &simulator_version,
            &asset_version,
            &app_version,
            &minimum_app_version,
        )?)?,
        Command::Inspect { package } => {
            serde_json::to_value(hero_data::inspect_package(&package)?)?
        }
        Command::Diff {
            old_package,
            new_package,
        } => serde_json::to_value(hero_data::diff_packages(&old_package, &new_package)?)?,
        Command::Install {
            package,
            destination,
        } => serde_json::to_value(hero_data::install_package(&package, &destination)?)?,
        Command::Verify { package } => serde_json::to_value(hero_data::verify_package(&package)?)?,
    };
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}
