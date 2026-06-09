package publicip

import (
	"regexp"
	"strconv"
	"strings"
)

const ttlChangeThreshold = 5

var (
	ttlPattern   = regexp.MustCompile(`(?i)ttl\s*=\s*(\d+)`)
	traceHopLine = regexp.MustCompile(`(?m)^\s*\d+\s+`)
	traceHopIP   = regexp.MustCompile(`(\d{1,3}(?:\.\d{1,3}){3})`)
)

func ParsePingTTL(output string) *int {
	match := ttlPattern.FindStringSubmatch(output)
	if len(match) < 2 {
		return nil
	}
	ttl, err := parseInt(match[1])
	if err != nil {
		return nil
	}
	return &ttl
}

func TTLChangedSignificantly(baseline *int, ttl *int) bool {
	if ttl == nil {
		return false
	}
	if baseline == nil {
		return false
	}
	delta := *ttl - *baseline
	if delta < 0 {
		delta = -delta
	}
	return delta >= ttlChangeThreshold
}

func TracerouteFingerprint(output string) string {
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	hops := make([]string, 0, 8)
	for _, line := range lines {
		if !traceHopLine.MatchString(line) {
			continue
		}
		match := traceHopIP.FindString(line)
		if match != "" {
			hops = append(hops, match)
		}
	}
	return strings.Join(hops, ">")
}

func TracerouteChangedSignificantly(previous, current string) bool {
	prev := TracerouteFingerprint(previous)
	cur := TracerouteFingerprint(current)
	if prev == "" || cur == "" {
		return false
	}
	if prev == cur {
		return false
	}

	prevHops := strings.Split(prev, ">")
	curHops := strings.Split(cur, ">")
	if len(prevHops) == 0 || len(curHops) == 0 {
		return true
	}
	if prevHops[0] != curHops[0] {
		return true
	}
	if len(prevHops) != len(curHops) {
		if abs(len(prevHops)-len(curHops)) >= 2 {
			return true
		}
	}

	shared := min(len(prevHops), len(curHops))
	changed := 0
	for i := 0; i < shared; i++ {
		if prevHops[i] != curHops[i] {
			changed++
		}
	}
	changed += abs(len(prevHops) - len(curHops))
	if shared == 0 {
		return true
	}
	return float64(changed)/float64(shared) >= 0.25
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func parseInt(s string) (int, error) {
	return strconv.Atoi(s)
}
