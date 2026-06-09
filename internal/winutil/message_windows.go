//go:build windows

package winutil

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	mbOK        = 0x00000000
	mbIconError = 0x00000010
)

// ShowError displays a modal error dialog (used when running without a console).
func ShowError(title, message string) {
	showMessage(title, message, mbOK|mbIconError)
}

func showMessage(title, message string, flags uintptr) {
	titlePtr, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	messagePtr, err := windows.UTF16PtrFromString(message)
	if err != nil {
		return
	}

	user32 := windows.NewLazySystemDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")
	_, _, _ = messageBox.Call(
		0,
		uintptr(unsafe.Pointer(messagePtr)),
		uintptr(unsafe.Pointer(titlePtr)),
		flags,
	)
}
