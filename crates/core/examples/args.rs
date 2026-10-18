use mikan_core::*;
use std::path::Path;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let o = Options { format: a[3].clone(), ..Default::default() };
    for x in build_args(Path::new(&a[1]), Path::new(&a[2]), &o).unwrap() { println!("{x}"); }
}
