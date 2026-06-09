package paths

import (
	"os"
	"path/filepath"
)

// BaseDir returns the folder containing config.yaml, or the executable directory.
func BaseDir() string {
	if wd, err := os.Getwd(); err == nil {
		if _, err := os.Stat(filepath.Join(wd, "config.yaml")); err == nil {
			return wd
		}
	}

	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	dir, err := filepath.EvalSymlinks(filepath.Dir(exe))
	if err != nil {
		return filepath.Dir(exe)
	}
	return dir
}
