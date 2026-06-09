package singleinstance

// TryAcquire returns false when another copy of the app is already running.
func TryAcquire() bool {
	return tryAcquirePlatform()
}

// Release frees the single-instance lock for this process.
func Release() {
	releasePlatform()
}
