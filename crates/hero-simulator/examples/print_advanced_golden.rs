use hero_simulator::{simulate_advanced, AdvancedSimulationRequest, CancellationToken};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    request: AdvancedSimulationRequest,
}

fn main() {
    let fixture: Fixture = serde_json::from_str(include_str!(
        "../../../tests/golden/advanced-combat-rules.json"
    ))
    .expect("valid fixture");
    let result = simulate_advanced(&fixture.request, &CancellationToken::default(), |_, _| {})
        .expect("simulation succeeds");
    println!("{}", serde_json::to_string_pretty(&result).unwrap());
}
