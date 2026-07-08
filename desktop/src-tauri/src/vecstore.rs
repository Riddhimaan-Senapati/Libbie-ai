//! Embedded vector store backed by **sqlite-vec** (pure C, statically linked via
//! `cargo add sqlite-vec` + rusqlite "bundled" — no per-platform prebuilt
//! binaries, runs anywhere SQLite runs). Vectors and their citation metadata
//! live in one on-disk `.db`, mirroring the plan's pgvector+Postgres design but
//! embedded and daemon-free — the right shape for an air-gapped single binary.

use rusqlite::{ffi::sqlite3_auto_extension, params, Connection};
use serde::Serialize;
use sqlite_vec::sqlite3_vec_init;
use std::path::PathBuf;
use std::sync::{Mutex, Once};

static INIT: Once = Once::new();

/// One KNN result row, carrying the citation metadata needed to rebuild a
/// dual citation on the client.
#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub id: i64,
    /// Empty string when not applicable (vec0 TEXT metadata columns can't be NULL).
    pub path: String,
    pub kind: String,
    pub line_start: i64,
    /// Empty string when not applicable.
    pub conv_id: String,
    pub distance: f32,
    /// Cosine similarity in [0,1] (1 = identical), derived from distance.
    pub similarity: f32,
}

pub struct VecStore {
    conn: Mutex<Connection>,
}

fn to_le_bytes(v: &[f32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(v.len() * 4);
    for x in v {
        b.extend_from_slice(&x.to_le_bytes());
    }
    b
}

/// L2-normalise so cosine distance behaves well regardless of the embedder's
/// output scale.
fn normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter().map(|x| x / norm).collect()
    } else {
        v.to_vec()
    }
}

/// Register the sqlite-vec extension exactly once for every future connection.
fn ensure_extension() {
    INIT.call_once(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite3_vec_init as *const (),
        )));
    });
}

impl VecStore {
    /// Open (creating if needed) an on-disk index database.
    pub fn open(db_path: PathBuf) -> Result<Self, String> {
        ensure_extension();
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "create table if not exists libbie_meta(key text primary key, value text);",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        ensure_extension();
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "create table if not exists libbie_meta(key text primary key, value text);",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Embedding dimension of the current index, if built.
    pub fn dim(&self) -> Option<usize> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "select value from libbie_meta where key='dim'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
    }

    /// Number of indexed chunks (0 if not built).
    pub fn count(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row("select count(*) from chunks", [], |r| r.get(0))
            .unwrap_or(0)
    }

    /// (Re)create the vec0 table for a given embedding dimension, clearing any
    /// prior index. Called at the start of a corpus (re)index.
    pub fn reset(&self, dim: usize) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("drop table if exists chunks;")
            .map_err(|e| e.to_string())?;
        conn.execute_batch(&format!(
            "create virtual table chunks using vec0(
                id integer primary key,
                embedding float[{dim}] distance_metric=cosine,
                path text,
                kind text,
                line_start integer,
                conv_id text
            );"
        ))
        .map_err(|e| e.to_string())?;
        conn.execute(
            "insert or replace into libbie_meta(key,value) values('dim',?1)",
            params![dim.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Insert one embedded chunk with its citation metadata. `path`/`conv_id`
    /// use "" (not NULL) when not applicable — vec0 TEXT metadata is non-null.
    pub fn insert(
        &self,
        id: i64,
        embedding: &[f32],
        path: &str,
        kind: &str,
        line_start: i64,
        conv_id: &str,
    ) -> Result<(), String> {
        let bytes = to_le_bytes(&normalize(embedding));
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "insert into chunks(id, embedding, path, kind, line_start, conv_id)
             values (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, bytes, path, kind, line_start, conv_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// K-nearest-neighbour search, optionally constrained to a `kind`
    /// ("code" | "conversation").
    pub fn knn(&self, query: &[f32], k: usize, kind: Option<&str>) -> Result<Vec<Hit>, String> {
        let bytes = to_le_bytes(&normalize(query));
        let conn = self.conn.lock().unwrap();

        let map = |row: &rusqlite::Row| -> rusqlite::Result<Hit> {
            let distance: f64 = row.get(5)?;
            Ok(Hit {
                id: row.get(0)?,
                path: row.get(1)?,
                kind: row.get(2)?,
                line_start: row.get(3)?,
                conv_id: row.get(4)?,
                distance: distance as f32,
                similarity: (1.0 - distance as f32).clamp(0.0, 1.0),
            })
        };

        let mut out = Vec::new();
        if let Some(kd) = kind {
            let mut stmt = conn
                .prepare(
                    "select id, path, kind, line_start, conv_id, distance
                     from chunks
                     where embedding match ?1 and k = ?2 and kind = ?3",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![bytes, k as i64, kd], map)
                .map_err(|e| e.to_string())?;
            for r in rows {
                out.push(r.map_err(|e| e.to_string())?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    "select id, path, kind, line_start, conv_id, distance
                     from chunks
                     where embedding match ?1 and k = ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![bytes, k as i64], map)
                .map_err(|e| e.to_string())?;
            for r in rows {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knn_finds_nearest_with_metadata_filter() {
        let store = VecStore::open_in_memory().expect("open");
        store.reset(3).expect("reset");
        store
            .insert(1, &[1.0, 0.0, 0.0], "a.config", "code", 6, "")
            .unwrap();
        store
            .insert(2, &[0.0, 1.0, 0.0], "b.nf", "code", 3, "")
            .unwrap();
        store
            .insert(3, &[0.92, 0.08, 0.0], "c.config", "code", 14, "")
            .unwrap();
        store
            .insert(4, &[0.0, 0.0, 1.0], "", "conversation", 0, "conv-x")
            .unwrap();

        assert_eq!(store.count(), 4);
        assert_eq!(store.dim(), Some(3));

        // Nearest to [1,0,0] among code chunks should be "a.config", then "c.config".
        let hits = store.knn(&[1.0, 0.0, 0.0], 2, Some("code")).expect("knn");
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].path, "a.config");
        assert_eq!(hits[1].path, "c.config");
        assert!(hits[0].similarity > hits[1].similarity);

        // The kind filter must exclude the conversation chunk.
        assert!(hits.iter().all(|h| h.kind == "code"));

        // Conversation-only search returns the conversation chunk.
        let conv = store
            .knn(&[0.0, 0.0, 1.0], 3, Some("conversation"))
            .expect("knn conv");
        assert_eq!(conv.len(), 1);
        assert_eq!(conv[0].conv_id, "conv-x");
    }
}
