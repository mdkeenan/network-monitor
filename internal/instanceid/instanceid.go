package instanceid

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"hash/fnv"
)

const instanceSegmentKey = "instance_segment"

// GenerateInstanceSegment returns exactly 12 lowercase hex chars from 6 crypto/rand bytes.
func GenerateInstanceSegment() (string, error) {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ComputeVersionSegment returns the 8-char lowercase hex FNV-1a 32-bit hash of version.
func ComputeVersionSegment(version string) string {
	return fnv32aHex(version)
}

// BuildDateSegment returns buildDate unchanged (already YYYYMMDD, 8 chars).
func BuildDateSegment(buildDate string) string {
	return buildDate
}

// ComputeIntegrity returns the 8-char lowercase hex FNV-1a 32-bit hash of
// instanceSeg+versionSeg+buildSeg concatenated with no separators.
func ComputeIntegrity(instanceSeg, versionSeg, buildSeg string) string {
	return fnv32aHex(instanceSeg + versionSeg + buildSeg)
}

// Compose assembles and returns the full ID string:
// instanceSeg-versionSeg-buildSeg-integritySeg
func Compose(instanceSeg, versionSeg, buildSeg string) string {
	integritySeg := ComputeIntegrity(instanceSeg, versionSeg, buildSeg)
	return fmt.Sprintf("%s-%s-%s-%s", instanceSeg, versionSeg, buildSeg, integritySeg)
}

// GetOrCreate reads "instance_segment" from app_state via the provided
// accessor functions. If absent, generates a new segment, stores it, and returns it.
func GetOrCreate(
	getAppState func(string) (string, error),
	setAppState func(string, string) error,
) (string, error) {
	existing, err := getAppState(instanceSegmentKey)
	if err != nil {
		return "", err
	}
	if existing != "" {
		return existing, nil
	}

	seg, err := GenerateInstanceSegment()
	if err != nil {
		return "", err
	}
	if err := setAppState(instanceSegmentKey, seg); err != nil {
		return "", err
	}
	return seg, nil
}

func fnv32aHex(s string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return fmt.Sprintf("%08x", h.Sum32())
}
