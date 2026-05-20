use std::fs;
use std::io::Read;

/// Extract readable text from EPUB file
pub fn parse_epub(file_path: &str) -> Option<String> {
    let file = fs::File::open(file_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut parts: Vec<String> = Vec::new();

    for i in 0..archive.len() {
        let entry = archive.by_index(i).ok();
        if let Some(mut e) = entry {
            let name = e.name().to_lowercase();
            if name.ends_with(".html") || name.ends_with(".xhtml") || name.ends_with(".htm") {
                let mut text = String::new();
                if e.read_to_string(&mut text).is_ok() {
                    let cleaned = text
                        .replace(|c: char| c == '\r', "")
                        .split('\n')
                        .map(|line| {
                            line.replace(
                                |c: char| matches!(c, '<'..='>' | '&'),
                                "",
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ");

                    // Simple HTML tag removal
                    let cleaned = cleaned
                        .replace("&nbsp;", " ")
                        .replace("&lt;", "<")
                        .replace("&gt;", ">")
                        .replace("&amp;", "&")
                        .replace("&quot;", "\"");

                    if cleaned.len() > 100 {
                        parts.push(cleaned);
                    }
                }
            }
        }
    }

    if parts.is_empty() { None } else { Some(parts.join("\n\n")) }
}
