import sqlite3
from contextlib import contextmanager
from config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS cultivation_profile(id INTEGER PRIMARY KEY CHECK(id=1),
  full_name TEXT NOT NULL DEFAULT '', dao_name TEXT NOT NULL DEFAULT '', birth_date TEXT,
  birth_time TEXT, hometown TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS games(id INTEGER PRIMARY KEY, platform TEXT, ext_id TEXT, played_at INTEGER,
  color TEXT, opponent TEXT, my_rating INT, opp_rating INT, result TEXT, time_class TEXT, pgn TEXT, UNIQUE(platform, ext_id));
CREATE TABLE IF NOT EXISTS rating_history(id INTEGER PRIMARY KEY, platform TEXT, time_class TEXT, day TEXT, rating INT,
  UNIQUE(platform, time_class, day));
CREATE TABLE IF NOT EXISTS library_items(id INTEGER PRIMARY KEY, kind TEXT, title TEXT, path TEXT UNIQUE, ext TEXT,
  size INT, sha1 TEXT UNIQUE, added_at TEXT DEFAULT CURRENT_TIMESTAMP, favorite INT DEFAULT 0, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS library_tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS library_item_tags(item_id INT REFERENCES library_items(id) ON DELETE CASCADE,
  tag_id INT REFERENCES library_tags(id) ON DELETE CASCADE, PRIMARY KEY(item_id, tag_id));
CREATE TABLE IF NOT EXISTS library_folders(id INTEGER PRIMARY KEY, parent_id INT REFERENCES library_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS saved_reviews(id TEXT PRIMARY KEY, game_key TEXT NOT NULL,
  item_id INT REFERENCES library_items(id) ON DELETE CASCADE,
  metadata BLOB NOT NULL, payload BLOB NOT NULL, updated_at INT NOT NULL);
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY, name TEXT NOT NULL, rating INT, club TEXT, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS tournaments(id INTEGER PRIMARY KEY, name TEXT, date TEXT, seed INT, split_mode TEXT,
  status TEXT DEFAULT 'prepare', kind TEXT DEFAULT 'classic', duration_min INT, starts_at TEXT, ends_at TEXT);
CREATE TABLE IF NOT EXISTS stages(id INTEGER PRIMARY KEY, tournament_id INT REFERENCES tournaments(id) ON DELETE CASCADE,
  ord INT, name TEXT, format TEXT);
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, stage_id INT REFERENCES stages(id) ON DELETE CASCADE, name TEXT);
CREATE TABLE IF NOT EXISTS tournament_players(tournament_id INT REFERENCES tournaments(id) ON DELETE CASCADE,
  student_id INT REFERENCES students(id), group_id INT REFERENCES groups(id), PRIMARY KEY(tournament_id, student_id));
CREATE TABLE IF NOT EXISTS stage_players(group_id INT REFERENCES groups(id) ON DELETE CASCADE, student_id INT REFERENCES students(id), seed INT, PRIMARY KEY(group_id, student_id));
CREATE TABLE IF NOT EXISTS pairings(id INTEGER PRIMARY KEY, group_id INT REFERENCES groups(id) ON DELETE CASCADE,
  round INT, board INT, white_id INT, black_id INT, result TEXT,
  white_technical_errors INT DEFAULT 0, black_technical_errors INT DEFAULT 0,
  white_tactics_created INT DEFAULT 0, black_tactics_created INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS puzzle_log(id INTEGER PRIMARY KEY, puzzle_id TEXT, rating INT, realm TEXT, solved INT,
  mistakes INT DEFAULT 0, hints INT DEFAULT 0, seconds REAL DEFAULT 0, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS arena_players(tournament_id INT REFERENCES tournaments(id) ON DELETE CASCADE,
  student_id INT REFERENCES students(id), status TEXT DEFAULT 'waiting',
  PRIMARY KEY(tournament_id, student_id));
CREATE TABLE IF NOT EXISTS tournament_events(id INTEGER PRIMARY KEY,
  tournament_id INT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  action TEXT NOT NULL, details TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS worksheets(id TEXT PRIMARY KEY, title TEXT NOT NULL,
  payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS worksheet_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
  title TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, level TEXT NOT NULL,
  count INT NOT NULL, answer_count INT NOT NULL, search_text TEXT NOT NULL,
  payload TEXT NOT NULL, fingerprint TEXT NOT NULL, action TEXT NOT NULL,
  request_id TEXT UNIQUE, request_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')));
CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS online_books(id TEXT PRIMARY KEY, title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL, url_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS online_book_packages(book_id TEXT PRIMARY KEY REFERENCES online_books(id) ON DELETE CASCADE,
  manifest TEXT NOT NULL, content TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS online_book_assets(book_id TEXT NOT NULL REFERENCES online_books(id) ON DELETE CASCADE,
  path TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(book_id,path));
"""

# migrate columns if DB already exists without them
MIGRATE = [
    "ALTER TABLE worksheet_versions ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE groups ADD COLUMN swiss_rounds INT",
    "ALTER TABLE tournaments ADD COLUMN notes TEXT DEFAULT ''",
    "ALTER TABLE tournaments ADD COLUMN kind TEXT DEFAULT 'classic'",
    "ALTER TABLE tournaments ADD COLUMN duration_min INT",
    "ALTER TABLE tournaments ADD COLUMN starts_at TEXT",
    "ALTER TABLE tournaments ADD COLUMN ends_at TEXT",
    "ALTER TABLE pairings ADD COLUMN white_technical_errors INT DEFAULT 0",
    "ALTER TABLE pairings ADD COLUMN black_technical_errors INT DEFAULT 0",
    "ALTER TABLE pairings ADD COLUMN white_tactics_created INT DEFAULT 0",
    "ALTER TABLE pairings ADD COLUMN black_tactics_created INT DEFAULT 0",
    "ALTER TABLE library_items ADD COLUMN blob TEXT",
    "ALTER TABLE library_items ADD COLUMN folder_id INT",
]


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    try:
        with c:
            yield c
    finally:
        c.close()


def init():
    with conn() as c:
        c.executescript(SCHEMA)
        c.execute("BEGIN IMMEDIATE")
        from services.online_books import seed
        seed(c)
        c.execute("CREATE INDEX IF NOT EXISTS idx_pairings_group ON pairings(group_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_tournament_events_tour ON tournament_events(tournament_id,id)")
        for sql in MIGRATE:
            try:
                c.execute(sql)
            except sqlite3.OperationalError:
                pass  # column already exists
        # Deleted snapshot links must never point to an unrelated, newly saved version.
        version_schema = c.execute("SELECT sql FROM sqlite_master WHERE name='worksheet_versions'").fetchone()[0]
        if 'AUTOINCREMENT' not in version_schema.upper():
            upgraded = next(sql for sql in SCHEMA.split(';') if 'CREATE TABLE IF NOT EXISTS worksheet_versions(' in sql)
            c.execute(upgraded.replace('IF NOT EXISTS worksheet_versions(', 'worksheet_versions_upgraded('))
            columns = 'id,document_id,title,display_name,kind,level,count,answer_count,search_text,payload,fingerprint,action,request_id,request_hash,created_at'
            c.execute(f"INSERT INTO worksheet_versions_upgraded({columns}) SELECT {columns} FROM worksheet_versions")
            c.execute("DROP TABLE worksheet_versions")
            c.execute("ALTER TABLE worksheet_versions_upgraded RENAME TO worksheet_versions")
        c.execute("CREATE INDEX IF NOT EXISTS idx_worksheet_versions_document ON worksheet_versions(document_id,id)")
        # Preserve previously saved worksheet snapshots once; older generation history cannot be reconstructed.
        import hashlib, json
        for row in c.execute("SELECT * FROM worksheets w WHERE NOT EXISTS (SELECT 1 FROM worksheet_versions v WHERE v.document_id=w.id)").fetchall():
            try:
                document = json.loads(row["payload"])
                encoded = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
                exercises = document["exercises"]
                level, kind = document.get("level", ""), document.get("kind", "exercise")
                c.execute("INSERT INTO worksheet_versions(document_id,title,kind,level,count,answer_count,search_text,payload,fingerprint,action,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                          (row["id"],row["title"],kind,level,len(exercises),sum(bool(e.get("solution")) for e in exercises),
                           (row["title"]+' '+level).casefold(),encoded,hashlib.sha256(encoded.encode()).hexdigest(),"migration",row["updated_at"]))
            except (ValueError,KeyError,TypeError):
                continue
        # dọn các dòng bye cũ của đấu trường (bản cũ cộng 1 điểm miễn phí mỗi lần bấm Ghép)
        c.execute(
            "DELETE FROM pairings WHERE black_id IS NULL AND group_id IN "
            "(SELECT g.id FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.format='arena')"
        )
