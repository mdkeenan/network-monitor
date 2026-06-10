package server

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"fmt"
	"html"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"connectwatch/internal/database"
	"connectwatch/internal/publicip"
)

const exportRowLimit = 50_000_000

var (
	validExportFormats   = map[string]bool{"log": true, "csv": true, "md": true, "html": true}
	validExportDataTypes = map[string]bool{"pings": true, "events": true, "traceroutes": true, "speedtests": true}
	traceIPPattern       = regexp.MustCompile(`\b(\d{1,3}(?:\.\d{1,3}){3})\b`)
	traceMSPattern       = regexp.MustCompile(`(?i)(\d+)\s*ms`)
	traceHopPattern      = regexp.MustCompile(`^(\s*\d+)\s+`)
)

type exportPayload struct {
	From         time.Time
	To           time.Time
	Target       string
	Generated    time.Time
	Formats      []string
	DataTypes    []string
	Pings        []database.Ping
	Events       []database.Event
	Traceroutes  []database.Traceroute
	SpeedTests   []database.SpeedTest
	FromDate     string
	ToDate       string
}

type exportFile struct {
	Filename    string
	ContentType string
	Data        []byte
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}

	fromParam := r.URL.Query().Get("from")
	toParam := r.URL.Query().Get("to")
	if fromParam == "" || toParam == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("from and to are required"))
		return
	}

	from, err := parseTimeParam(fromParam)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid from: %w", err))
		return
	}
	to, err := parseTimeParam(toParam)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid to: %w", err))
		return
	}
	if !from.Before(to) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("from must be before to"))
		return
	}

	formats, err := parseExportList(r.URL.Query().Get("formats"), validExportFormats, "formats")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	dataTypes, err := parseExportList(r.URL.Query().Get("datatypes"), validExportDataTypes, "datatypes")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	payload, err := s.loadExportPayload(from, to, formats, dataTypes)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	files, err := buildExportFiles(payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("no export files generated"))
		return
	}

	if len(files) == 1 {
		file := files[0]
		w.Header().Set("Content-Type", file.ContentType)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, file.Filename))
		_, _ = w.Write(file.Data)
		return
	}

	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	for _, file := range files {
		entry, err := zw.Create(file.Filename)
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Errorf("create zip entry: %w", err))
			return
		}
		if _, err := entry.Write(file.Data); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Errorf("write zip entry: %w", err))
			return
		}
	}
	if err := zw.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("close zip: %w", err))
		return
	}

	zipName := fmt.Sprintf("connectwatch-export-%s-to-%s.zip", payload.FromDate, payload.ToDate)
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, zipName))
	_, _ = io.Copy(w, &zipBuf)
}

func parseExportList(raw string, allowed map[string]bool, label string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("%s is required", label)
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := make(map[string]bool)
	for _, part := range parts {
		part = strings.TrimSpace(strings.ToLower(part))
		if part == "" {
			continue
		}
		if !allowed[part] {
			return nil, fmt.Errorf("invalid %s value %q", label, part)
		}
		if seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s is required", label)
	}
	return out, nil
}

func (s *Server) loadExportPayload(from, to time.Time, formats, dataTypes []string) (exportPayload, error) {
	payload := exportPayload{
		From:      from.UTC(),
		To:        to.UTC(),
		Target:    s.monitor.Target(),
		Generated: time.Now().UTC(),
		Formats:   formats,
		DataTypes: dataTypes,
		FromDate:  from.UTC().Format("2006-01-02"),
		ToDate:    to.UTC().Format("2006-01-02"),
	}

	need := exportDataNeeds(dataTypes)
	var err error
	if need.pings {
		payload.Pings, err = s.db.ListPings(from, to, exportRowLimit)
		if err != nil {
			return payload, fmt.Errorf("load pings: %w", err)
		}
	}
	if need.events {
		payload.Events, err = s.db.ListEvents(from, to)
		if err != nil {
			return payload, fmt.Errorf("load events: %w", err)
		}
	}
	if need.traceroutes {
		payload.Traceroutes, err = s.db.ListTraceroutesByRange(from, to)
		if err != nil {
			return payload, fmt.Errorf("load traceroutes: %w", err)
		}
	}
	if need.speedtests {
		payload.SpeedTests, err = s.db.ListSpeedTests(from, to, exportRowLimit)
		if err != nil {
			return payload, fmt.Errorf("load speedtests: %w", err)
		}
	}
	return payload, nil
}

type exportDataNeed struct {
	pings, events, traceroutes, speedtests bool
}

func exportDataNeeds(dataTypes []string) exportDataNeed {
	var need exportDataNeed
	for _, dt := range dataTypes {
		switch dt {
		case "pings":
			need.pings = true
		case "events":
			need.events = true
		case "traceroutes":
			need.traceroutes = true
		case "speedtests":
			need.speedtests = true
		}
	}
	return need
}

func buildExportFiles(payload exportPayload) ([]exportFile, error) {
	files := make([]exportFile, 0)
	for _, format := range payload.Formats {
		switch format {
		case "log":
			files = append(files, exportFile{
				Filename:    fmt.Sprintf("connectwatch-export-%s-to-%s.log", payload.FromDate, payload.ToDate),
				ContentType: "text/plain; charset=utf-8",
				Data:        buildExportLog(payload),
			})
		case "md":
			files = append(files, exportFile{
				Filename:    fmt.Sprintf("connectwatch-export-%s-to-%s.md", payload.FromDate, payload.ToDate),
				ContentType: "text/markdown; charset=utf-8",
				Data:        buildExportMarkdown(payload),
			})
		case "html":
			files = append(files, exportFile{
				Filename:    fmt.Sprintf("connectwatch-export-%s-to-%s.html", payload.FromDate, payload.ToDate),
				ContentType: "text/html; charset=utf-8",
				Data:        buildExportHTML(payload),
			})
		case "csv":
			for _, dataType := range payload.DataTypes {
				name := fmt.Sprintf("connectwatch-%s-%s-to-%s.csv", dataType, payload.FromDate, payload.ToDate)
				data, err := buildExportCSV(payload, dataType)
				if err != nil {
					return nil, err
				}
				files = append(files, exportFile{
					Filename:    name,
					ContentType: "text/csv; charset=utf-8",
					Data:        data,
				})
			}
		}
	}
	return files, nil
}

func exportTS(ts time.Time) string {
	return ts.UTC().Format(time.RFC3339)
}

func exportEventTypeLabel(eventType string) string {
	switch eventType {
	case "failure_confirmed":
		return "Outage"
	case "recovered":
		return "Recovered"
	case "blip":
		return "Blip"
	case publicip.EventTypePublicIPChange:
		return "Public IP change"
	default:
		return eventType
	}
}

func buildExportLog(payload exportPayload) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "ConnectWatch Export\n")
	fmt.Fprintf(&b, "Range: %s to %s UTC\n", exportTS(payload.From), exportTS(payload.To))
	fmt.Fprintf(&b, "Target: %s\n", payload.Target)
	fmt.Fprintf(&b, "Generated: %s UTC\n", exportTS(payload.Generated))
	fmt.Fprintf(&b, "════════════════════════════════════════\n\n")

	needs := exportDataNeeds(payload.DataTypes)
	if needs.pings {
		if len(payload.Pings) == 0 {
			fmt.Fprintf(&b, "=== PING DATA ===\nNo data in this range\n\n")
		} else {
			fmt.Fprintf(&b, "=== PING DATA ===\n")
			for _, p := range payload.Pings {
				if p.OK && p.RTTMs != nil {
					fmt.Fprintf(&b, "[%s UTC] PING %s OK %dms\n", exportTS(p.TS), p.Target, *p.RTTMs)
				} else {
					fmt.Fprintf(&b, "[%s UTC] PING %s FAIL\n", exportTS(p.TS), p.Target)
				}
			}
			b.WriteString("\n")
		}
	}
	if needs.events {
		if len(payload.Events) == 0 {
			fmt.Fprintf(&b, "=== EVENTS ===\nNo data in this range\n\n")
		} else {
			fmt.Fprintf(&b, "=== EVENTS ===\n")
			for _, e := range payload.Events {
				duration := ""
				if e.DurationSec != nil {
					duration = fmt.Sprintf(" (%ds)", *e.DurationSec)
				}
				fmt.Fprintf(&b, "[%s UTC] %s — %s%s\n", exportTS(e.TS), exportEventTypeLabel(e.Type), e.Detail, duration)
			}
			b.WriteString("\n")
		}
	}
	if needs.speedtests {
		if len(payload.SpeedTests) == 0 {
			fmt.Fprintf(&b, "=== SPEED TESTS ===\nNo data in this range\n\n")
		} else {
			fmt.Fprintf(&b, "=== SPEED TESTS ===\n")
			for _, st := range payload.SpeedTests {
				fmt.Fprintf(&b, "[%s UTC] SPEEDTEST ↓%s Mbps ↑%s Mbps %sms latency\n",
					exportTS(st.TS),
					formatExportMbps(st.DownloadMbps),
					formatExportMbps(st.UploadMbps),
					formatExportLatency(st.LatencyMs),
				)
			}
			b.WriteString("\n")
		}
	}
	if needs.traceroutes {
		if len(payload.Traceroutes) == 0 {
			fmt.Fprintf(&b, "=== TRACEROUTES ===\nNo data in this range\n\n")
		} else {
			fmt.Fprintf(&b, "=== TRACEROUTES ===\n")
			for _, tr := range payload.Traceroutes {
				fmt.Fprintf(&b, "--- [%s] %s UTC ---\n%s\n\n", tr.Kind, exportTS(tr.TS), tr.Output)
			}
		}
	}
	return []byte(b.String())
}

func buildExportMarkdown(payload exportPayload) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "# ConnectWatch Export\n")
	fmt.Fprintf(&b, "**Range:** %s to %s UTC\n", exportTS(payload.From), exportTS(payload.To))
	fmt.Fprintf(&b, "**Target:** %s\n", payload.Target)
	fmt.Fprintf(&b, "**Generated:** %s UTC\n\n", exportTS(payload.Generated))

	needs := exportDataNeeds(payload.DataTypes)
	if needs.pings {
		fmt.Fprintf(&b, "## Ping Data\n")
		if len(payload.Pings) == 0 {
			fmt.Fprintf(&b, "No data in this range\n\n")
		} else {
			fmt.Fprintf(&b, "| Timestamp | Status | RTT (ms) | Target |\n|---|---|---|---|\n")
			for _, p := range payload.Pings {
				status := "FAIL"
				rtt := ""
				if p.OK {
					status = "OK"
					if p.RTTMs != nil {
						rtt = strconv.Itoa(*p.RTTMs)
					}
				}
				fmt.Fprintf(&b, "| %s | %s | %s | %s |\n", exportTS(p.TS), status, rtt, mdEscape(p.Target))
			}
			b.WriteString("\n")
		}
	}
	if needs.events {
		fmt.Fprintf(&b, "## Events\n")
		if len(payload.Events) == 0 {
			fmt.Fprintf(&b, "No data in this range\n\n")
		} else {
			fmt.Fprintf(&b, "| Timestamp | Type | Detail | Duration (s) |\n|---|---|---|---|\n")
			for _, e := range payload.Events {
				duration := ""
				if e.DurationSec != nil {
					duration = strconv.Itoa(*e.DurationSec)
				}
				fmt.Fprintf(&b, "| %s | %s | %s | %s |\n", exportTS(e.TS), mdEscape(exportEventTypeLabel(e.Type)), mdEscape(e.Detail), duration)
			}
			b.WriteString("\n")
		}
	}
	if needs.speedtests {
		fmt.Fprintf(&b, "## Speed Tests\n")
		if len(payload.SpeedTests) == 0 {
			fmt.Fprintf(&b, "No data in this range\n\n")
		} else {
			fmt.Fprintf(&b, "| Timestamp | Download (Mbps) | Upload (Mbps) | Latency (ms) |\n|---|---|---|---|\n")
			for _, st := range payload.SpeedTests {
				fmt.Fprintf(&b, "| %s | %s | %s | %s |\n",
					exportTS(st.TS),
					formatExportMbps(st.DownloadMbps),
					formatExportMbps(st.UploadMbps),
					formatExportLatency(st.LatencyMs),
				)
			}
			b.WriteString("\n")
		}
	}
	if needs.traceroutes {
		fmt.Fprintf(&b, "## Traceroutes\n")
		if len(payload.Traceroutes) == 0 {
			fmt.Fprintf(&b, "No data in this range\n\n")
		} else {
			for _, tr := range payload.Traceroutes {
				fmt.Fprintf(&b, "### [%s] %s UTC\n```\n%s\n```\n\n", tr.Kind, exportTS(tr.TS), tr.Output)
			}
		}
	}
	return []byte(b.String())
}

func buildExportHTML(payload exportPayload) []byte {
	needs := exportDataNeeds(payload.DataTypes)
	nav := make([]string, 0)
	if needs.pings {
		nav = append(nav, `<a href="#ping-data">Ping Data</a>`)
	}
	if needs.events {
		nav = append(nav, `<a href="#events">Events</a>`)
	}
	if needs.speedtests {
		nav = append(nav, `<a href="#speed-tests">Speed Tests</a>`)
	}
	if needs.traceroutes {
		nav = append(nav, `<a href="#traceroutes">Traceroutes</a>`)
	}

	var b strings.Builder
	b.WriteString("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">")
	b.WriteString("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">")
	b.WriteString("<title>ConnectWatch Export</title><style>")
	b.WriteString(`body{margin:0;background:#0f1117;color:#e2e8f0;font-family:Segoe UI,system-ui,sans-serif;line-height:1.5;}
header{padding:1.5rem 1.25rem 1rem;border-bottom:1px solid #243044;}
h1{margin:0 0 .5rem;font-size:1.6rem;}
.meta{color:#93a1b5;margin:.15rem 0;}
nav{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:.75rem;padding:.75rem 1.25rem;background:#1a2332;border-bottom:1px solid #243044;}
nav a{color:#60a5fa;text-decoration:none;}
main{padding:1.25rem;}
section{margin:0 0 2rem;}
h2{margin:0 0 .75rem;font-size:1.2rem;color:#8ec5ff;}
table{width:100%;border-collapse:collapse;margin-top:.5rem;}
th,td{border:1px solid #243044;padding:.45rem .6rem;text-align:left;vertical-align:top;}
th{background:#222d42;}
.empty{color:#93a1b5;font-style:italic;}
pre.trace-output{background:#1a2332;border:1px solid #243044;border-radius:8px;padding:.75rem;overflow:auto;white-space:pre-wrap;}
.trace-hop{color:#fbbf24;font-weight:600;}
.trace-ip{color:#60a5fa;}
.trace-ms{color:#3dd68c;}
.trace-star{color:#fbbf24;}
.trace-error{color:#ff6b6b;}
.trace-label{color:#93a1b5;}
.trace-ts{color:#93a1b5;}
.traceroute-block{margin:0 0 1.25rem;}
.traceroute-block h3{margin:0 0 .5rem;font-size:1rem;color:#e2e8f0;}`)
	b.WriteString("</style></head><body>")
	fmt.Fprintf(&b, "<header><h1>ConnectWatch Export</h1>")
	fmt.Fprintf(&b, "<p class=\"meta\"><strong>Range:</strong> %s to %s UTC</p>", html.EscapeString(exportTS(payload.From)), html.EscapeString(exportTS(payload.To)))
	fmt.Fprintf(&b, "<p class=\"meta\"><strong>Target:</strong> %s</p>", html.EscapeString(payload.Target))
	fmt.Fprintf(&b, "<p class=\"meta\"><strong>Generated:</strong> %s UTC</p></header>", html.EscapeString(exportTS(payload.Generated)))
	if len(nav) > 0 {
		b.WriteString("<nav>")
		b.WriteString(strings.Join(nav, ""))
		b.WriteString("</nav>")
	}
	b.WriteString("<main>")

	if needs.pings {
		b.WriteString("<section id=\"ping-data\"><h2>Ping Data</h2>")
		if len(payload.Pings) == 0 {
			b.WriteString("<p class=\"empty\">No data in this range</p>")
		} else {
			b.WriteString("<table><thead><tr><th>Timestamp</th><th>Status</th><th>RTT (ms)</th><th>Target</th></tr></thead><tbody>")
			for _, p := range payload.Pings {
				status := "FAIL"
				rtt := ""
				if p.OK {
					status = "OK"
					if p.RTTMs != nil {
						rtt = strconv.Itoa(*p.RTTMs)
					}
				}
				fmt.Fprintf(&b, "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>",
					html.EscapeString(exportTS(p.TS)), html.EscapeString(status), html.EscapeString(rtt), html.EscapeString(p.Target))
			}
			b.WriteString("</tbody></table>")
		}
		b.WriteString("</section>")
	}
	if needs.events {
		b.WriteString("<section id=\"events\"><h2>Events</h2>")
		if len(payload.Events) == 0 {
			b.WriteString("<p class=\"empty\">No data in this range</p>")
		} else {
			b.WriteString("<table><thead><tr><th>Timestamp</th><th>Type</th><th>Detail</th><th>Duration (s)</th></tr></thead><tbody>")
			for _, e := range payload.Events {
				duration := ""
				if e.DurationSec != nil {
					duration = strconv.Itoa(*e.DurationSec)
				}
				fmt.Fprintf(&b, "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>",
					html.EscapeString(exportTS(e.TS)), html.EscapeString(exportEventTypeLabel(e.Type)), html.EscapeString(e.Detail), html.EscapeString(duration))
			}
			b.WriteString("</tbody></table>")
		}
		b.WriteString("</section>")
	}
	if needs.speedtests {
		b.WriteString("<section id=\"speed-tests\"><h2>Speed Tests</h2>")
		if len(payload.SpeedTests) == 0 {
			b.WriteString("<p class=\"empty\">No data in this range</p>")
		} else {
			b.WriteString("<table><thead><tr><th>Timestamp</th><th>Download (Mbps)</th><th>Upload (Mbps)</th><th>Latency (ms)</th></tr></thead><tbody>")
			for _, st := range payload.SpeedTests {
				fmt.Fprintf(&b, "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>",
					html.EscapeString(exportTS(st.TS)),
					html.EscapeString(formatExportMbps(st.DownloadMbps)),
					html.EscapeString(formatExportMbps(st.UploadMbps)),
					html.EscapeString(formatExportLatency(st.LatencyMs)),
				)
			}
			b.WriteString("</tbody></table>")
		}
		b.WriteString("</section>")
	}
	if needs.traceroutes {
		b.WriteString("<section id=\"traceroutes\"><h2>Traceroutes</h2>")
		if len(payload.Traceroutes) == 0 {
			b.WriteString("<p class=\"empty\">No data in this range</p>")
		} else {
			for _, tr := range payload.Traceroutes {
				fmt.Fprintf(&b, "<div class=\"traceroute-block\"><h3>[%s] %s UTC</h3><pre class=\"trace-output\">%s</pre></div>",
					html.EscapeString(tr.Kind), html.EscapeString(exportTS(tr.TS)), highlightTracerouteHTML(tr.Output))
			}
		}
		b.WriteString("</section>")
	}

	b.WriteString("</main></body></html>")
	return []byte(b.String())
}

func buildExportCSV(payload exportPayload, dataType string) ([]byte, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)

	switch dataType {
	case "pings":
		_ = w.Write([]string{"timestamp", "ok", "rtt_ms", "target"})
		for _, p := range payload.Pings {
			rtt := ""
			if p.RTTMs != nil {
				rtt = strconv.Itoa(*p.RTTMs)
			}
			_ = w.Write([]string{exportTS(p.TS), strconv.FormatBool(p.OK), rtt, p.Target})
		}
	case "events":
		_ = w.Write([]string{"timestamp", "type", "detail", "duration_sec"})
		for _, e := range payload.Events {
			duration := ""
			if e.DurationSec != nil {
				duration = strconv.Itoa(*e.DurationSec)
			}
			_ = w.Write([]string{exportTS(e.TS), exportEventTypeLabel(e.Type), e.Detail, duration})
		}
	case "speedtests":
		_ = w.Write([]string{"timestamp", "download_mbps", "upload_mbps", "latency_ms", "download_bytes", "upload_bytes", "duration_sec", "server_url", "error"})
		for _, st := range payload.SpeedTests {
			_ = w.Write([]string{
				exportTS(st.TS),
				formatExportMbps(st.DownloadMbps),
				formatExportMbps(st.UploadMbps),
				formatExportLatency(st.LatencyMs),
				formatExportInt64(st.DownloadBytes),
				formatExportInt64(st.UploadBytes),
				formatExportFloat(st.DurationSec),
				st.ServerURL,
				st.Error,
			})
		}
	case "traceroutes":
		_ = w.Write([]string{"timestamp", "kind", "output"})
		for _, tr := range payload.Traceroutes {
			_ = w.Write([]string{exportTS(tr.TS), tr.Kind, tr.Output})
		}
	default:
		return nil, fmt.Errorf("unsupported csv datatype %q", dataType)
	}

	w.Flush()
	if err := w.Error(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func highlightTracerouteHTML(raw string) string {
	lines := strings.Split(raw, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		escaped := html.EscapeString(line)
		if escaped == "" {
			out = append(out, "")
			continue
		}
		lower := strings.ToLower(line)
		if strings.Contains(lower, "tracert") || strings.Contains(lower, "traceroute") || strings.Contains(lower, "tracing route") {
			out = append(out, `<span class="trace-label">`+escaped+`</span>`)
			continue
		}
		if strings.Contains(lower, "*") || strings.Contains(lower, "timed out") || strings.Contains(lower, "unreachable") ||
			strings.Contains(lower, "failed") || strings.Contains(lower, "could not") || strings.Contains(lower, "request timed out") ||
			strings.Contains(lower, "general failure") || strings.Contains(lower, "error") {
			out = append(out, `<span class="trace-error">`+applyTraceLineHighlightHTML(escaped)+`</span>`)
			continue
		}
		if traceHopPattern.MatchString(escaped) {
			escaped = traceHopPattern.ReplaceAllString(escaped, `<span class="trace-hop">$1</span> `)
		}
		out = append(out, applyTraceLineHighlightHTML(escaped))
	}
	return strings.Join(out, "\n")
}

func applyTraceLineHighlightHTML(line string) string {
	line = strings.ReplaceAll(line, "*", `<span class="trace-star">*</span>`)
	line = traceMSPattern.ReplaceAllString(line, `<span class="trace-ms">$1 ms</span>`)
	line = traceIPPattern.ReplaceAllString(line, `<span class="trace-ip">$1</span>`)
	return line
}

func formatExportMbps(v *float64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatFloat(*v, 'f', -1, 64)
}

func formatExportLatency(v *int) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(*v)
}

func formatExportInt64(v *int64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatInt(*v, 10)
}

func formatExportFloat(v *float64) string {
	if v == nil {
		return ""
	}
	if math.IsNaN(*v) || math.IsInf(*v, 0) {
		return ""
	}
	return strconv.FormatFloat(*v, 'f', -1, 64)
}

func mdEscape(s string) string {
	return strings.ReplaceAll(s, "|", "\\|")
}
