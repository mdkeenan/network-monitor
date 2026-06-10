package monitor

import (
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"connectwatch/internal/publicip"
)

var (
	rttPattern         = regexp.MustCompile(`(?i)time[=<]\s*(\d+)\s*ms`)
	pingFailurePhrases = []string{"timed out", "100% packet loss", "request timed out", "unreachable"}
)

func pingOutputIndicatesFailure(lower string) bool {
	for _, phrase := range pingFailurePhrases {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func pingHost(target string) (bool, *int, *int) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("ping", "-n", "1", "-w", "1000", target)
	default:
		cmd = exec.Command("ping", "-c", "1", "-W", "1", target)
	}
	configureHiddenCommand(cmd)

	out, err := cmd.CombinedOutput()
	text := string(out)
	lower := strings.ToLower(text)
	ttl := publicip.ParsePingTTL(text)
	if err != nil {
		if !strings.Contains(lower, "ttl=") && !strings.Contains(lower, "time=") {
			return false, nil, ttl
		}
	}

	if pingOutputIndicatesFailure(lower) {
		return false, nil, ttl
	}

	match := rttPattern.FindStringSubmatch(text)
	if len(match) < 2 {
		if strings.Contains(lower, "ttl=") {
			zero := 0
			return true, &zero, ttl
		}
		return false, nil, ttl
	}

	ms, err := strconv.Atoi(match[1])
	if err != nil {
		return true, nil, ttl
	}
	return true, &ms, ttl
}

// PingTargetNTimes sends count single-packet pings and returns how many succeeded.
func PingTargetNTimes(target string, count int) int {
	if count < 1 {
		return 0
	}
	successes := 0
	for i := 0; i < count; i++ {
		ok, _, _ := pingHost(target)
		if ok {
			successes++
		}
	}
	return successes
}

func traceroute(target string) (string, error) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("tracert", "-d", "-w", "1000", target)
	default:
		cmd = exec.Command("traceroute", "-n", "-w", "1", target)
	}
	configureHiddenCommand(cmd)

	out, err := cmd.CombinedOutput()
	text := string(out)
	if strings.TrimSpace(text) != "" {
		// Windows tracert often exits non-zero when the destination is unreachable
		// but still prints useful hop-by-hop output.
		return text, nil
	}
	if err != nil {
		return text, err
	}
	return text, nil
}
