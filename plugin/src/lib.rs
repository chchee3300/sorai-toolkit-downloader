use tauri::{
  plugin::{Builder, TauriPlugin},
  AppHandle, Manager, Runtime,
};
use tauri_plugin_shell::ShellExt;

pub mod download;
mod jobs;
pub mod metadata;

/// Plugin name: JS calls commands as `plugin:sorai-downloader|<command>`,
/// the hub grants `sorai-downloader:default`.
pub const NAME: &str = "sorai-downloader";

/// Liveness reply; the hub's E2E smoke test checks it end to end.
pub fn pong(value: &str) -> String {
  format!("{NAME} pong: {value}")
}

#[tauri::command]
fn ping(value: String) -> String {
  pong(&value)
}

/// `yt-dlp -j` for one URL. Err carries yt-dlp's stderr so the queue row can
/// show it. Host contract: a `yt-dlp` sidecar + the shell plugin registered.
#[tauri::command]
async fn fetch_metadata<R: Runtime>(app: AppHandle<R>, url: String) -> Result<metadata::Metadata, String> {
  let out = app
    .shell()
    .sidecar("yt-dlp")
    .map_err(|e| e.to_string())?
    .args(metadata::metadata_args(&url))
    .output()
    .await
    .map_err(|e| e.to_string())?;
  if !out.status.success() {
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let code = out.status.code().map_or("?".into(), |c| c.to_string());
    return Err(if err.is_empty() { format!("yt-dlp exited with code {code}") } else { err });
  }
  metadata::parse_metadata_json(&String::from_utf8_lossy(&out.stdout))
}

/// Starts one yt-dlp download; returns its job id right away. Progress /
/// log lines / exactly one `finished` arrive on `on_event`.
#[tauri::command]
fn start_download<R: Runtime>(
  app: AppHandle<R>,
  job: download::DownloadJob,
  on_event: tauri::ipc::Channel<jobs::JobEvent>,
) -> Result<u32, String> {
  jobs::start(&app, &job, on_event)
}

/// Kills the job's whole process tree; `finished { cancelled }` follows
/// within jobs::CANCEL_GRACE even if the process never reports its exit.
#[tauri::command]
fn cancel_download<R: Runtime>(app: AppHandle<R>, job_id: u32) {
  jobs::cancel(&app, job_id)
}

/// Registered by the hub: `.plugin(tauri_plugin_sorai_downloader::init())`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new(NAME)
    .invoke_handler(tauri::generate_handler![ping, fetch_metadata, start_download, cancel_download])
    .setup(|app, _| {
      app.manage(jobs::Jobs::default());
      Ok(())
    })
    .build()
}

#[cfg(test)]
mod tests {
  #[test]
  fn pong_echoes_value_with_plugin_name() {
    assert_eq!(super::pong("hi"), "sorai-downloader pong: hi");
  }
}
