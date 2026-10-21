//! yt-dlp download: format selector, argv and --progress-template parsing.
//! Ported from the Neutralino-era src/lib/ytdlp.js (buildFormatSelector /
//! buildDownloadCommand / parseDownloadProgress).

use serde::{Deserialize, Serialize};

/// One queue item's download settings, straight from useDownloader's item.
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadJob {
  pub url: String,
  pub output_dir: String,
  /// "combined": one already-muxed format id (Twitch); anything else = split.
  pub mode: String,
  pub video_format_id: String,
  pub audio_format_id: String,
  pub combined_format_id: String,
  pub include_video: bool,
  pub include_audio: bool,
  pub auto_merge: bool,
  pub clip_start: Option<f64>,
  pub clip_end: Option<f64>,
}

impl DownloadJob {
  fn combined(&self) -> bool {
    self.mode == "combined"
  }
  fn both(&self) -> bool {
    !self.combined() && self.include_video && self.include_audio
  }
}

/// yt-dlp -f selector: "v+a" merges (ffmpeg muxes), "v,a" downloads both as
/// separate files, otherwise a single id.
pub fn format_selector(job: &DownloadJob) -> String {
  let (v, a) = (&job.video_format_id, &job.audio_format_id);
  match () {
    _ if job.combined() => job.combined_format_id.clone(),
    _ if job.both() => format!("{v}{}{a}", if job.auto_merge { "+" } else { "," }),
    _ if job.include_video => v.clone(),
    _ if job.include_audio => a.clone(),
    _ => String::new(),
  }
}

const PROGRESS_PREFIX: &str = "DLPROGRESS|";

/// Fixed prefix + `|`-separated fields so parsing never depends on yt-dlp's
/// human-readable progress bar. --no-colors keeps the fields ANSI-free.
pub fn progress_template() -> String {
  format!("download:{PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s")
}

/// argv for the yt-dlp sidecar (no shell: paths need no quoting).
/// `ffmpeg` is the ffmpeg sidecar's path, for merging and clip cuts.
pub fn download_args(job: &DownloadJob, ffmpeg: &str) -> Result<Vec<String>, String> {
  let sel = format_selector(job);
  // An empty side ("137+") is as unusable as no selector at all.
  if sel.is_empty() || sel.starts_with(['+', ',']) || sel.ends_with(['+', ',']) {
    return Err("no format selected".into());
  }
  if job.output_dir.is_empty() {
    return Err("no output folder".into());
  }
  let mut a: Vec<String> = vec!["-f".into(), sel, "--no-playlist".into(), "--ffmpeg-location".into(), ffmpeg.into()];
  // yt-dlp's own merge container depends on the sources and often lands on mkv.
  if job.both() && job.auto_merge {
    a.extend(["--merge-output-format".into(), "mp4".into()]);
  }
  if let (Some(s), Some(e)) = (job.clip_start, job.clip_end) {
    if e > s {
      // Re-encode around the cuts so the range lands on exact seconds, not
      // the nearest keyframe -- ClipModal's length tolerance depends on it.
      a.extend(["--download-sections".into(), format!("*{s:.2}-{e:.2}"), "--force-keyframes-at-cuts".into()]);
    }
  }
  a.extend(["-P".into(), job.output_dir.clone()]);
  // "v,a": two outputs with the same title -- format id keeps them apart.
  if job.both() && !job.auto_merge {
    a.extend(["-o".into(), "%(title)s [%(format_id)s].%(ext)s".into()]);
  }
  a.extend(["--newline".into(), "--no-colors".into(), "--progress-template".into(), progress_template()]);
  // `--` so the URL can never be read as a flag.
  a.extend(["--".into(), job.url.clone()]);
  Ok(a)
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Progress {
  pub percent: f64,
  /// None when yt-dlp doesn't know yet ("NA" / "Unknown").
  pub eta: Option<String>,
  pub speed: Option<String>,
}

/// One output line -> progress, None for anything else. A non-numeric
/// percent (clip downloads hand the cut to ffmpeg and report "N/A") is
/// dropped so the UI stays on "Starting…" instead of NaN%.
pub fn parse_progress(line: &str) -> Option<Progress> {
  let rest = &line[line.find(PROGRESS_PREFIX)? + PROGRESS_PREFIX.len()..];
  let mut f = rest.splitn(3, '|');
  let percent: f64 = f.next()?.trim().strip_suffix('%')?.trim().parse().ok()?;
  if !percent.is_finite() {
    return None;
  }
  let known = |s: Option<&str>| {
    s.map(str::trim).filter(|s| !s.is_empty() && *s != "NA" && !s.starts_with("Unknown")).map(String::from)
  };
  Some(Progress { percent, eta: known(f.next()), speed: known(f.next()) })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn split(v: bool, a: bool, merge: bool) -> DownloadJob {
    DownloadJob {
      url: "https://www.youtube.com/watch?v=jNQXAC9IVRw".into(),
      output_dir: r"C:\下載 資料夾".into(),
      mode: "split".into(),
      video_format_id: "133".into(),
      audio_format_id: "140".into(),
      include_video: v,
      include_audio: a,
      auto_merge: merge,
      ..Default::default()
    }
  }
  const FF: &str = r"C:\app\ffmpeg.exe";
  fn has(args: &[String], pair: &[&str]) -> bool {
    args.windows(pair.len()).any(|w| w.iter().zip(pair).all(|(x, y)| x == y))
  }

  #[test]
  fn selector_per_mode() {
    assert_eq!(format_selector(&split(true, true, true)), "133+140");
    assert_eq!(format_selector(&split(true, true, false)), "133,140");
    assert_eq!(format_selector(&split(true, false, true)), "133");
    assert_eq!(format_selector(&split(false, true, true)), "140");
    assert_eq!(format_selector(&split(false, false, true)), "");
    let c = DownloadJob { mode: "combined".into(), combined_format_id: "720p60".into(), ..split(true, true, true) };
    assert_eq!(format_selector(&c), "720p60");
  }

  #[test]
  fn merge_args_point_at_ffmpeg_sidecar_and_force_mp4() {
    let a = download_args(&split(true, true, true), FF).unwrap();
    assert!(has(&a, &["-f", "133+140"]));
    assert!(has(&a, &["--ffmpeg-location", FF]));
    assert!(has(&a, &["--merge-output-format", "mp4"]));
    assert!(has(&a, &["-P", r"C:\下載 資料夾"]));
    assert!(!a.contains(&"-o".to_string()));
    assert!(has(&a, &["--newline", "--no-colors", "--progress-template", &progress_template()]));
    assert_eq!(a[a.len() - 2..], ["--", "https://www.youtube.com/watch?v=jNQXAC9IVRw"]);
    assert!(!a.contains(&"--download-sections".to_string()));
  }

  #[test]
  fn separate_files_get_format_id_in_filename_and_no_merge() {
    let a = download_args(&split(true, true, false), FF).unwrap();
    assert!(has(&a, &["-f", "133,140"]));
    assert!(has(&a, &["-o", "%(title)s [%(format_id)s].%(ext)s"]));
    assert!(!a.contains(&"--merge-output-format".to_string()));
  }

  #[test]
  fn audio_only_and_combined_neither_merge_nor_rename() {
    let combined = DownloadJob { mode: "combined".into(), combined_format_id: "720p".into(), ..split(true, true, true) };
    for job in [split(false, true, true), combined] {
      let a = download_args(&job, FF).unwrap();
      assert!(!a.contains(&"--merge-output-format".to_string()));
      assert!(!a.contains(&"-o".to_string()));
    }
  }

  #[test]
  fn clip_adds_sections_and_keyframes() {
    let job = DownloadJob { clip_start: Some(1.0), clip_end: Some(4.5), ..split(true, true, true) };
    let a = download_args(&job, FF).unwrap();
    assert!(has(&a, &["--download-sections", "*1.00-4.50", "--force-keyframes-at-cuts"]));
    let bad = DownloadJob { clip_start: Some(4.0), clip_end: Some(1.0), ..split(true, true, true) };
    assert!(!download_args(&bad, FF).unwrap().contains(&"--download-sections".to_string()));
  }

  #[test]
  fn rejects_missing_selection_or_folder() {
    assert!(download_args(&split(false, false, true), FF).is_err());
    assert!(download_args(&DownloadJob { video_format_id: "".into(), ..split(true, true, true) }, FF).is_err());
    assert!(download_args(&DownloadJob { output_dir: "".into(), ..split(true, true, true) }, FF).is_err());
  }

  #[test]
  fn parses_progress_template_lines() {
    let p = parse_progress("DLPROGRESS| 42.3%|00:05|3.10MiB/s").unwrap();
    assert_eq!(p, Progress { percent: 42.3, eta: Some("00:05".into()), speed: Some("3.10MiB/s".into()) });
    let p = parse_progress("[download] DLPROGRESS|100.0%|NA|Unknown B/s").unwrap();
    assert_eq!(p, Progress { percent: 100.0, eta: None, speed: None });
    assert_eq!(parse_progress("DLPROGRESS|N/A|NA|NA"), None);
    assert_eq!(parse_progress("DLPROGRESS|NA%|NA|NA"), None);
    assert_eq!(parse_progress("[youtube] jNQXAC9IVRw: Downloading webpage"), None);
  }
}
