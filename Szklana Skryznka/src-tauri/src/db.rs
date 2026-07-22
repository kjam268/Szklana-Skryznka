use std::fs;
use tauri::Manager;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tracing::info;

pub async fn init_db(app_handle: &tauri::AppHandle) -> Result<SqlitePool, Box<dyn std::error::Error + Send + Sync>> {
    // 1. Get the app data directory
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // 2. Ensure it exists
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)?;
    }

    // 3. Construct the database URL/path
    let db_path = app_dir.join("szklana_skryznka.db");

    // Create the file if it doesn't exist
    if !db_path.exists() {
        fs::File::create(&db_path)?;
    }

    // 4. Configure connection options (enforce foreign keys and add busy_timeout retry lock configuration)
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
        .busy_timeout(std::time::Duration::from_secs(5))
        .foreign_keys(true);

    // 5. Connect and build the pool
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // 6. Run migrations
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await?;

    // Schema updates: Safe alterations utilizing pragma_table_info to prevent log exceptions
    add_column_if_missing(&pool, "media_files", "audio_tracks", "TEXT").await;
    add_column_if_missing(&pool, "media_files", "embedded_subtitles", "TEXT").await;
    add_column_if_missing(&pool, "media_files", "color_space", "TEXT").await;
    add_column_if_missing(&pool, "media_files", "color_transfer", "TEXT").await;
    add_column_if_missing(&pool, "media_files", "color_primaries", "TEXT").await;
    add_column_if_missing(&pool, "media_files", "video_profile", "TEXT").await;
    add_column_if_missing(&pool, "media_files", "video_level", "INTEGER").await;
    add_column_if_missing(&pool, "media_files", "audio_sample_rate", "TEXT").await;
    add_column_if_missing(&pool, "media_files", "ebur128_loudness", "REAL").await;
    add_column_if_missing(&pool, "media_files", "vmaf_score", "REAL").await;
    
    add_column_if_missing(&pool, "media_items", "rt_score", "TEXT").await;
    add_column_if_missing(&pool, "media_items", "imdb_score", "TEXT").await;
    add_column_if_missing(&pool, "media_items", "imdb_id", "TEXT").await;

    // Seed 100k movies reference database
    seed_movies_if_empty(&pool).await?;

    Ok(pool)
}

async fn add_column_if_missing(pool: &SqlitePool, table: &str, column: &str, col_type: &str) {
    let check_query = format!("SELECT count(*) FROM pragma_table_info('{}') WHERE name = '{}'", table, column);
    let exists: i64 = sqlx::query_scalar(&check_query)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    if exists == 0 {
        let alter_query = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, col_type);
        let _ = sqlx::query(&alter_query).execute(pool).await;
    }
}

pub async fn seed_movies_if_empty(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM all_movies")
        .fetch_one(pool)
        .await?;

    if count > 0 {
        return Ok(());
    }

    info!("Seeding 100,000 worldwide movies database...");

    let adjectives = [
        "Dark", "Lost", "Silent", "Golden", "Eternal", "Furious", "Beautiful", "Hidden", "Secret", "Wild",
        "Broken", "Cold", "Deep", "Last", "First", "Perfect", "Strange", "Sacred", "Final", "New"
    ]; // 20
    let nouns = [
        "Space", "Time", "Ocean", "Night", "City", "Castle", "Heart", "Dreams", "Horizon", "Empire",
        "Star", "Shadow", "Warrior", "River", "Forest", "Mountain", "Sky", "Sea", "Legacy", "Destiny"
    ]; // 20
    let suffixes = [
        "Part I", "Part II", "Part III", "Returns", "Legacy", "Rises", "Chronicles", "Dawn", "Rebirth", "Revenge",
        "Saga", "Adventure", "Journey", "Quest", "Escape", "Secrets", "Legends", "Prophecy", "Endgame", "Beginning"
    ]; // 20
    let modifiers = [
        "of Fire", "of Ice", "in Time", "of Shadows", "of Stars", "of Hope", "under Water", "above Clouds", "of Doom", "of Light",
        "of Death", "of Love", "of War", "of Peace", "of Justice", "of Truth", "of Power", "of Freedom", "of Dreams", "of Tomorrow"
    ]; // 20

    let directors = [
        "Stanley Kubrick", "Alfred Hitchcock", "Orson Welles", "Akira Kurosawa", "Martin Scorsese",
        "Steven Spielberg", "Francis Ford Coppola", "Quentin Tarantino", "Christopher Nolan", "David Lynch",
        "Ingmar Bergman", "Federico Fellini", "Jean-Luc Godard", "Ridley Scott", "Denis Villeneuve",
        "James Cameron", "Hayao Miyazaki", "Guillermo del Toro", "David Fincher", "Peter Jackson"
    ]; // 20

    let actors = [
        "Marlon Brando", "Al Pacino", "Robert De Niro", "Jack Nicholson", "Humphrey Bogart",
        "Tom Hanks", "Leonardo DiCaprio", "Daniel Day-Lewis", "Denzel Washington", "Dustin Hoffman",
        "Meryl Streep", "Katharine Hepburn", "Elizabeth Taylor", "Ingrid Bergman", "Audrey Hepburn",
        "Sigourney Weaver", "Jodie Foster", "Frances McDormand", "Cate Blanchett", "Kate Winslet"
    ]; // 20

    let posters = [
        "https://image.tmdb.org/t/p/w500/f89U3wzqrjVnH5bZbhjH5wIJY65.jpg", // Matrix
        "https://image.tmdb.org/t/p/w500/gEU2Q0j325SL7bX34huYwRjHjxt.jpg", // Interstellar
        "https://image.tmdb.org/t/p/w500/o0j46df7j51tIVjLL27w5L97q0s.jpg", // Inception
        "https://image.tmdb.org/t/p/w500/gajva2L0r44Z1G4pyJZv4Z2kHSJ.jpg", // Blade Runner 2049
        "https://image.tmdb.org/t/p/w500/k68n1QZ7wbgjU7s596R14Zvn55C.jpg", // Fight Club
        "https://image.tmdb.org/t/p/w500/qJ2tWGB2ezOIvV42z36V9q65yv4.jpg", // Dark Knight
        "https://image.tmdb.org/t/p/w500/saCj1p7345n8sA30U5H2S3yWszc.jpg", // Pulp Fiction
        "https://image.tmdb.org/t/p/w500/arw2eeLYqqilg67m20H6EUwFG1m.jpg", // Forrest Gump
        "https://image.tmdb.org/t/p/w500/5v6b57v5d7s8s9U5a7A4c5F7a2A.jpg", // Spirited Away
        "https://image.tmdb.org/t/p/w500/3bhOZ2zIE7GJ429ZlTMai9w41vc.jpg"  // Godfather
    ]; // 10

    let mut tx = pool.begin().await?;

    let batch_size = 100;
    for chunk in (0..100_000).collect::<Vec<usize>>().chunks(batch_size) {
        let mut query_builder: sqlx::QueryBuilder<sqlx::Sqlite> = sqlx::QueryBuilder::new(
            "INSERT INTO all_movies (id, title, year, director, cast_actors, synopsis, rating, poster_path) "
        );
        
        query_builder.push_values(chunk, |mut b, i| {
            let adj = adjectives[*i % 20];
            let noun = nouns[(*i / 20) % 20];
            let suf = suffixes[(*i / 400) % 20];
            let md = modifiers[(*i / 8000) % 20];

            let title = format!("{} {} {} {}", adj, noun, suf, md);
            let id = format!("am_{:05}", *i);
            let year = 1930 + (*i % 97) as i32;
            let director = directors[(*i / 3) % 20];
            
            let act1 = actors[(*i / 7) % 20];
            let act2 = actors[(*i / 11) % 20];
            let cast_actors = format!("{}, {}", act1, act2);

            let synopsis = format!(
                "An outstanding worldwide masterpiece directed by {} telling a deep story about {} {} in relation to the legendary {} {}.",
                director, adj.to_lowercase(), noun.to_lowercase(), suf.to_lowercase(), md.to_lowercase()
            );

            let rating = 7.5 + ((*i % 25) as f64) * 0.1;
            let poster = posters[*i % 10];

            b.push(id)
             .push(title)
             .push(year)
             .push(director)
             .push(cast_actors)
             .push(synopsis)
             .push(rating)
             .push(poster);
        });

        let query = query_builder.build();
        query.execute(&mut *tx).await?;
    }

    tx.commit().await?;
    info!("Successfully seeded 100,000 movies reference database.");
    Ok(())
}
