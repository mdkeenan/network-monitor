package config

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
)

var (
	hostnamePattern = regexp.MustCompile(`^(?i:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?i:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$`)
	ipv4LikePattern = regexp.MustCompile(`^\d{1,3}(\.\d{1,3}){3}$`)
)

// NormalizeTarget strips common URL prefixes/suffixes from user input.
func NormalizeTarget(input string) string {
	s := strings.TrimSpace(input)
	if after, ok := strings.CutPrefix(s, "https://"); ok {
		s = after
	} else if after, ok := strings.CutPrefix(s, "http://"); ok {
		s = after
	}
	s = strings.TrimRight(s, "/")
	if before, _, ok := strings.Cut(s, "/"); ok {
		s = before
	}
	return strings.TrimSpace(s)
}

func isValidIPv4Literal(s string) bool {
	parts := strings.Split(s, ".")
	if len(parts) != 4 {
		return false
	}
	for _, part := range parts {
		if part == "" || len(part) > 3 {
			return false
		}
		for _, c := range part {
			if c < '0' || c > '9' {
				return false
			}
		}
		octet, err := strconv.Atoi(part)
		if err != nil || octet < 0 || octet > 255 {
			return false
		}
	}
	return true
}

// ValidateTarget normalizes and validates an IP address or hostname target.
func ValidateTarget(input string) (string, error) {
	normalized := NormalizeTarget(input)
	if normalized == "" {
		return "", fmt.Errorf("enter an IP address or hostname")
	}
	if len(normalized) > 253 {
		return "", fmt.Errorf("hostname is too long (maximum 253 characters)")
	}

	if ipv4LikePattern.MatchString(normalized) {
		if !isValidIPv4Literal(normalized) {
			return "", fmt.Errorf("each part of an IP address must be a number from 0 to 255")
		}
		return normalized, nil
	}

	if strings.Contains(normalized, ":") {
		ip := net.ParseIP(normalized)
		if ip == nil || ip.To4() != nil {
			return "", fmt.Errorf("enter a valid IPv6 address")
		}
		return normalized, nil
	}

	if !hostnamePattern.MatchString(normalized) {
		return "", fmt.Errorf("enter a valid hostname (for example google.com)")
	}
	return normalized, nil
}
