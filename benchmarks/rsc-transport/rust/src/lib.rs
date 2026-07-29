use std::fmt::Write;

const HEADING: u8 = 1;
const PARAGRAPH: u8 = 2;
const CODE: u8 = 3;
const CALLOUT: u8 = 4;
const LIST: u8 = 5;

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], &'static str> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or("IR offset overflow")?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or("truncated Farm UI IR payload")?;
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, &'static str> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32, &'static str> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| "invalid u32 in Farm UI IR payload")?;
        Ok(u32::from_le_bytes(bytes))
    }

    fn string(&mut self) -> Result<&'a str, &'static str> {
        let length = self.u32()? as usize;
        std::str::from_utf8(self.take(length)?).map_err(|_| "invalid UTF-8 in Farm UI IR payload")
    }
}

fn escape_html(output: &mut String, input: &str) {
    for character in input.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            _ => output.push(character),
        }
    }
}

fn next_character_end(input: &str, offset: usize) -> usize {
    offset
        + input[offset..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1)
}

fn render_inline(output: &mut String, input: &str) {
    let mut offset = 0;

    while offset < input.len() {
        if input[offset..].starts_with("**")
            && let Some(relative_end) = input[offset + 2..].find("**")
        {
            let end = offset + 2 + relative_end;
            output.push_str("<strong>");
            escape_html(output, &input[offset + 2..end]);
            output.push_str("</strong>");
            offset = end + 2;
            continue;
        }

        if input[offset..].starts_with('`')
            && let Some(relative_end) = input[offset + 1..].find('`')
        {
            let end = offset + 1 + relative_end;
            output.push_str("<code>");
            escape_html(output, &input[offset + 1..end]);
            output.push_str("</code>");
            offset = end + 1;
            continue;
        }

        if input[offset..].starts_with('[')
            && let Some(relative_label_end) = input[offset + 1..].find("](")
        {
            let label_end = offset + 1 + relative_label_end;
            let href_start = label_end + 2;
            if let Some(relative_href_end) = input[href_start..].find(')') {
                let href_end = href_start + relative_href_end;
                output.push_str("<a href=\"");
                escape_html(output, &input[href_start..href_end]);
                output.push_str("\">");
                escape_html(output, &input[offset + 1..label_end]);
                output.push_str("</a>");
                offset = href_end + 1;
                continue;
            }
        }

        let mut end = next_character_end(input, offset);
        while end < input.len()
            && !input[end..].starts_with("**")
            && !input[end..].starts_with('`')
            && !input[end..].starts_with('[')
        {
            end = next_character_end(input, end);
        }
        escape_html(output, &input[offset..end]);
        offset = end;
    }
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_' || byte == b'$'
}

fn is_identifier_part(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}

fn is_keyword(token: &str) -> bool {
    matches!(
        token,
        "async" | "await" | "const" | "export" | "function" | "return"
    )
}

fn render_code_token(output: &mut String, kind: Option<&str>, token: &str) {
    if let Some(kind) = kind {
        let _ = write!(output, "<span class=\"tok-{kind}\">");
        escape_html(output, token);
        output.push_str("</span>");
    } else {
        escape_html(output, token);
    }
}

fn render_code(output: &mut String, source: &str) {
    let bytes = source.as_bytes();
    let mut offset = 0;

    while offset < bytes.len() {
        if bytes[offset..].starts_with(b"//") {
            let end = bytes[offset..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|relative| offset + relative)
                .unwrap_or(bytes.len());
            render_code_token(output, Some("comment"), &source[offset..end]);
            offset = end;
            continue;
        }

        if bytes[offset].is_ascii_whitespace() {
            let mut end = offset + 1;
            while end < bytes.len() && bytes[end].is_ascii_whitespace() {
                end += 1;
            }
            render_code_token(output, None, &source[offset..end]);
            offset = end;
            continue;
        }

        if matches!(bytes[offset], b'"' | b'\'' | b'`') {
            let quote = bytes[offset];
            let mut end = offset + 1;
            while end < bytes.len() {
                let next = bytes[end];
                if next == b'\\' {
                    end = (end + 2).min(bytes.len());
                    continue;
                }
                end += 1;
                if next == quote {
                    break;
                }
            }
            render_code_token(output, Some("string"), &source[offset..end]);
            offset = end;
            continue;
        }

        if is_identifier_start(bytes[offset]) {
            let mut end = offset + 1;
            while end < bytes.len() && is_identifier_part(bytes[end]) {
                end += 1;
            }
            let token = &source[offset..end];
            render_code_token(
                output,
                Some(if is_keyword(token) {
                    "keyword"
                } else {
                    "identifier"
                }),
                token,
            );
            offset = end;
            continue;
        }

        if bytes[offset].is_ascii_digit() {
            let mut end = offset + 1;
            while end < bytes.len() && (bytes[end].is_ascii_digit() || bytes[end] == b'.') {
                end += 1;
            }
            render_code_token(output, Some("number"), &source[offset..end]);
            offset = end;
            continue;
        }

        let end = next_character_end(source, offset);
        render_code_token(output, None, &source[offset..end]);
        offset = end;
    }
}

pub fn render_ir(bytes: &[u8]) -> Result<String, &'static str> {
    let mut cursor = Cursor::new(bytes);
    if cursor.take(4)? != b"FUI1" {
        return Err("unsupported Farm UI IR magic");
    }

    let block_count = cursor.u32()?;
    let mut output = String::with_capacity(bytes.len() * 3);
    output.push_str("<article class=\"benchmark-article\" data-fixture=\"transport-v1\">");

    for _ in 0..block_count {
        match cursor.u8()? {
            HEADING => {
                let level = cursor.u8()?;
                let text = cursor.string()?;
                let _ = write!(output, "<h{level}>");
                escape_html(&mut output, text);
                let _ = write!(output, "</h{level}>");
            }
            PARAGRAPH => {
                output.push_str("<p>");
                render_inline(&mut output, cursor.string()?);
                output.push_str("</p>");
            }
            CODE => {
                let language = cursor.string()?;
                let source = cursor.string()?;
                output.push_str("<pre data-language=\"");
                escape_html(&mut output, language);
                output.push_str("\"><code>");
                render_code(&mut output, source);
                output.push_str("</code></pre>");
            }
            CALLOUT => {
                let tone = cursor.u8()?;
                let title = cursor.string()?;
                let body = cursor.string()?;
                let _ = write!(output, "<aside class=\"callout tone-{tone}\"><strong>");
                escape_html(&mut output, title);
                output.push_str("</strong><p>");
                render_inline(&mut output, body);
                output.push_str("</p></aside>");
            }
            LIST => {
                let item_count = cursor.u32()?;
                output.push_str("<ul>");
                for _ in 0..item_count {
                    output.push_str("<li>");
                    render_inline(&mut output, cursor.string()?);
                    output.push_str("</li>");
                }
                output.push_str("</ul>");
            }
            _ => return Err("unsupported Farm UI IR block tag"),
        }
    }

    if cursor.offset != bytes.len() {
        return Err("Farm UI IR payload contains trailing bytes");
    }

    output.push_str("</article>");
    Ok(output)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::render_ir;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static OUTPUT_LENGTH: AtomicUsize = AtomicUsize::new(0);

    #[unsafe(no_mangle)]
    pub extern "C" fn alloc(length: usize) -> *mut u8 {
        let mut bytes = vec![0_u8; length].into_boxed_slice();
        let pointer = bytes.as_mut_ptr();
        std::mem::forget(bytes);
        pointer
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn dealloc(pointer: *mut u8, length: usize) {
        if !pointer.is_null() {
            // SAFETY: callers pass a pointer and length returned by alloc or render.
            unsafe {
                drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                    pointer, length,
                )));
            }
        }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn render(pointer: *const u8, length: usize) -> *mut u8 {
        if pointer.is_null() {
            OUTPUT_LENGTH.store(0, Ordering::Relaxed);
            return std::ptr::null_mut();
        }

        // SAFETY: the caller allocated and initialized this range in Wasm linear memory.
        let input = unsafe { std::slice::from_raw_parts(pointer, length) };
        let rendered = match render_ir(input) {
            Ok(value) => value.into_bytes(),
            Err(_) => {
                OUTPUT_LENGTH.store(0, Ordering::Relaxed);
                return std::ptr::null_mut();
            }
        };
        let mut output = rendered.into_boxed_slice();
        let output_pointer = output.as_mut_ptr();
        OUTPUT_LENGTH.store(output.len(), Ordering::Relaxed);
        std::mem::forget(output);
        output_pointer
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn output_length() -> usize {
        OUTPUT_LENGTH.load(Ordering::Relaxed)
    }
}
