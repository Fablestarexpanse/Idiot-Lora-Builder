#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::project::open_project,
            commands::project::find_duplicates,
            commands::project::load_image_dimensions,
            commands::images::ensure_thumbnail,
            commands::images::ensure_thumbnails_batch,
            commands::images::get_thumbnail_cache_dir,
            commands::images::get_image_data_url,
            commands::images::crop_image,
            commands::images::multi_crop,
            commands::images::batch_resize,
            commands::images::delete_image,
            commands::captions::read_caption,
            commands::captions::get_captions_batch,
            commands::captions::write_caption,
            commands::captions::add_tag,
            commands::captions::remove_tag,
            commands::captions::reorder_tags,
            commands::captions::clear_all_captions,
            commands::lm_studio::test_lm_studio_connection,
            commands::lm_studio::generate_caption_lm_studio,
            commands::lm_studio::generate_captions_batch,
            commands::ollama::test_ollama_connection,
            commands::export::export_dataset,
            commands::export::export_by_rating,
            commands::ratings::set_rating,
            commands::ratings::set_ratings_batch,
            commands::ratings::get_ratings,
            commands::ratings::clear_all_ratings,
            commands::crop_status::set_crop_status,
            commands::crop_status::get_crop_statuses,
            commands::crop_status::clear_all_crop_statuses,
            commands::batch_rename::batch_rename,
            commands::detect::detect_faces,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LoRA Dataset Studio");
}
