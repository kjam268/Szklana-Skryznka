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
            if std::process::Command::new(p)
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

pub async fn run_ffprobe_json(file_path: &str) -> Result<Value, String> {
    let exe = find_ffprobe();
    let mut cmd = tokio::process::Command::new(exe);
    cmd.kill_on_drop(true);
    cmd.args([
        "-v", "error",
        "-nostdin",
        "-show_entries", "format=duration,bit_rate,size,format_name,format_long_name,tags",
        "-show_entries", "stream=index,codec_type,codec_name,codec_long_name,width,height,channels,channel_layout,bit_rate,r_frame_rate,sample_rate,tags,color_space,color_transfer,color_primaries,profile,level,disposition",
        "-of", "json",
        file_path
    ]);

    let output = tokio::time::timeout(std::time::Duration::from_secs(12), cmd.output())
        .await
        .map_err(|_| "ffprobe execution timed out after 12 seconds".to_string())?
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

pub async fn run_ffmpeg_frame_metrics(file_path: &str, timestamp: f64) -> Result<FrameMetrics, String> {
    let exe = find_ffmpeg();
    let mut cmd = tokio::process::Command::new(exe);
    cmd.kill_on_drop(true);
    cmd.args([
        "-nostdin",
        "-threads", "2",
        "-ss", &format!("{:.2}", timestamp),
        "-i", file_path,
        "-vframes", "1",
        "-vf", "blurdetect,blockdetect,metadata=print:file=-",
        "-f", "null",
        "-"
    ]);

    let output = tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output())
        .await
        .map_err(|_| "ffmpeg frame metrics timed out after 10 seconds".to_string())?
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

pub async fn run_ffmpeg_ebur128(file_path: &str) -> Result<f64, String> {
    let exe = find_ffmpeg();
    let mut cmd = tokio::process::Command::new(exe);
    cmd.kill_on_drop(true);
    cmd.args([
        "-nostdin",
        "-threads", "2",
        "-t", "10",
        "-i", file_path,
        "-filter_complex", "ebur128=peak=true",
        "-f", "null",
        "-"
    ]);

    let output = tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output())
        .await
        .map_err(|_| "ffmpeg ebur128 timed out after 15 seconds".to_string())?
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

use crate::models::{QualityIssue, Recommendation, VideoQualityScore};

/// Center compression function mapping raw scores to central range per evaluation directives
fn compress_to_center(raw: f32) -> f32 {
    let compressed = 30.0 + (raw.clamp(0.0, 100.0) * 0.40);
    (compressed * 10.0).round() / 10.0
}

fn get_qualitative_label(score: f32) -> String {
    match score as u32 {
        98..=100 => "Reference Quality".to_string(),
        95..=97 => "Excellent".to_string(),
        90..=94 => "Very Good".to_string(),
        80..=89 => "Good".to_string(),
        70..=79 => "Fair".to_string(),
        60..=69 => "Acceptable".to_string(),
        40..=59 => "Poor".to_string(),
        20..=39 => "Very Poor".to_string(),
        _ => "Critically Deficient".to_string(),
    }
}

pub async fn compute_video_quality_score(file_path: &str) -> Result<VideoQualityScore, String> {
    let metadata = run_ffprobe_json(file_path).await.unwrap_or(Value::Null);
    let mut deductions = Vec::new();
    let mut recommendations = Vec::new();

    let streams = metadata.get("streams").and_then(|s| s.as_array());
    let format_obj = metadata.get("format");
    let _bitrate = format_obj
        .and_then(|f| f.get("bit_rate"))
        .and_then(|b| b.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let video_stream = streams.and_then(|arr| arr.iter().find(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("video")));
    let audio_stream = streams.and_then(|arr| arr.iter().find(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("audio")));

    let height = video_stream.and_then(|s| s.get("height")).and_then(|v| v.as_i64()).unwrap_or(0);
    let v_codec = video_stream.and_then(|s| s.get("codec_name")).and_then(|v| v.as_str()).unwrap_or("unknown");
    let a_codec = audio_stream.and_then(|s| s.get("codec_name")).and_then(|v| v.as_str()).unwrap_or("none");
    let channels = audio_stream.and_then(|s| s.get("channels")).and_then(|v| v.as_i64()).unwrap_or(2);

    // 1. Visual Quality Score (Raw 0-100)
    let mut raw_visual = 85.0f32;
    if height >= 2160 {
        raw_visual += 10.0;
    } else if height >= 1080 {
        raw_visual += 5.0;
    } else if height < 720 && height > 0 {
        raw_visual -= 15.0;
        deductions.push(QualityIssue {
            category: "Visual".to_string(),
            description: "Sub-HD resolution (SD video content).".to_string(),
            penalty: 15.0,
        });
        recommendations.push(Recommendation {
            action: "Upscale / Replace".to_string(),
            expected_gain: 10.0,
            description: "Upgrade source file to HD/4K copy.".to_string(),
        });
    }

    // 2. Encoding Quality (Raw 0-100)
    let mut raw_encoding = 80.0f32;
    match v_codec.to_lowercase().as_str() {
        "av1" | "hevc" | "h265" => raw_encoding += 10.0,
        "h264" => raw_encoding += 5.0,
        "mpeg2video" | "mpeg4" | "msmpeg4v3" | "xvid" => {
            raw_encoding -= 20.0;
            deductions.push(QualityIssue {
                category: "Encoding".to_string(),
                description: "Legacy video codec detected.".to_string(),
                penalty: 20.0,
            });
            recommendations.push(Recommendation {
                action: "Transcode to AV1/H.264".to_string(),
                expected_gain: 15.0,
                description: "Transcode source to modern AV1 or H.264 codec.".to_string(),
            });
        }
        _ => {}
    }

    // 3. Audio Quality (Raw 0-100)
    let mut raw_audio = 80.0f32;
    if a_codec == "none" {
        raw_audio = 40.0;
        deductions.push(QualityIssue {
            category: "Audio".to_string(),
            description: "No audio stream present.".to_string(),
            penalty: 40.0,
        });
    } else if channels >= 6 {
        raw_audio += 10.0;
    }

    // 4. Container & Compatibility Quality (Raw 0-100)
    let mut raw_container = 85.0f32;
    let mut raw_compatibility = 85.0f32;
    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();
    if ext == "avi" || ext == "wmv" || ext == "flv" {
        raw_container -= 15.0;
        raw_compatibility -= 20.0;
        deductions.push(QualityIssue {
            category: "Container".to_string(),
            description: "Legacy container format (AVI/WMV/FLV).".to_string(),
            penalty: 15.0,
        });
        recommendations.push(Recommendation {
            action: "Remux to MP4/MKV".to_string(),
            expected_gain: 12.0,
            description: "Remux file container into modern MP4 or MKV format.".to_string(),
        });
    }

    // 5. Integrity & Archival (Raw 0-100)
    let raw_integrity = 90.0f32;
    let raw_archival = 80.0f32;

    let raw_overall = (raw_visual * 0.30)
        + (raw_encoding * 0.20)
        + (raw_audio * 0.20)
        + (raw_container * 0.10)
        + (raw_integrity * 0.10)
        + (raw_compatibility * 0.10);

    let overall = compress_to_center(raw_overall);
    let visual_quality = compress_to_center(raw_visual);
    let audio_quality = compress_to_center(raw_audio);
    let encoding_quality = compress_to_center(raw_encoding);
    let container_quality = compress_to_center(raw_container);
    let integrity = compress_to_center(raw_integrity);
    let compatibility = compress_to_center(raw_compatibility);
    let archival_quality = compress_to_center(raw_archival);

    let qualitative_rating = get_qualitative_label(overall);

    Ok(VideoQualityScore {
        overall,
        visual_quality,
        audio_quality,
        encoding_quality,
        container_quality,
        integrity,
        compatibility,
        archival_quality,
        confidence: 85.0,
        qualitative_rating,
        deductions,
        recommendations,
    })
}

use crate::models::{
    AudioStreamInfo, ContainerInfo, MediaFileMetadata, SubtitleStreamInfo, UniversalMediaInfo, VideoStreamInfo
};

pub struct MediaReader {
    pub file_path: String,
    pub info: UniversalMediaInfo,
}

impl MediaReader {
    pub async fn open(file_path: &str) -> Result<Self, String> {
        let info = probe_universal_media(file_path).await?;
        Ok(Self {
            file_path: file_path.to_string(),
            info,
        })
    }

    pub fn info(&self) -> &UniversalMediaInfo {
        &self.info
    }

    pub fn video_streams(&self) -> &[VideoStreamInfo] {
        &self.info.video_streams
    }

    pub fn audio_streams(&self) -> &[AudioStreamInfo] {
        &self.info.audio_streams
    }

    pub fn subtitle_streams(&self) -> &[SubtitleStreamInfo] {
        &self.info.subtitle_streams
    }
}

pub async fn extract_thumbnail_frame(file_path: &str, timestamp_sec: f64) -> Result<String, String> {
    let exe = find_ffmpeg();
    let out_dir = std::env::temp_dir().join("szklana_thumbnails");
    let _ = std::fs::create_dir_all(&out_dir);
    let out_file = out_dir.join(format!("thumb_{}.jpg", uuid::Uuid::new_v4()));

    let mut cmd = tokio::process::Command::new(exe);
    cmd.kill_on_drop(true);
    cmd.args([
        "-nostdin",
        "-threads", "2",
        "-ss", &format!("{:.2}", timestamp_sec),
        "-i", file_path,
        "-vframes", "1",
        "-q:v", "2",
        "-y",
        out_file.to_str().unwrap_or("")
    ]);

    let output = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output())
        .await
        .map_err(|_| "Thumbnail extraction timed out after 8 seconds".to_string())?
        .map_err(|e| format!("Thumbnail generation failed: {}", e))?;

    if !output.status.success() || !out_file.exists() {
        return Err("Failed to extract frame thumbnail via FFmpeg".to_string());
    }

    Ok(out_file.to_string_lossy().to_string())
}

pub async fn probe_universal_media(file_path: &str) -> Result<UniversalMediaInfo, String> {
    let raw_meta = run_ffprobe_json(file_path).await?;

    let format_obj = raw_meta.get("format");
    let streams_arr = raw_meta.get("streams").and_then(|s| s.as_array());

    let format_name = format_obj
        .and_then(|f| f.get("format_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let format_long_name = format_obj
        .and_then(|f| f.get("format_long_name"))
        .and_then(|v| v.as_str())
        .unwrap_or(&format_name)
        .to_string();
    let duration_sec = format_obj
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let size_bytes = format_obj
        .and_then(|f| f.get("size"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let bitrate = format_obj
        .and_then(|f| f.get("bit_rate"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let container = ContainerInfo {
        format_name,
        format_long_name,
        duration_sec,
        size_bytes,
        bitrate,
        start_time: 0.0,
    };

    let mut video_streams = Vec::new();
    let mut audio_streams = Vec::new();
    let mut subtitle_streams = Vec::new();
    let mut subtitle_counter: usize = 0;

    if let Some(arr) = streams_arr {
        for (idx, stream) in arr.iter().enumerate() {
            let codec_type = stream.get("codec_type").and_then(|c| c.as_str()).unwrap_or("");
            let codec_name = stream.get("codec_name").and_then(|c| c.as_str()).unwrap_or("unknown").to_string();
            let codec_long_name = stream.get("codec_long_name").and_then(|c| c.as_str()).unwrap_or(&codec_name).to_string();
            let stream_index = stream.get("index").and_then(|i| i.as_u64()).unwrap_or(idx as u64) as usize;
            let disposition = stream.get("disposition");
            let is_stream_default = disposition.and_then(|d| d.get("default")).and_then(|v| v.as_i64()).unwrap_or(0) == 1;
            let is_stream_forced = disposition.and_then(|d| d.get("forced")).and_then(|v| v.as_i64()).unwrap_or(0) == 1;
            let stream_title = stream.get("tags").and_then(|t| t.get("title")).and_then(|v| v.as_str()).map(|s| s.to_string());

            match codec_type {
                "video" => {
                    let width = stream.get("width").and_then(|w| w.as_u64()).unwrap_or(0) as u32;
                    let height = stream.get("height").and_then(|h| h.as_u64()).unwrap_or(0) as u32;
                    let profile = stream.get("profile").and_then(|p| p.as_str()).unwrap_or("Main").to_string();
                    let level = stream.get("level").and_then(|l| l.as_i64()).unwrap_or(0);
                    let color_transfer = stream.get("color_transfer").and_then(|c| c.as_str()).unwrap_or("bt709").to_string();
                    let is_hdr = color_transfer.contains("smpte2084") || color_transfer.contains("arib-std-b67");

                    video_streams.push(VideoStreamInfo {
                        index: stream_index,
                        codec_name,
                        codec_long_name,
                        profile,
                        level,
                        width,
                        height,
                        bit_depth: 8,
                        frame_rate: 24.0,
                        color_space: stream.get("color_space").and_then(|c| c.as_str()).unwrap_or("bt709").to_string(),
                        color_transfer,
                        color_primaries: stream.get("color_primaries").and_then(|c| c.as_str()).unwrap_or("bt709").to_string(),
                        is_hdr,
                    });
                }
                "audio" => {
                    let sample_rate = stream.get("sample_rate").and_then(|s| s.as_str()).and_then(|s| s.parse::<u32>().ok()).unwrap_or(44100);
                    let channels = stream.get("channels").and_then(|c| c.as_u64()).unwrap_or(2) as u32;
                    let lang = stream.get("tags").and_then(|t| t.get("language")).and_then(|l| l.as_str()).unwrap_or("und").to_string();
                    let channel_layout = stream.get("channel_layout").and_then(|c| c.as_str()).unwrap_or("").to_string();
                    let real_layout = if !channel_layout.is_empty() {
                        channel_layout
                    } else if channels >= 8 {
                        "7.1".to_string()
                    } else if channels >= 6 {
                        "5.1".to_string()
                    } else if channels == 1 {
                        "Mono".to_string()
                    } else {
                        "Stereo".to_string()
                    };
                    let stream_bitrate = stream.get("bit_rate").and_then(|b| b.as_str()).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);

                    audio_streams.push(AudioStreamInfo {
                        index: stream_index,
                        codec_name,
                        codec_long_name,
                        sample_rate,
                        channels,
                        channel_layout: real_layout,
                        language: lang,
                        bitrate: stream_bitrate,
                        title: stream_title,
                        is_default: is_stream_default,
                    });
                }
                "subtitle" => {
                    let lang = stream.get("tags").and_then(|t| t.get("language")).and_then(|l| l.as_str()).unwrap_or("und").to_string();
                    subtitle_streams.push(SubtitleStreamInfo {
                        index: stream_index,
                        subtitle_stream_index: subtitle_counter,
                        codec_name,
                        language: lang,
                        title: stream_title,
                        is_default: is_stream_default,
                        is_forced: is_stream_forced,
                    });
                    subtitle_counter += 1;
                }
                _ => {}
            }
        }
    }

    let title = format_obj.and_then(|f| f.get("tags")).and_then(|t| t.get("title")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let encoder = format_obj.and_then(|f| f.get("tags")).and_then(|t| t.get("encoder")).and_then(|v| v.as_str()).map(|s| s.to_string());

    let metadata = MediaFileMetadata {
        title,
        encoder,
        creation_time: None,
        writing_library: None,
        custom_tags: std::collections::HashMap::new(),
    };

    Ok(UniversalMediaInfo {
        file_path: file_path.to_string(),
        container,
        video_streams,
        audio_streams,
        subtitle_streams,
        metadata,
        is_valid: true,
    })
}
