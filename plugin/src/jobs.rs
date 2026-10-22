//! Subprocess runner: one yt-dlp sidecar per job, its output streamed to the
//! job's Channel, cancel by job id. Converter keeps its own copy of this
//! (spec: ~100 duplicated lines; extract a crate when a third tool appears).

use std::{
  collections::HashMap,
  sync::{
    atomic::{AtomicU32, Ordering},
    Mutex,
  },
  time::Duration,
};

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

use crate::download::{self, DownloadJob};

/// After a cancel, `finished { cancelled }` is sent at the latest this long
/// after the kill, whether or not the process ever reports its exit.
pub const CANCEL_GRACE: Duration = Duration::from_secs(3);

#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum JobEvent {
  /// { percent, eta, speed }
  Progress(download::Progress),
  /// Raw non-progress output line.
  Log { line: String },
  /// Sent exactly once per job.
  Finished { ok: bool, cancelled: bool, error: Option<String> },
}

const CANCELLED: JobEvent = JobEvent::Finished { ok: false, cancelled: true, error: None };

struct Job {
  child: Option<CommandChild>,
  cancelled: bool,
  channel: Channel<JobEvent>,
}

#[derive(Default)]
pub struct Jobs {
  next: AtomicU32,
  map: Mutex<HashMap<u32, Job>>,
}

/// Whoever removes the job sends its one `finished` (exit vs cancel backstop).
fn take<R: Runtime>(app: &AppHandle<R>, id: u32) -> Option<Job> {
  app.state::<Jobs>().map.lock().unwrap().remove(&id)
}

pub fn start<R: Runtime>(app: &AppHandle<R>, job: &DownloadJob, channel: Channel<JobEvent>) -> Result<u32, String> {
  let ffmpeg = crate::sidecar::bundled(app, "ffmpeg").map(|p| p.to_string_lossy().into_owned());
  let args = download::download_args(job, ffmpeg.as_deref())?;
  let (mut rx, child) = crate::sidecar::command(app, "yt-dlp")
    .args(args)
    // Titles/paths in log and ERROR lines come out as UTF-8, not the console codepage.
    .env("PYTHONIOENCODING", "utf-8")
    // Job object (Windows) / process group (Unix): kill() takes down the
    // PyInstaller onefile child and yt-dlp's ffmpeg too, not just the parent.
    .set_process_group(true)
    .spawn()
    .map_err(|e| e.to_string())?;

  let jobs = app.state::<Jobs>();
  let id = jobs.next.fetch_add(1, Ordering::Relaxed);
  jobs.map.lock().unwrap().insert(id, Job { child: Some(child), cancelled: false, channel: channel.clone() });

  let app = app.clone();
  tauri::async_runtime::spawn(async move {
    let mut errors: Vec<String> = Vec::new();
    let mut code = None;
    while let Some(ev) = rx.recv().await {
      match ev {
        CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
          let line = String::from_utf8_lossy(&b).trim_end().to_string();
          if let Some(p) = download::parse_progress(&line) {
            let _ = channel.send(JobEvent::Progress(p));
          } else if !line.is_empty() {
            if line.starts_with("ERROR") {
              errors.push(line.clone());
            }
            let _ = channel.send(JobEvent::Log { line });
          }
        }
        CommandEvent::Error(line) => {
          let _ = channel.send(JobEvent::Log { line });
        }
        CommandEvent::Terminated(t) => {
          code = t.code;
          break;
        }
        _ => {}
      }
    }
    if let Some(job) = take(&app, id) {
      let ev = match code {
        _ if job.cancelled => CANCELLED,
        Some(0) => JobEvent::Finished { ok: true, cancelled: false, error: None },
        _ if !errors.is_empty() => JobEvent::Finished { ok: false, cancelled: false, error: Some(errors.join("\n")) },
        c => JobEvent::Finished {
          ok: false,
          cancelled: false,
          error: Some(format!("yt-dlp exited with code {}", c.map_or("?".into(), |c| c.to_string()))),
        },
      };
      let _ = job.channel.send(ev);
    }
  });
  Ok(id)
}

/// Unknown or already-cancelling ids are a no-op.
pub fn cancel<R: Runtime>(app: &AppHandle<R>, id: u32) {
  let jobs = app.state::<Jobs>();
  let child = {
    let mut map = jobs.map.lock().unwrap();
    let Some(job) = map.get_mut(&id) else { return };
    job.cancelled = true;
    job.child.take()
  };
  let Some(child) = child else { return };
  // kill() blocks until the process is reaped -- keep it off the backstop's thread.
  std::thread::spawn(move || {
    let _ = child.kill();
  });
  let app = app.clone();
  std::thread::spawn(move || {
    std::thread::sleep(CANCEL_GRACE);
    if let Some(job) = take(&app, id) {
      let _ = job.channel.send(CANCELLED);
    }
  });
}
