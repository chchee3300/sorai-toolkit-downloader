//! `yt-dlp -j` metadata parsing: format classification, preview URL and
//! best-quality defaults. Ported 1:1 from the Neutralino-era src/lib/ytdlp.js
//! (parseMetadataJson / pickPreviewUrl / best*FormatId) -- keep the rules in
//! sync with the comments there if they ever change.

use serde::Serialize;
use serde_json::Value;

/// One JSON call gets title/thumbnail/duration/formats together.
/// --no-playlist: playlist URLs are "first video only" (v1 limitation).
/// `--` ends option parsing so a pasted "URL" can never become a yt-dlp flag.
pub fn metadata_args(url: &str) -> Vec<String> {
  ["-j", "--no-playlist", "--", url].map(String::from).to_vec()
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Format {
  pub format_id: String,
  pub ext: String,
  pub height: Option<f64>,
  pub abr: Option<f64>,
  pub vcodec: Option<String>,
  pub acodec: Option<String>,
  pub filesize: Option<f64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
  pub title: String,
  pub thumbnail: Option<String>,
  pub duration: Option<f64>,
  pub channel: Option<String>,
  pub video_formats: Vec<Format>,
  pub audio_formats: Vec<Format>,
  pub combined_formats: Vec<Format>,
  pub preview_url: Option<String>,
  // Default picks ("" when the list is empty, same as the old JS).
  pub best_video_format_id: String,
  pub best_audio_format_id: String,
  pub best_combined_format_id: String,
}

// JS truthiness helpers for the loosely-typed yt-dlp JSON.
fn s(v: &Value, k: &str) -> Option<String> {
  v.get(k).and_then(Value::as_str).filter(|x| !x.is_empty()).map(String::from)
}
fn n(v: &Value, k: &str) -> Option<f64> {
  v.get(k).and_then(Value::as_f64)
}
fn nz(v: &Value, k: &str) -> Option<f64> {
  n(v, k).filter(|x| *x != 0.0)
}

// A stream is absent ONLY when yt-dlp explicitly says 'none'; a missing
// field means "unknown, assume present" (Twitch never sets vcodec/acodec,
// Twitter's HLS audio sets vcodec:'none' but omits acodec).
fn is_none(c: &Option<String>) -> bool {
  c.as_deref() == Some("none")
}
fn has_video(f: &Format) -> bool {
  !is_none(&f.vcodec)
}
fn has_audio(f: &Format) -> bool {
  !is_none(&f.acodec)
}

fn keep(f: &Format) -> bool {
  let storyboard = (is_none(&f.vcodec) && is_none(&f.acodec)) || f.ext == "mhtml";
  // webm excluded by product decision; Twitch "portrait-<h>" is a vertical
  // duplicate of the same tier.
  let portrait = f.format_id.to_ascii_lowercase().starts_with("portrait-");
  !storyboard && f.ext != "webm" && !portrait
}

/// One progressive http(s) stream with explicit video+audio codecs for
/// ClipModal's <video>; prefers mp4 nearest 480p, then other mp4, then any.
pub fn pick_preview_url(raw: &[Value]) -> Option<String> {
  let mut c: Vec<&Value> = raw
    .iter()
    .filter(|f| {
      let url = s(f, "url").unwrap_or_default().to_ascii_lowercase();
      let codec_ok = |k| s(f, k).is_some_and(|c| c != "none");
      (url.starts_with("http://") || url.starts_with("https://"))
        && codec_ok("vcodec")
        && codec_ok("acodec")
        && s(f, "ext").as_deref() != Some("mhtml")
        && matches!(s(f, "protocol").as_deref(), Some("https" | "http"))
    })
    .collect();
  let tier = |f: &Value| match (s(f, "ext").as_deref(), n(f, "height")) {
    (Some("mp4"), Some(_)) => 0,
    (Some("mp4"), None) => 1,
    _ => 2,
  };
  let h = |f: &Value| nz(f, "height").unwrap_or(0.0);
  c.sort_by(|a, b| {
    tier(a).cmp(&tier(b)).then_with(|| {
      if tier(a) == 0 {
        (h(a) - 480.0).abs().total_cmp(&(h(b) - 480.0).abs())
      } else {
        h(a).total_cmp(&h(b))
      }
    })
  });
  c.first().and_then(|f| s(f, "url"))
}

// Highest `key` first, filesize as tiebreaker; stable, like Array.sort.
fn best(list: &[Format], key: fn(&Format) -> Option<f64>) -> String {
  let mut v: Vec<&Format> = list.iter().collect();
  let z = |o: Option<f64>| o.unwrap_or(0.0);
  v.sort_by(|a, b| z(key(b)).total_cmp(&z(key(a))).then(z(b.filesize).total_cmp(&z(a.filesize))));
  v.first().map(|f| f.format_id.clone()).unwrap_or_default()
}

pub fn parse_metadata_json(text: &str) -> Result<Metadata, String> {
  let data: Value = serde_json::from_str(text.trim()).map_err(|e| format!("Invalid yt-dlp JSON: {e}"))?;
  let raw = data.get("formats").and_then(Value::as_array).cloned().unwrap_or_default();
  let mapped: Vec<Format> = raw
    .iter()
    .filter_map(|f| {
      Some(Format {
        format_id: s(f, "format_id")?,
        ext: s(f, "ext").unwrap_or_default(),
        height: n(f, "height"),
        abr: n(f, "abr").or_else(|| n(f, "tbr")),
        vcodec: f.get("vcodec").and_then(Value::as_str).map(String::from),
        acodec: f.get("acodec").and_then(Value::as_str).map(String::from),
        filesize: nz(f, "filesize").or_else(|| nz(f, "filesize_approx")),
      })
    })
    .filter(keep)
    .collect();
  let pick = |p: fn(&Format) -> bool| mapped.iter().filter(|f| p(f)).cloned().collect::<Vec<_>>();
  let video_formats = pick(|f| has_video(f) && !has_audio(f));
  let audio_formats = pick(|f| has_audio(f) && !has_video(f));
  let combined_formats = pick(|f| has_video(f) && has_audio(f));
  Ok(Metadata {
    title: s(&data, "title").unwrap_or_else(|| "Untitled".into()),
    thumbnail: s(&data, "thumbnail"),
    duration: n(&data, "duration"),
    channel: s(&data, "channel").or_else(|| s(&data, "uploader")),
    best_video_format_id: best(&video_formats, |f| f.height),
    best_audio_format_id: best(&audio_formats, |f| f.abr),
    best_combined_format_id: best(&combined_formats, |f| f.height),
    preview_url: pick_preview_url(&raw),
    video_formats,
    audio_formats,
    combined_formats,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn ids(v: &[Format]) -> Vec<&str> {
    v.iter().map(|f| f.format_id.as_str()).collect()
  }
  fn fixture(name: &str) -> Metadata {
    let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    parse_metadata_json(&std::fs::read_to_string(path).unwrap()).unwrap()
  }

  // Expected values were produced by running the old JS parseMetadataJson
  // on the same fixtures (parity check).
  #[test]
  fn youtube_splits_streams_and_drops_webm() {
    let m = fixture("youtube");
    assert_eq!(m.title, "Me at the zoo");
    assert_eq!(m.channel.as_deref(), Some("jawed"));
    assert_eq!(m.duration, Some(19.0));
    assert!(m.thumbnail.unwrap().starts_with("https://"));
    assert_eq!(ids(&m.video_formats), ["269", "160", "602", "603", "229", "230", "134", "133", "604", "395"]);
    // 233/234: HLS audio with vcodec 'none' and no acodec key -> audio-only.
    assert_eq!(ids(&m.audio_formats), ["233", "234", "139-drc", "139", "140-drc", "140"]);
    assert!(m.combined_formats.is_empty());
    assert_eq!(m.best_video_format_id, "133");
    assert_eq!(m.best_audio_format_id, "140");
    assert_eq!(m.best_combined_format_id, "");
    assert_eq!(m.preview_url, None);
  }

  #[test]
  fn twitch_formats_without_codec_fields_are_combined_minus_portrait() {
    let m = fixture("twitch");
    assert_eq!(m.channel.as_deref(), Some("some_streamer")); // uploader fallback
    assert!(m.video_formats.is_empty() && m.audio_formats.is_empty());
    assert_eq!(ids(&m.combined_formats), ["360", "720", "1080"]);
    assert_eq!(m.best_combined_format_id, "1080");
    assert_eq!(m.best_video_format_id, "");
    assert_eq!(m.preview_url, None); // HLS only
  }

  #[test]
  fn twitter_mixes_split_and_combined() {
    let m = fixture("twitter");
    assert_eq!(ids(&m.video_formats), ["hls-256", "hls-2176"]);
    assert_eq!(ids(&m.audio_formats), ["hls-audio-32000-Audio", "hls-audio-128000-Audio"]);
    assert_eq!(ids(&m.combined_formats), ["http-256", "http-2176"]);
    assert_eq!(m.best_video_format_id, "hls-2176");
    assert_eq!(m.best_audio_format_id, "hls-audio-128000-Audio"); // abr falls back to tbr
    assert_eq!(m.best_combined_format_id, "http-2176");
    assert_eq!(m.preview_url, None); // http-* lack explicit codecs
  }

  #[test]
  fn storyboards_mhtml_and_missing_ids_are_dropped() {
    let m = parse_metadata_json(
      r#"{"formats":[
        {"format_id":"sb0","ext":"mhtml","vcodec":"none","acodec":"none"},
        {"format_id":"x","ext":"mp4","vcodec":"none","acodec":"none"},
        {"ext":"mp4","vcodec":"avc1"},
        {"format_id":"18","ext":"mp4","vcodec":"avc1","acodec":"mp4a","height":360}
      ]}"#,
    )
    .unwrap();
    assert_eq!(m.title, "Untitled");
    assert_eq!(ids(&m.combined_formats), ["18"]);
    assert!(m.video_formats.is_empty() && m.audio_formats.is_empty());
  }

  #[test]
  fn preview_prefers_mp4_nearest_480p_over_others() {
    let f = |id: &str, ext: &str, h: Option<u32>, proto: &str| {
      serde_json::json!({"format_id": id, "ext": ext, "height": h, "vcodec": "avc1", "acodec": "mp4a",
        "protocol": proto, "url": format!("https://cdn/{id}")})
    };
    let raw = vec![
      f("webm480", "webm", Some(480), "https"),
      f("mp4-1080", "mp4", Some(1080), "https"),
      f("mp4-360", "mp4", Some(360), "https"),
      f("hls-480", "mp4", Some(480), "m3u8_native"),
      f("mp4-nohe", "mp4", None, "https"),
    ];
    assert_eq!(pick_preview_url(&raw).as_deref(), Some("https://cdn/mp4-360"));
    assert_eq!(pick_preview_url(&raw[..1]).as_deref(), Some("https://cdn/webm480"));
    assert_eq!(pick_preview_url(&[raw[0].clone(), raw[4].clone()]).as_deref(), Some("https://cdn/mp4-nohe"));
    assert_eq!(pick_preview_url(&raw[3..4]), None);
  }

  #[test]
  fn best_uses_filesize_as_tiebreaker() {
    let m = parse_metadata_json(
      r#"{"formats":[
        {"format_id":"a","ext":"mp4","vcodec":"avc1","acodec":"none","height":720,"filesize":10},
        {"format_id":"b","ext":"mp4","vcodec":"avc1","acodec":"none","height":720,"filesize_approx":20},
        {"format_id":"c","ext":"mp4","vcodec":"avc1","acodec":"none","height":480,"filesize":99}
      ]}"#,
    )
    .unwrap();
    assert_eq!(m.best_video_format_id, "b");
  }

  #[test]
  fn invalid_json_is_an_error() {
    assert!(parse_metadata_json("ERROR: nope").is_err());
  }

  #[test]
  fn url_cannot_be_read_as_a_flag() {
    assert_eq!(metadata_args("--exec calc"), ["-j", "--no-playlist", "--", "--exec calc"]);
  }
}
