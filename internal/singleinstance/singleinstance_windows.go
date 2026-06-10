//go:build windows

package singleinstance

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const mutexName = "Global\\ConnectWatch.SingleInstance.v1"

var mutexHandle windows.Handle

func tryAcquirePlatform() bool {
	name, err := windows.UTF16PtrFromString(mutexName)
	if err != nil {
		return false
	}

	handle, err := windows.CreateMutex(nil, false, name)
	if err != nil {
		return false
	}

	mutexHandle = handle
	if windows.GetLastError() == windows.ERROR_ALREADY_EXISTS {
		_ = windows.CloseHandle(handle)
		mutexHandle = 0
		return false
	}
	return true
}

func releasePlatform() {
	if mutexHandle == 0 {
		return
	}
	_ = windows.ReleaseMutex(mutexHandle)
	_ = windows.CloseHandle(mutexHandle)
	mutexHandle = 0
}

// ShowAlreadyRunning notifies the user that another copy is active.
func ShowAlreadyRunning() {
	const (
		mbOK       = 0x00000000
		mbIconInfo = 0x00000040
	)
	title, _ := windows.UTF16PtrFromString("ConnectWatch")
	text, _ := windows.UTF16PtrFromString("ConnectWatch is already running. Check the system tray near the clock.")
	user32 := windows.NewLazySystemDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")
	_, _, _ = messageBox.Call(
		0,
		uintptr(unsafe.Pointer(text)),
		uintptr(unsafe.Pointer(title)),
		uintptr(mbOK|mbIconInfo),
	)
}
