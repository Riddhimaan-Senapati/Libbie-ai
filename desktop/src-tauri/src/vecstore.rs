//! Embedded vector store backed by **sqlite-vec**.  Vector values plus the
//! `kind`/`source_id` fields that constrain KNN live in the `vec0` table (only
//! vec0 metadata columns are applied *during* the search); citation metadata
//! (`path`, `line_start`, `conv_id`) lives in an ordinary `chunk_meta` table
//! fetched via a join after the nearest neighbours are chosen. Keeping this
//! split lets one connector refresh its own rows (by `source_id`) without
//! destroying evidence indexed by another connector.

use rusqlite::{ffi::sqlite3_auto_extension, params, Connection};
use serde::Serialize;
use sqlite_vec::sqlite3_vec_init;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, Once};

use crate::error::AppError;

static INIT: Once = Once::new();
const SCHEMA_VERSION: &str = "3";

/// One embedded chunk ready to be committed as part of a source refresh.
/// `chunk_id` is stable within `source_id`, so callers can trace a stored row
/// back to a connector record even though SQLite assigns the numeric row id.
pub struct IndexedChunk<'a> {
    pub chunk_id: &'a str,
    pub embedding: &'a [f32],
    pub path: &'a str,
    pub kind: &'a str,
    pub line_start: i64,
    pub conv_id: &'a str,
}

/// One KNN result row, carrying the citation metadata needed to rebuild a
/// dual citation on the client.
#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub id: i64,
    pub path: String,
    pub kind: String,
    pub line_start: i64,
    pub conv_id: String,
    pub distance: f32,
    pub similarity: f32,
}

pub struct VecStore {
    conn: Mutex<Connection>,
}

fn lock_conn(m: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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

fn ensure_extension() {
    INIT.call_once(|| unsafe {
        #[allow(clippy::missing_transmute_annotations)]
        sqlite3_auto_extension(Some(std::mem::transmute(sqlite3_vec_init as *const ())));
    });
}

fn has_table(conn: &Connection, name: &str) -> Result<bool, AppError> {
    conn.query_row(
        "select exists(select 1 from sqlite_master where type = 'table' and name = ?1)",
        [name],
        |row| row.get(0),
    )
    .map_err(|e| AppError::vector_store(e.to_string()))
}

impl VecStore {
    pub fn open(db_path: PathBuf) -> Result<Self, AppError> {
        ensure_extension();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::vector_store(format!(
                    "Could not create index directory {}: {e}",
                    parent.to_string_lossy()
                ))
            })?;
        }
        let conn = Connection::open(&db_path)
            .map_err(|e| AppError::vector_store(format!("Could not open vector index: {e}")))?;
        conn.execute_batch(
            "create table if not exists libbie_meta(key text primary key, value text);",
        )
        .map_err(|e| AppError::vector_store(e.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, AppError> {
        ensure_extension();
        let conn =
            Connection::open_in_memory().map_err(|e| AppError::vector_store(e.to_string()))?;
        conn.execute_batch(
            "create table if not exists libbie_meta(key text primary key, value text);",
        )
        .map_err(|e| AppError::vector_store(e.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn dim(&self) -> Option<usize> {
        let conn = lock_conn(&self.conn);
        conn.query_row("select value from libbie_meta where key='dim'", [], |r| {
            r.get::<_, String>(0)
        })
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
    }

    pub fn count(&self) -> i64 {
        let conn = lock_conn(&self.conn);
        if !has_table(&conn, "chunk_meta").unwrap_or(false) {
            return 0;
        }
        conn.query_row("select count(*) from chunk_meta", [], |r| r.get(0))
            .unwrap_or(0)
    }

    /// Create the source-aware schema, replacing the legacy single-corpus
    /// layout once.  That legacy table had no source identity, so it cannot be
    /// migrated losslessly; it was already overwritten by every old re-index.
    fn initialise_schema(conn: &mut Connection, dim: usize) -> Result<(), AppError> {
        let version: Option<String> = conn
            .query_row(
                "select value from libbie_meta where key='schema_version'",
                [],
                |r| r.get(0),
            )
            .ok();
        if version.as_deref() == Some(SCHEMA_VERSION) {
            let existing = conn
                .query_row("select value from libbie_meta where key='dim'", [], |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|e| AppError::vector_store(e.to_string()))?
                .parse::<usize>()
                .map_err(|_| {
                    AppError::vector_store("Vector index has an invalid embedding dimension.")
                })?;
            if existing != dim {
                return Err(AppError::vector_store(format!(
                    "Embedding dimension changed from {existing} to {dim}. Rebuild the vector index before adding this source."
                )));
            }
            return Ok(());
        }

        let tx = conn
            .transaction()
            .map_err(|e| AppError::vector_store(e.to_string()))?;
        tx.execute_batch("drop table if exists chunks; drop table if exists chunk_meta;")
            .map_err(|e| AppError::vector_store(e.to_string()))?;
        tx.execute_batch(&format!(
            "create virtual table chunks using vec0(
                id integer primary key,
                embedding float[{dim}] distance_metric=cosine,
                kind text,
                source_id text
             );
             create table chunk_meta(
                 id integer primary key,
                 source_id text not null,
                 chunk_id text not null,
                 path text not null,
                 kind text not null,
                 line_start integer not null,
                 conv_id text not null,
                 unique(source_id, chunk_id)
             );
             create index chunk_meta_source_idx on chunk_meta(source_id);"
        ))
        .map_err(|e| AppError::vector_store(e.to_string()))?;
        tx.execute(
            "insert or replace into libbie_meta(key,value) values('dim',?1)",
            params![dim.to_string()],
        )
        .map_err(|e| AppError::vector_store(e.to_string()))?;
        tx.execute(
            "insert or replace into libbie_meta(key,value) values('schema_version',?1)",
            params![SCHEMA_VERSION],
        )
        .map_err(|e| AppError::vector_store(e.to_string()))?;
        tx.commit()
            .map_err(|e| AppError::vector_store(e.to_string()))
    }

    /// Atomically replace one source after all of its embeddings are ready.
    /// Other sources remain queryable, and any validation or SQLite error rolls
    /// the transaction back to the previous version of this source.
    pub fn replace_source(
        &self,
        dim: usize,
        source_id: &str,
        chunks: &[IndexedChunk<'_>],
    ) -> Result<(), AppError> {
        if source_id.trim().is_empty() {
            return Err(AppError::invalid_input(
                "Vector index source id cannot be empty.",
            ));
        }
        if chunks.iter().any(|chunk| chunk.embedding.len() != dim) {
            return Err(AppError::embedding(
                "Embedding dimension was inconsistent within one indexing run.",
            ));
        }
        let mut conn = lock_conn(&self.conn);
        Self::initialise_schema(&mut conn, dim)?;
        let tx = conn
            .transaction()
            .map_err(|e| AppError::vector_store(e.to_string()))?;
        tx.execute(
            "delete from chunks where id in (select id from chunk_meta where source_id = ?1)",
            [source_id],
        )
        .map_err(|e| AppError::vector_store(e.to_string()))?;
        tx.execute("delete from chunk_meta where source_id = ?1", [source_id])
            .map_err(|e| AppError::vector_store(e.to_string()))?;
        for chunk in chunks {
            tx.execute(
                "insert into chunk_meta(source_id, chunk_id, path, kind, line_start, conv_id)
                 values(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    source_id,
                    chunk.chunk_id,
                    chunk.path,
                    chunk.kind,
                    chunk.line_start,
                    chunk.conv_id
                ],
            )
            .map_err(|e| AppError::vector_store(e.to_string()))?;
            let id = tx.last_insert_rowid();
            tx.execute(
                "insert into chunks(id, embedding, kind, source_id) values(?1, ?2, ?3, ?4)",
                params![
                    id,
                    to_le_bytes(&normalize(chunk.embedding)),
                    chunk.kind,
                    source_id
                ],
            )
            .map_err(|e| AppError::vector_store(e.to_string()))?;
        }
        tx.commit()
            .map_err(|e| AppError::vector_store(e.to_string()))
    }

    pub fn knn(&self, query: &[f32], k: usize, kind: Option<&str>) -> Result<Vec<Hit>, AppError> {
        let bytes = to_le_bytes(&normalize(query));
        let conn = lock_conn(&self.conn);
        if !has_table(&conn, "chunk_meta")? {
            return Ok(Vec::new());
        }
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
        let sql = if kind.is_some() {
            "select m.id, m.path, m.kind, m.line_start, m.conv_id, v.distance
             from chunks v join chunk_meta m on m.id = v.id
             where v.embedding match ?1 and v.k = ?2 and v.kind = ?3"
        } else {
            "select m.id, m.path, m.kind, m.line_start, m.conv_id, v.distance
             from chunks v join chunk_meta m on m.id = v.id
             where v.embedding match ?1 and v.k = ?2"
        };
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| AppError::vector_store(e.to_string()))?;
        let rows = match kind {
            Some(kd) => stmt.query_map(params![bytes, k as i64, kd], map),
            None => stmt.query_map(params![bytes, k as i64], map),
        }
        .map_err(|e| AppError::vector_store(e.to_string()))?;
        for row in rows {
            out.push(row.map_err(|e| AppError::vector_store(e.to_string()))?);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk<'a>(
        id: &'a str,
        embedding: &'a [f32],
        path: &'a str,
        kind: &'a str,
    ) -> IndexedChunk<'a> {
        IndexedChunk {
            chunk_id: id,
            embedding,
            path,
            kind,
            line_start: 1,
            conv_id: "",
        }
    }

    #[test]
    fn source_refresh_preserves_other_sources_and_does_not_duplicate() {
        let store = VecStore::open_in_memory().unwrap();
        store
            .replace_source(
                3,
                "github:acme/repo",
                &[chunk("a", &[1.0, 0.0, 0.0], "a.rs", "code")],
            )
            .unwrap();
        store
            .replace_source(
                3,
                "slack",
                &[chunk("b", &[0.0, 1.0, 0.0], "", "conversation")],
            )
            .unwrap();
        store
            .replace_source(
                3,
                "github:acme/repo",
                &[chunk("a", &[0.9, 0.1, 0.0], "a.rs", "code")],
            )
            .unwrap();

        assert_eq!(store.count(), 2);
        assert_eq!(
            store
                .knn(&[0.0, 1.0, 0.0], 2, Some("conversation"))
                .unwrap()
                .len(),
            1
        );
        let code = store.knn(&[1.0, 0.0, 0.0], 2, Some("code")).unwrap();
        assert_eq!(code.len(), 1);
        assert_eq!(code[0].path, "a.rs");
    }

    #[test]
    fn invalid_refresh_leaves_previous_source_intact() {
        let store = VecStore::open_in_memory().unwrap();
        store
            .replace_source(
                3,
                "github:acme/repo",
                &[chunk("old", &[1.0, 0.0, 0.0], "old.rs", "code")],
            )
            .unwrap();
        let bad = [chunk("new", &[1.0, 0.0], "new.rs", "code")];
        assert!(store.replace_source(3, "github:acme/repo", &bad).is_err());

        let hits = store.knn(&[1.0, 0.0, 0.0], 1, Some("code")).unwrap();
        assert_eq!(hits[0].path, "old.rs");
        assert_eq!(store.count(), 1);
    }

    #[test]
    fn dimension_change_requires_explicit_rebuild() {
        let store = VecStore::open_in_memory().unwrap();
        store
            .replace_source(3, "github", &[chunk("a", &[1.0, 0.0, 0.0], "a.rs", "code")])
            .unwrap();
        assert!(store
            .replace_source(2, "slack", &[chunk("b", &[1.0, 0.0], "", "conversation")])
            .is_err());
        assert_eq!(store.count(), 1);
    }

    #[test]
    fn knn_kind_filter_applies_during_search_not_after_top_k() {
        let store = VecStore::open_in_memory().unwrap();
        // Three conversation rows closer to the query than the single code row.
        store
            .replace_source(
                3,
                "slack",
                &[
                    chunk("c1", &[1.0, 0.0, 0.0], "", "conversation"),
                    chunk("c2", &[0.966, 0.259, 0.0], "", "conversation"),
                    chunk("c3", &[0.866, 0.5, 0.0], "", "conversation"),
                ],
            )
            .unwrap();
        store
            .replace_source(
                3,
                "github",
                &[chunk("f", &[0.707, 0.707, 0.0], "target.rs", "code")],
            )
            .unwrap();

        // The global top-3 are all conversation, but a kind=code query must
        // still return the nearest code row. A post-filter on the joined table
        // would return zero rows here; a vec0 metadata filter returns one.
        let code = store.knn(&[1.0, 0.0, 0.0], 3, Some("code")).unwrap();
        assert_eq!(code.len(), 1);
        assert_eq!(code[0].kind, "code");
        assert_eq!(code[0].path, "target.rs");

        let conv = store
            .knn(&[1.0, 0.0, 0.0], 3, Some("conversation"))
            .unwrap();
        assert_eq!(conv.len(), 3);
    }
}
