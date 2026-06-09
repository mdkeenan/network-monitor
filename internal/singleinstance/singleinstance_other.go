//go:build !windows

package singleinstance

func tryAcquirePlatform() bool {
	return true
}

func releasePlatform() {}

func ShowAlreadyRunning() {}
