use flate2::read::ZlibDecoder;
use std::fs;
use std::io::Read;

/// Extract text from PDF file. Returns None on failure.
pub fn extract_pdf_text(file_path: &str) -> Option<String> {
    let buf = fs::read(file_path).ok()?;
    let content = String::from_utf8_lossy(&buf);
    let mut results: Vec<String> = Vec::new();

    let mut pos = 0;
    while let Some(start) = content[pos..].find(" obj") {
        let obj_start = pos + start + 4;
        let stream_kw = content[obj_start..].find("stream\r\n")
            .or_else(|| content[obj_start..].find("stream\n"))?;
        let data_start = obj_start + stream_kw
            + if content[obj_start + stream_kw..].starts_with("stream\r\n") { 8 } else { 7 };
        let end_stream = content[data_start..].find("endstream")?;
        let raw = &buf[data_start..data_start + end_stream];

        // Try FlateDecode
        let mut decompressed_data = Vec::new();
        let decompressed: Option<Vec<u8>> = if ZlibDecoder::new(raw).read_to_end(&mut decompressed_data).is_ok() && !decompressed_data.is_empty() {
            Some(decompressed_data)
        } else {
            // Try without zlib header
            let mut d = Vec::new();
            match ZlibDecoder::new_with_decompress(raw, flate2::Decompress::new(true)).read_to_end(&mut d) {
                Ok(_) if !d.is_empty() => Some(d),
                _ => None,
            }
        };

        let text = if let Some(ref data) = decompressed {
            String::from_utf8_lossy(data).to_string()
        } else {
            String::from_utf8_lossy(raw).to_string()
        };

        // Extract text from BT/ET blocks
        let mut bt_pos = 0usize;
        while let Some(bt) = text[bt_pos..].find("BT") {
            let bt_start = bt_pos + bt + 2;
            let et_pos = text[bt_start..].find("ET").unwrap_or(text[bt_start..].len());
            let block = &text[bt_start..bt_start + et_pos];

            let mut extracted = String::new();

            // Tj operator: (string) Tj
            for cap in block.match_indices("Tj") {
                let before = &block[..cap.0];
                if let Some(paren) = before.rfind('(') {
                    if let Some(end) = block[paren..].find(')') {
                        let t = &block[paren + 1..paren + end];
                        if t.len() > 1 {
                            extracted.push_str(&unescape_pdf(t));
                            extracted.push('\n');
                        }
                    }
                }
            }

            // TJ operator: [(str) num (str) ...] TJ
            for cap in block.match_indices("TJ") {
                let before = &block[..cap.0];
                if let Some(bracket) = before.rfind('[') {
                    let seg = &block[bracket..cap.0];
                    for p in seg.split('(').skip(1) {
                        if let Some(end) = p.find(')') {
                            let t = &p[..end];
                            if t.len() > 1 {
                                extracted.push_str(&unescape_pdf(t));
                            }
                        }
                    }
                    if !extracted.ends_with('\n') {
                        extracted.push('\n');
                    }
                }
            }

            if !extracted.trim().is_empty() {
                results.push(extracted);
            }
            bt_pos = bt_start + et_pos + 2;
        }
        pos = data_start + end_stream + 9;
    }

    // Filter unreadable streams
    let readable: Vec<&str> = results.iter()
        .map(|s| s.as_str())
        .filter(|t| {
            let chars = t.chars().count();
            if chars == 0 { return false; }
            let cjk = t.chars().filter(|c| c >= &'\u{4E00}' && c <= &'\u{9FFF}').count();
            let alpha = t.chars().filter(|c| c.is_alphabetic()).count();
            let ratio = (cjk + alpha) as f64 / chars as f64;
            ratio > 0.1
        })
        .collect();

    if readable.is_empty() { None } else { Some(readable.join("\n\n")) }
}

fn unescape_pdf(s: &str) -> String {
    s.replace("\\n", "\n")
        .replace("\\r", "\r")
        .replace("\\t", "\t")
        .replace("\\(", "(")
        .replace("\\)", ")")
        .replace("\\\\", "\\")
}
