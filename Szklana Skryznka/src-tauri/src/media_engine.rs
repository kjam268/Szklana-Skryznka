use std::process::Command;
use serde_json::Value;

pub fn find_ffprobe() -> &'static str {
    let alt_paths = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"];
    for p in alt_paths {
        if std::path::Path::new(p).exists() {
            return p;
        }
    }
    "ffprobe"
}

pub fn find_ffmpeg() -> &'static str {
    let alt_paths = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "ffmpeg"];
    for p in alt_paths {
        if std::path::Path::new(p).exists() || p == "ffmpeg" {
            if Command::new(p)
                .arg("-version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok()
            {
                return p;
            }
        }
    }
    "ffmpeg"
}

pub struct FrameMetrics {
    pub blur: f64,
    pub block: f64,
}

pub fn run_ffprobe_json(file_path: &str) -> Result<Value, String> {
    let exe = find_ffprobe();
    let output = Command::new(exe)
        .args([
            "-v", "error",
            "-show_entries", "format=duration,bit_rate",
            "-show_entries", "stream=codec_type,codec_name,width,height,channels,r_frame_rate,tags",
            "-of", "json",
            file_path
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        return Err(format!("ffprobe exited with error: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let json_str = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 from ffprobe: {}", e))?;

    let parsed = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ffprobe JSON: {}", e))?;

    Ok(parsed)
}

pub fn run_ffmpeg_frame_metrics(file_path: &str, timestamp: f64) -> Result<FrameMetrics, String> {
    let exe = find_ffmpeg();
    let output = Command::new(exe)
        .args([
            "-ss", &format!("{:.2}", timestamp),
            "-i", file_path,
            "-vframes", "1",
            "-vf", "blurdetect,blockdetect,metadata=print:file=-",
            "-f", "null",
            "-"
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        return Err(format!("ffmpeg exited with error: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let stderr_str = String::from_utf8_lossy(&output.stderr);
    let stdout_str = String::from_utf8_lossy(&output.stdout);

    // Parse the output for blurdetect and blockdetect metadata printed to stdout/stderr
    let mut blur = 0.0;
    let mut block = 0.0;

    for line in stdout_str.lines().chain(stderr_str.lines()) {
        if line.contains("lavfi.blur=") {
            if let Some(val_str) = line.split('=').last() {
                if let Ok(v) = val_str.trim().parse::<f64>() {
                    blur = v;
                }
            }
        }
        if line.contains("lavfi.block=") {
            if let Some(val_str) = line.split('=').last() {
                if let Ok(v) = val_str.trim().parse::<f64>() {
                    block = v;
                }
            }
        }
    }

    Ok(FrameMetrics { blur, block })
}

pub fn run_ffmpeg_ebur128(file_path: &str) -> Result<f64, String> {
    let exe = find_ffmpeg();
    let output = Command::new(exe)
        .args([
            "-t", "10",
            "-i", file_path,
            "-filter_complex", "ebur128=peak=true",
            "-f", "null",
            "-"
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg ebur128: {}", e))?;
    
    let stderr_str = String::from_utf8_lossy(&output.stderr);
    let mut loudness = -23.0; // standard default
    for line in stderr_str.lines() {
        if line.contains("I:") && line.contains("LUFS") {
            if let Some(val_str) = line.split("I:").last() {
                let clean_val = val_str.replace("LUFS", "").trim().to_string();
                if let Ok(v) = clean_val.parse::<f64>() {
                    loudness = v;
                }
            }
        }
    }
    Ok(loudness)
}
