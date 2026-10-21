use tauri::{
  plugin::{Builder, TauriPlugin},
  AppHandle, Runtime,
};
use tauri_plugin_shell::ShellExt;

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

/// Registered by the hub: `.plugin(tauri_plugin_sorai_downloader::init())`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new(NAME)
    .invoke_handler(tauri::generate_handler![ping, fetch_metadata])
    .build()
}

#[cfg(test)]
mod tests {
  #[test]
  fn pong_echoes_value_with_plugin_name() {
    assert_eq!(super::pong("hi"), "sorai-downloader pong: hi");
  }
}
