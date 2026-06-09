package database

import "database/sql"

func (db *DB) GetAppState(key string) (string, bool, error) {
	var value string
	err := db.conn.QueryRow(`SELECT value FROM app_state WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (db *DB) SetAppState(key, value string) error {
	_, err := db.conn.Exec(
		`INSERT INTO app_state (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value,
	)
	return err
}
