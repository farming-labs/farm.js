use farm_ui_renderer_benchmark::render_ir;
use std::hint::black_box;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<String> = std::env::args().collect();
    let command = arguments.get(1).map(String::as_str).unwrap_or("");

    match command {
        "render" => {
            let input = std::fs::read(arguments.get(2).ok_or("missing input path")?)?;
            let html = render_ir(&input).map_err(|error| error.to_string())?;
            std::fs::write(arguments.get(3).ok_or("missing output path")?, html)?;
        }
        "bench" => {
            let input = std::fs::read(arguments.get(2).ok_or("missing input path")?)?;
            let iterations: usize = arguments.get(3).ok_or("missing iteration count")?.parse()?;

            for _ in 0..20 {
                black_box(render_ir(black_box(&input)).map_err(|error| error.to_string())?);
            }

            let start = Instant::now();
            let mut html_bytes = 0;
            for _ in 0..iterations {
                let html = render_ir(black_box(&input)).map_err(|error| error.to_string())?;
                html_bytes = html.len();
                black_box(html);
            }
            let elapsed = start.elapsed();

            println!(
                "{{\"iterations\":{iterations},\"totalMs\":{},\"perIterationUs\":{},\"htmlBytes\":{html_bytes}}}",
                elapsed.as_secs_f64() * 1000.0,
                elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64,
            );
        }
        _ => {
            return Err("usage: farm-ui-renderer-benchmark <render|bench> ...".into());
        }
    }

    Ok(())
}
