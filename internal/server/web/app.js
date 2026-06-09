let chart;
let uptimeChart;
const DEFAULT_RANGE = "24h";
const rangeSelect = document.getElementById("range-select");
const resetRangeBtn = document.getElementById("reset-range-btn");
const customRange = document.getElementById("custom-range");
const rangeFrom = document.getElementById("range-from");
const rangeTo = document.getElementById("range-to");
const applyRangeBtn = document.getElementById("apply-range-btn");
const rangeLiveBtn = document.getElementById("range-live-btn");
const rangePauseBtn = document.getElementById("range-pause-btn");
const rangeError = document.getElementById("range-error");
const rangeStatus = document.getElementById("range-status");

let activeChartRange = null;
let rangePlaybackActive = false;
let outageBands = [];
let blipBands = [];
let timelineGapIntervals = [];
let rttBaseline = null;
let rttBaselineLastFetched = 0;
let speedtestConfigCache = null;

const BLIP_MAX_SECONDS = 5;

// PALETTE — mirrors CSS custom properties in :root (style.css).
// All JS color literals must reference this object, not bare hex strings.
// When updating a color, change it here AND in the matching --token in :root.
const PALETTE = {
  ok: "#3dd68c",
  warn: "#fbbf24",
  bad: "#ff6b6b",
  accent: "#60a5fa",
  muted: "#93a1b5",
  rttExcellent: "#3dd68c",
  rttGood: "#86efac",
  rttAverage: "#fbbf24",
  rttPoor: "#f97316",
  rttBad: "#ff6b6b",
  speedtestDownload: "#60a5fa",
  speedtestUpload: "#34d399",
  chartGrid: "rgba(255,255,255,0.06)",
  chartTick: "#93a1b5",
  echoOk: "#bbf7d0",
  echoWarn: "#fde68a",
  echoBad: "#fca5a5",
  btnTextOnColor: "#081018",
  warnMuted: "#c8a84b",
};

const paletteRgba = (hex, alpha) => {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const RTT_THRESHOLDS = [
  { max: 10, label: "Excellent", color: PALETTE.rttExcellent },
  { max: 20, label: "Good", color: PALETTE.rttGood },
  { max: 40, label: "Average", color: PALETTE.rttAverage },
  { max: 100, label: "Poor", color: PALETTE.rttPoor },
  { max: Infinity, label: "Bad", color: PALETTE.rttBad },
];
const RTT_THRESHOLD_LINE_MS = [10, 20, 40, 100];

// Minimum ping count in the baseline window before relative thresholds activate.
// Below this count the system falls back to absolute thresholds only.
const RTT_BASELINE_MIN_PINGS = 300;

// How long to cache the baseline before re-fetching (24h average changes slowly).
const RTT_BASELINE_REFRESH_MS = 30 * 60 * 1000;

// Baseline window used to compute the reference average.
const RTT_BASELINE_WINDOW_H = 24;

// Relative multipliers: current RTT compared to baseline RTT → quality tier.
const RTT_RELATIVE_MULTIPLIERS = {
  excellent: 1.1,
  good: 1.5,
  average: 1.6,
  poor: 2.0,
};

// Returns the RTT quality tier for a given RTT in milliseconds.
// When baseline is valid: green ≤ 1.10×, yellow ≤ 1.50×, red > 1.50×.
// Falls back to yellow when baseline is invalid; null when ms is invalid.
function getRTTQuality(ms, baseline = null) {
  const rttMs = Number.parseFloat(ms);
  if (!Number.isFinite(rttMs)) return null;

  const yellowTier = RTT_THRESHOLDS[2];
  const baselineMs = Number.parseFloat(baseline);
  if (!Number.isFinite(baselineMs) || baselineMs <= 0) {
    return yellowTier;
  }

  if (rttMs <= baselineMs * RTT_RELATIVE_MULTIPLIERS.excellent) {
    return RTT_THRESHOLDS[0];
  }
  if (rttMs <= baselineMs * RTT_RELATIVE_MULTIPLIERS.good) {
    return yellowTier;
  }
  return RTT_THRESHOLDS[RTT_THRESHOLDS.length - 1];
}

async function fetchRTTBaseline() {
  try {
    const now = new Date();
    const from = new Date(now.getTime() - RTT_BASELINE_WINDOW_H * 60 * 60 * 1000);
    const data = await fetchJSON(`/api/summary${buildFromToParams(from, now)}`);
    if (
      data.total_pings >= RTT_BASELINE_MIN_PINGS &&
      data.avg_rtt_ms != null &&
      data.avg_rtt_ms > 0
    ) {
      return data.avg_rtt_ms;
    }
  } catch {
    // Silently ignore — baseline is best-effort; fall back to absolute
  }
  return null;
}

async function maybeRefreshRTTBaseline() {
  if (Date.now() - rttBaselineLastFetched < RTT_BASELINE_REFRESH_MS) return;
  rttBaselineLastFetched = Date.now();
  rttBaseline = await fetchRTTBaseline();
}

const applyRttQualityToCard = (valueEl, rttMs, formatValue, baseline = null, showBaseline = false) => {
  if (!valueEl) {
    return;
  }
  let label = valueEl.nextElementSibling;
  if (!label || !label.classList.contains("rtt-quality-label")) {
    label = document.createElement("span");
    label.className = "rtt-quality-label";
    valueEl.insertAdjacentElement("afterend", label);
  }
  let baselineLabel = null;
  if (showBaseline) {
    baselineLabel = label.nextElementSibling;
    if (!baselineLabel || !baselineLabel.classList.contains("rtt-baseline-label")) {
      baselineLabel = document.createElement("span");
      baselineLabel.className = "rtt-baseline-label";
      label.insertAdjacentElement("afterend", baselineLabel);
    }
  }
  const quality = getRTTQuality(rttMs, baseline);
  if (quality) {
    valueEl.textContent = formatValue(rttMs);
    valueEl.style.color = quality.color;
    label.textContent = quality.label;
    label.style.color = quality.color;
    label.hidden = false;
    if (baselineLabel) {
      baselineLabel.textContent =
        rttBaseline != null ? `Baseline ${Math.round(rttBaseline)}ms` : "Baseline: building…";
      baselineLabel.hidden = false;
    }
  } else {
    valueEl.textContent = "—";
    valueEl.style.color = "";
    label.textContent = "";
    label.style.color = "";
    label.hidden = true;
    if (baselineLabel) {
      baselineLabel.textContent = "";
      baselineLabel.hidden = true;
    }
  }
};

const UPTIME_LEGEND_COLORS = [PALETTE.ok, PALETTE.bad];
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Server spreads samples across the full range when the window exceeds this count.
const PING_FETCH_LIMIT = 15000;
const SPEEDTEST_FALLBACK_URL = "https://cachefly.cachefly.net/100mb.test";
const SPEEDTEST_UPLOAD_BYTES = 5_000_000;
const SPEEDTEST_TIMEOUT_MS = 30_000;
const SPEEDTEST_HISTORY_LIMIT = 500;
const SPEEDTEST_CHART_LAYERS = [
  { id: "download", label: "Download (Mbps)", color: PALETTE.speedtestDownload, datasetIndex: 0 },
  { id: "upload", label: "Upload (Mbps)", color: PALETTE.speedtestUpload, datasetIndex: 1 },
];
let speedtestChartLayerVisible = {
  download: true,
  upload: true,
};
const LINE_CHART_LAYERS = [
  {
    id: "ping",
    label: "Ping Delay (TTL ms)",
    color: UPTIME_LEGEND_COLORS[0],
    info:
      "Round-trip time from successful pings to the monitoring target. One sample is shown per second; gaps appear during outages and blips.",
  },
  {
    id: "outage",
    label: "Outage",
    color: PALETTE.bad,
    info:
      "A confirmed outage: a ping failed, the connection did not recover during the verify window, and downtime lasted longer than 5 seconds.",
  },
  {
    id: "blip",
    label: "Blip",
    color: PALETTE.warn,
    info:
      "A brief drop: the connection recovered within the verify window, or total downtime was 5 seconds or less.",
  },
];
let lineChartLayerVisible = {
  ping: true,
  outage: true,
  blip: true,
};
const TIMELINE_MIRROR_CHANNEL = "network-monitor-timeline-mirror";
const TIMELINE_MIRROR_STORAGE_KEY = "networkMonitor.timeline.mirror.v1";
const TIMELINE_POPOUT_QUERY = "view=timeline";
let timelineMirrorSyncPaused = false;
let timelineMirrorApplied = false;
let timelineMirrorChannel = null;
let pendingTimelineMirrorState = null;
const LINE_CHART_Y_MIN = 0;
const LINE_CHART_Y_FLOOR = 80;
const LINE_CHART_Y_STEP = 20;
const LINE_CHART_Y_HEADROOM = 1.12;

let lineChartYScaleState = { rangeKey: null, max: LINE_CHART_Y_FLOOR };

const chartTooltip = document.getElementById("chart-tooltip");
const lineChartLegendContainer = document.getElementById("line-chart-legend");
const speedtestChartLegendContainer = document.getElementById("speedtest-chart-legend");
const uptimeLegendContainer = document.getElementById("uptime-legend");
const uptimeChartWrap = document.getElementById("widget-pie-chart");
const logMetaEl = document.getElementById("log-meta");
const logDownloadWrap = document.getElementById("log-download-wrap");
const downloadDataBtn = document.getElementById("download-data-btn");
const downloadPanelOverlay = document.getElementById("download-panel-overlay");
const downloadRangeSelect = document.getElementById("download-range-select");
const downloadRangeFrom = document.getElementById("download-range-from");
const downloadRangeTo = document.getElementById("download-range-to");
const downloadSelectAllCheckbox = document.getElementById("download-select-all");
const downloadZipNoteEl = document.getElementById("download-zip-note");
const downloadErrorEl = document.getElementById("download-error");
const downloadPanelDownloadBtn = document.getElementById("download-panel-download-btn");
const downloadPanelCancelBtn = document.getElementById("download-panel-cancel-btn");
const DOWNLOAD_FORMAT_IDS = ["log", "csv", "md", "html"];
const DOWNLOAD_DATATYPE_IDS = ["pings", "events", "traceroutes", "speedtests"];
const EVENT_TYPE_LABELS = {
  failure_confirmed: "Outage",
  recovered: "Recovered",
  blip: "Blip",
  public_ip_change: "Public IP change",
};
const subtitlePrivateIpBtn = document.getElementById("subtitle-private-ip-btn");
const subtitlePrivateIpCopiedEl = document.getElementById("subtitle-private-ip-copied");
const subtitlePrivatePrefixBtn = document.getElementById("subtitle-private-prefix-btn");
const subtitlePrivatePrefixCopiedEl = document.getElementById("subtitle-private-prefix-copied");
const subtitlePrivateGatewayBtn = document.getElementById("subtitle-private-gateway-btn");
const subtitlePrivateGatewayCopiedEl = document.getElementById("subtitle-private-gateway-copied");
const subtitlePublicIpBtn = document.getElementById("subtitle-public-ip-btn");
const subtitlePublicIpCopiedEl = document.getElementById("subtitle-public-ip-copied");
const subtitlePublicIpIspEl = document.getElementById("subtitle-public-ip-isp");
const IP_COPY_SKIP = new Set(["Loading...", "Unavailable", "—", "/—", ""]);
const IP_COPIED_MESSAGE_MS = 1500;
const subtitleLoadingEl = document.getElementById("subtitle-loading");
const subtitleReadyEl = document.getElementById("subtitle-ready");
const subtitleTargetBtn = document.getElementById("subtitle-target-btn");
const subtitleTargetInfoEl = document.getElementById("subtitle-target-info");
const subtitleMetaEl = document.getElementById("subtitle-meta");
const subtitleErrorEl = document.getElementById("subtitle-error");
const SOURCE_IP_REFRESH_MS = 30 * 60 * 1000;
const IP_LOOKUP_REFRESH_MS = 24 * 60 * 60 * 1000;
let lastTargetInfoKey = "";
let previousFailureActive = null;
const statusPillEl = document.getElementById("status-pill");
const lastRttEl = document.getElementById("last-rtt");
const availabilityEl = document.getElementById("availability");
const avgRttEl = document.getElementById("avg-rtt");
const jitterMsEl = document.getElementById("jitter-ms");
const lastOutageEl = document.getElementById("last-outage");
const eventListEl = document.getElementById("event-list");
const deleteDataBtn = document.getElementById("delete-data-btn");
const deleteDataDialog = document.getElementById("delete-data-dialog");
const deleteDataConfirmBtn = document.getElementById("delete-data-confirm-btn");
const deleteDataCancelBtn = document.getElementById("delete-data-cancel-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsDialog = document.getElementById("settings-dialog");
const settingsTargetInput = document.getElementById("settings-target-input");
const settingsTargetPresetSelect = document.getElementById("settings-target-preset");
const settingsDefaultTargetBtn = document.getElementById("settings-default-target-btn");
const settingsAltTargetBtn = document.getElementById("settings-alt-target-btn");
const settingsWebPortInput = document.getElementById("settings-web-port-input");
const settingsDataDirInput = document.getElementById("settings-data-dir-input");
const settingsPickFolderBtn = document.getElementById("settings-pick-folder-btn");
const settingsRetentionDaysInput = document.getElementById("settings-retention-days-input");
const settingsTestingEl = document.getElementById("settings-testing");
const settingsUnreachableDialog = document.getElementById("settings-unreachable-dialog");
const settingsUnreachableTargetEl = document.getElementById("settings-unreachable-target");
const settingsUnreachableApplyBtn = document.getElementById("settings-unreachable-apply-btn");
const settingsUnreachableCancelBtn = document.getElementById("settings-unreachable-cancel-btn");
const settingsRetentionYearDialog = document.getElementById("settings-retention-year-dialog");
const settingsRetentionYearValueEl = document.getElementById("settings-retention-year-value");
const settingsRetentionYearApplyBtn = document.getElementById("settings-retention-year-apply-btn");
const settingsRetentionYearCancelBtn = document.getElementById("settings-retention-year-cancel-btn");
const settingsRetentionDataDialog = document.getElementById("settings-retention-data-dialog");
const settingsRetentionDataMessageEl = document.getElementById("settings-retention-data-message");
const settingsRetentionDataDeleteBtn = document.getElementById("settings-retention-data-delete-btn");
const settingsRetentionDataCancelBtn = document.getElementById("settings-retention-data-cancel-btn");
const settingsError = document.getElementById("settings-error");
const settingsApplyBtn = document.getElementById("settings-apply-btn");
const settingsCancelBtn = document.getElementById("settings-cancel-btn");
const settingsRestoreDefaultsBtn = document.getElementById("settings-restore-defaults-btn");
const settingsResetAppBtn = document.getElementById("settings-reset-app-btn");
const resetAppDialog = document.getElementById("reset-app-dialog");
const resetAppConfirmBtn = document.getElementById("reset-app-confirm-btn");
const resetAppCancelBtn = document.getElementById("reset-app-cancel-btn");
const settingsForm = document.getElementById("settings-form");
const settingsIpEchoBtn = document.getElementById("settings-ip-echo-btn");
const settingsAboutBtn = document.getElementById("settings-about-btn");
const settingsAutoCheckUpdatesInput = document.getElementById("settings-auto-check-updates-input");
const settingsCheckUpdatesBtn = document.getElementById("settings-check-updates-btn");
const settingsUpdatesStatusEl = document.getElementById("settings-updates-status");
const aboutDialog = document.getElementById("about-dialog");
const aboutVersionEl = document.getElementById("about-version");
const aboutSegInstanceEl = document.getElementById("about-seg-instance");
const aboutSegVersionEl = document.getElementById("about-seg-version");
const aboutSegBuildEl = document.getElementById("about-seg-build");
const aboutSegIntegrityEl = document.getElementById("about-seg-integrity");
const aboutInstanceCopyBtn = document.getElementById("about-instance-copy-btn");
const aboutCloseBtn = document.getElementById("about-close-btn");
const ipEchoDialog = document.getElementById("ip-echo-dialog");
const ipEchoProviderListEl = document.getElementById("ip-echo-provider-list");
const ipEchoLoadingEl = document.getElementById("ip-echo-loading");
const ipEchoErrorEl = document.getElementById("ip-echo-error");
const ipEchoCloseBtn = document.getElementById("ip-echo-close-btn");
const ipEchoDnsDialog = document.getElementById("ip-echo-dns-dialog");
const ipEchoDnsTitleEl = document.getElementById("ip-echo-dns-title");
const ipEchoDnsHostEl = document.getElementById("ip-echo-dns-host");
const ipEchoDnsListEl = document.getElementById("ip-echo-dns-list");
const ipEchoDnsEmptyEl = document.getElementById("ip-echo-dns-empty");
const ipEchoDnsCloseBtn = document.getElementById("ip-echo-dns-close-btn");
let ipEchoProvidersCache = [];
const traceHealthyMetaEl = document.getElementById("trace-healthy-meta");
const traceOutageMetaEl = document.getElementById("trace-outage-meta");
const traceHealthyOutputEl = document.getElementById("trace-healthy-output");
const traceOutageOutputEl = document.getElementById("trace-output");
const speedtestRunBtn = document.getElementById("speedtest-run-btn");
const speedtestCancelBtn = document.getElementById("speedtest-cancel-btn");
const speedtestStatusEl = document.getElementById("speedtest-status");
const speedtestDownloadValEl = document.getElementById("speedtest-download-val");
const speedtestUploadValEl = document.getElementById("speedtest-upload-val");
const speedtestLatencyValEl = document.getElementById("speedtest-latency-val");
const speedtestServerLabelEl = document.getElementById("speedtest-server-label");
const speedtestErrorEl = document.getElementById("speedtest-error");
const speedtestDataUsageEl = document.getElementById("speedtest-data-usage");
const speedtestGaugeTrackEl = document.getElementById("speedtest-gauge-track");
const speedtestGaugeProgressEl = document.getElementById("speedtest-gauge-progress");
const speedtestGaugeKnobEl = document.getElementById("speedtest-gauge-knob");
const speedtestGaugeValueEl = document.getElementById("speedtest-gauge-value");
const speedtestGaugePhaseTextEl = document.getElementById("speedtest-gauge-phase-text");
const speedtestGaugePhaseIconEl = document.getElementById("speedtest-gauge-phase-icon");
const speedtestGaugeDownloadEl = document.getElementById("speedtest-gauge-download");
const speedtestGaugeUploadEl = document.getElementById("speedtest-gauge-upload");
const speedtestGaugeDownloadLabelBtn = document.getElementById("speedtest-gauge-download-label");
const speedtestGaugeUploadLabelBtn = document.getElementById("speedtest-gauge-upload-label");
const speedtestGaugeTicksEl = document.getElementById("speedtest-gauge-ticks");

let speedtestChart = null;
let speedtestRunning = false;
let speedtestChartRangeKey = null;
let speedtestAbortController = null;
let speedtestGaugePhase = "idle";
let speedtestGaugeStoredDownload = null;
let speedtestGaugeStoredUpload = null;
let speedtestGaugeDisplayMode = "download";

const SPEEDTEST_GAUGE = { cx: 130, cy: 88, r: 74, startDeg: 140, sweepDeg: 260, labelRadius: 90 };
const SPEEDTEST_GAUGE_DEFAULT_MAX_MBPS = 100;
let speedtestGaugeMaxMbps = SPEEDTEST_GAUGE_DEFAULT_MAX_MBPS;

let traceIntervalSec = 30;
let healthyTraceIntervalSec = 300;
const TARGET_HOSTNAME_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;
const TARGET_IPV4_LIKE_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;
const TARGET_ALLOWED_CHARS_PATTERN = /^[a-zA-Z0-9.:-]+$/;
const DEFAULT_TARGET = "8.8.8.8";
const ALT_DEFAULT_TARGET = "8.8.1.1";
const MIN_RETENTION_DAYS = 1;
const RETENTION_YEAR_WARN_DAYS = 365;

const SETTINGS_FACTORY_DEFAULTS = {
  target: DEFAULT_TARGET,
  web_port: "8080",
  data_dir: "data",
  retention_days: "365",
  auto_check_updates: true,
};

const createDefaultSettingsDraft = () => ({ ...SETTINGS_FACTORY_DEFAULTS });

let pendingSettingsPayload = null;
let settingsDataCoverageDays = 0;
let settingsDraft = createDefaultSettingsDraft();
let lastUpdateCheckResult = null;
let autoUpdateCheckStarted = false;

const openDialog = (dialog) => toggleModalDialog(dialog, true);

const closeDialog = (dialog) => toggleModalDialog(dialog, false);

const applyTraceIntervalSettings = (data) => {
  if (typeof data.trace_interval_sec === "number") {
    traceIntervalSec = data.trace_interval_sec;
  }
  if (typeof data.healthy_trace_interval_sec === "number") {
    healthyTraceIntervalSec = data.healthy_trace_interval_sec;
  }
};

const settingsDraftFromApi = (data) => ({
  target: data.target || DEFAULT_TARGET,
  web_port: String(data.web_port ?? 8080),
  data_dir: data.data_dir || "data",
  retention_days: String(data.retention_days ?? 365),
  auto_check_updates: data.auto_check_updates !== false,
});

const restoreSettingsFormDefaults = () => {
  if (settingsTargetInput) {
    settingsTargetInput.value = SETTINGS_FACTORY_DEFAULTS.target;
  }
  if (settingsWebPortInput) {
    settingsWebPortInput.value = SETTINGS_FACTORY_DEFAULTS.web_port;
  }
  if (settingsDataDirInput) {
    settingsDataDirInput.value = SETTINGS_FACTORY_DEFAULTS.data_dir;
  }
  if (settingsRetentionDaysInput) {
    settingsRetentionDaysInput.value = SETTINGS_FACTORY_DEFAULTS.retention_days;
  }
  if (settingsAutoCheckUpdatesInput) {
    settingsAutoCheckUpdatesInput.checked = SETTINGS_FACTORY_DEFAULTS.auto_check_updates;
  }
  if (settingsTargetPresetSelect) {
    settingsTargetPresetSelect.value = "";
  }
  syncTargetPresetSelect();
  syncDefaultTargetButtonHighlight();
  setTargetInputValidity("");
  showSettingsError("");
};

const formatPresetLabel = (preset) => {
  const parts = [preset.country, preset.region, preset.city];
  const unique = parts.filter((part, index) => index === 0 || part !== parts[index - 1]);
  return unique.join(" · ");
};

const TARGET_PRESETS = [
  { id: "pacific-nw", country: "USA", region: "Washington", city: "Seattle", target: "140.142.16.2" },
  { id: "west-la", country: "USA", region: "California", city: "Los Angeles", target: "34.94.159.140" },
  { id: "mountain-ut", country: "USA", region: "Utah", city: "Salt Lake City", target: "34.106.208.213" },
  { id: "midwest-chi", country: "USA", region: "Illinois", city: "Chicago", target: "128.135.164.2" },
  { id: "east-cambridge", country: "USA", region: "Massachusetts", city: "Cambridge", target: "18.18.0.21" },
  { id: "east-dulles", country: "USA", region: "Virginia", city: "Dulles", target: "34.21.9.50" },
  { id: "gulf-austin", country: "USA", region: "Texas", city: "Austin", target: "128.83.40.141" },
  { id: "ca-toronto", country: "Canada", region: "Ontario", city: "Toronto", target: "34.130.107.20" },
  { id: "ca-vancouver", country: "Canada", region: "British Columbia", city: "Vancouver", target: "137.82.1.1" },
  { id: "br-saopaulo", country: "Brazil", region: "São Paulo", city: "São Paulo", target: "34.39.131.22" },
  { id: "uk-london", country: "United Kingdom", region: "England", city: "London", target: "35.242.177.6" },
  { id: "de-frankfurt", country: "Germany", region: "Hesse", city: "Frankfurt", target: "34.159.56.80" },
  { id: "nl-amsterdam", country: "Netherlands", region: "North Holland", city: "Amsterdam", target: "34.91.238.70" },
  { id: "fi-hamina", country: "Finland", region: "Kymenlaakso", city: "Hamina", target: "35.228.243.201" },
  { id: "fr-paris", country: "France", region: "Île-de-France", city: "Paris", target: "13.36.154.207" },
  { id: "it-milan", country: "Italy", region: "Lombardy", city: "Milan", target: "34.154.170.5" },
  { id: "jp-tokyo", country: "Japan", region: "Tokyo", city: "Tokyo", target: "34.84.123.12" },
  { id: "jp-osaka", country: "Japan", region: "Osaka", city: "Osaka", target: "13.208.89.86" },
  { id: "au-sydney", country: "Australia", region: "New South Wales", city: "Sydney", target: "34.40.137.12" },
  { id: "au-melbourne", country: "Australia", region: "Victoria", city: "Melbourne", target: "16.26.200.71" },
  { id: "sg-singapore", country: "Singapore", region: "Singapore", city: "Singapore", target: "34.124.137.169" },
  { id: "hk-hongkong", country: "China", region: "Hong Kong", city: "Hong Kong", target: "34.92.96.4" },
  { id: "tw-taiwan", country: "Taiwan", region: "Taiwan", city: "Taipei", target: "104.199.223.119" },
  { id: "kr-seoul", country: "South Korea", region: "Seoul", city: "Seoul", target: "43.200.31.191" },
  { id: "in-mumbai", country: "India", region: "Maharashtra", city: "Mumbai", target: "43.204.105.75" },
  { id: "za-capetown", country: "South Africa", region: "Western Cape", city: "Cape Town", target: "13.246.114.251" },
  { id: "ae-dubai", country: "UAE", region: "Dubai", city: "Dubai", target: "20.74.211.96" },
];

let uptimeChartTooltip = null;
let uptimeLegendEventsBound = false;

const tsMs = (value) => new Date(value).getTime();

const escapeHtml = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const parsePresetRange = (value) => {
  const match = String(value).match(/^(\d+)(m|h)$/);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return {
    amount,
    unit,
    ms: unit === "m" ? amount * MS_PER_MINUTE : amount * MS_PER_HOUR,
  };
};

const splitDurationParts = (totalSec) => {
  const sec = Math.max(0, Math.round(totalSec));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return { hours, minutes, seconds };
};

const sumDatasetValues = (data) => {
  return data.reduce((sum, value) => sum + value, 0);
};

const getUptimeShare = (value, dataset) => {
  const total = sumDatasetValues(dataset.data);
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
  return { total, pct };
};

const hideTooltip = (element) => {
  if (!element) return;
  element.hidden = true;
  element.innerHTML = "";
};

const positionTooltip = (element, wrap, clientX, clientY) => {
  if (!element || !wrap) return;

  const wrapRect = wrap.getBoundingClientRect();
  let left = clientX - wrapRect.left + 12;
  let top = clientY - wrapRect.top + 12;

  element.hidden = false;

  const tipRect = element.getBoundingClientRect();
  left = Math.max(8, Math.min(left, wrapRect.width - tipRect.width - 8));
  top = Math.max(8, Math.min(top, wrapRect.height - tipRect.height - 8));

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
};

const showTooltipHtml = (element, wrap, html, clientX, clientY) => {
  if (!element) return;
  element.innerHTML = html;
  positionTooltip(element, wrap, clientX, clientY);
};

const formatDuration = (start, end) => {
  const { hours, minutes, seconds } = splitDurationParts((end.getTime() - start.getTime()) / 1000);
  return `${hours} hours, ${minutes} minutes, ${seconds} seconds`;
};

const formatBlipDuration = (band) => {
  const sec = band.durationSec ?? 0;
  const rounded = Math.round(sec * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return text === "1" ? "1 second" : `${text} seconds`;
};

const findFirstIndexAtOrAfterTime = (sortedItems, minMs) => {
  let lo = 0;
  let hi = sortedItems.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tsMs(sortedItems[mid].ts) < minMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
};

const enrichBlipBandsFromPings = (bands, sortedPings) => {
  return bands.map((band) => {
    const startMs = band.start.getTime();
    const endMs = band.end.getTime();
    const windowStart = startMs - 1000;
    const windowEnd = Math.max(endMs, startMs) + 12000;
    let failCount = 0;
    let firstFail = null;
    let recovery = null;

    for (let i = findFirstIndexAtOrAfterTime(sortedPings, windowStart); i < sortedPings.length; i++) {
      const ping = sortedPings[i];
      const pingMs = tsMs(ping.ts);
      if (pingMs > windowEnd) {
        break;
      }

      if (!ping.ok) {
        failCount++;
        if (!firstFail) {
          firstFail = new Date(ping.ts);
        }
      } else if (firstFail && pingMs > firstFail.getTime() && !recovery) {
        recovery = new Date(ping.ts);
      }
    }

    const start = firstFail || band.start;
    const end = recovery || band.end;
    let durationSec = Math.max(0, (end.getTime() - start.getTime()) / 1000);
    if (durationSec === 0 && failCount > 0) {
      durationSec = failCount;
    }

    return { start, end, failCount, durationSec };
  });
};

const getBandPixelRange = (chart, band) => {
  const { chartArea, scales } = chart;
  const x1 = scales.x.getPixelForValue(band.start.getTime());
  const x2 = scales.x.getPixelForValue(band.end.getTime());
  let left = Math.max(x1, chartArea.left);
  let right = Math.min(x2, chartArea.right);
  ({ left, right } = clampBandPixelSpan(left, right));
  return { left, right, top: chartArea.top, bottom: chartArea.bottom };
};

const clampBandPixelSpan = (left, right, minWidth = 3) => {
  const width = right - left;
  if (width >= minWidth) {
    return { left, right };
  }
  const center = (left + right) / 2;
  const half = minWidth / 2;
  return { left: center - half, right: center + half };
};

const hitTestTimeline = (chart, x, y) => {
  const { chartArea } = chart;
  if (
    !chartArea ||
    x < chartArea.left ||
    x > chartArea.right ||
    y < chartArea.top ||
    y > chartArea.bottom
  ) {
    return null;
  }

  for (const band of blipBands) {
    if (!lineChartLayerVisible.blip) {
      break;
    }
    const range = getBandPixelRange(chart, band);
    if (x >= range.left && x <= range.right) {
      return { type: "blip", band };
    }
  }

  for (const band of outageBands) {
    if (!lineChartLayerVisible.outage) {
      break;
    }
    const range = getBandPixelRange(chart, band);
    if (x >= range.left && x <= range.right) {
      return { type: "outage", band };
    }
  }

  return null;
};

const buildBandTooltip = (type, band) => {
  const start = band.start;
  const end = band.end;
  const ongoing = type === "outage" && end.getTime() >= Date.now() - 2000;
  const endTime = ongoing ? new Date() : end;
  const title = type === "outage" ? "Outage" : "Blip";
  const endText = ongoing ? `${fmtTime(endTime)} (ongoing)` : fmtTime(end);

  let durationLine =
    type === "blip"
      ? `Duration: ${formatBlipDuration(band)}`
      : `Duration: ${formatDuration(start, endTime)}`;

  if (type === "blip" && band.failCount > 0) {
    durationLine += `<br>Failed pings: ${band.failCount}`;
  }

  return (
    `<div class="tooltip-${type}">` +
    `<strong>${title}</strong>` +
    `From: ${fmtTime(start)}<br>` +
    `To: ${endText}<br>` +
    durationLine +
    `</div>`
  );
};

const hideChartTooltip = () => {
  hideTooltip(chartTooltip);
};

const showChartTooltip = (html, eventX, eventY) => {
  if (!chartTooltip || !chart) {
    return;
  }

  const wrap = chart.canvas.closest(".chart-wrap");
  const canvasRect = chart.canvas.getBoundingClientRect();
  showTooltipHtml(
    chartTooltip,
    wrap,
    html,
    eventX + canvasRect.left,
    eventY + canvasRect.top
  );
};

const drawTimelineBandsIfVisible = (chart, bands, layerId, colors) => {
  if (!lineChartLayerVisible[layerId]) {
    return;
  }
  drawTimelineBands(chart, bands, colors);
};

const drawRttThresholdLines = (chart) => {
  if (!lineChartLayerVisible.ping) {
    return;
  }
  const { ctx, chartArea, scales } = chart;
  if (!scales.y || !chartArea) {
    return;
  }

  const yMax = scales.y.max;
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1;

  for (const ms of RTT_THRESHOLD_LINE_MS) {
    if (ms > yMax) {
      continue;
    }
    const threshold = RTT_THRESHOLDS.find((t) => t.max === ms);
    if (!threshold) {
      continue;
    }
    const y = scales.y.getPixelForValue(ms);
    if (y < chartArea.top || y > chartArea.bottom) {
      continue;
    }
    ctx.strokeStyle = paletteRgba(threshold.color, 0.2);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
};

const drawTimelineBands = (chart, bands, colors) => {
  const { ctx, chartArea, scales } = chart;
  if (!scales.x || !chartArea || bands.length === 0) {
    return;
  }

  for (const band of bands) {
    const x1 = scales.x.getPixelForValue(band.start.getTime());
    const x2 = scales.x.getPixelForValue(band.end.getTime());
    if (x2 < chartArea.left || x1 > chartArea.right) {
      continue;
    }

    const { left, right, top, bottom } = getBandPixelRange(chart, band);
    const width = right - left;
    if (width <= 0) {
      continue;
    }

    ctx.fillStyle = colors.fill;
    ctx.fillRect(left, top, width, bottom - top);

    ctx.fillStyle = colors.bar;
    ctx.fillRect(left, bottom - 6, width, 6);
  }
};

const timelineBandPlugin = {
  id: "timelineBands",
  beforeDatasetsDraw(chart) {
    const { chartArea } = chart;
    if (!chartArea) {
      return;
    }

    chart.ctx.save();
    drawTimelineBandsIfVisible(chart, outageBands, "outage", {
      fill: paletteRgba(PALETTE.bad, 0.18),
      bar: paletteRgba(PALETTE.bad, 0.65),
    });
    chart.ctx.restore();
  },
  afterDatasetsDraw(chart) {
    const { chartArea } = chart;
    if (!chartArea) {
      return;
    }

    chart.ctx.save();
    drawTimelineBandsIfVisible(chart, blipBands, "blip", {
      fill: paletteRgba(PALETTE.warn, 0.18),
      bar: paletteRgba(PALETTE.warn, 0.65),
    });
    chart.ctx.restore();
  },
  afterDraw(chart) {
    const { chartArea } = chart;
    if (!chartArea) {
      return;
    }
    chart.ctx.save();
    drawRttThresholdLines(chart);
    chart.ctx.restore();
  },
  afterEvent(chart, args) {
    const event = args.event;
    if (!event) {
      return;
    }

    if (event.type === "mouseout") {
      hideChartTooltip();
      chart.canvas.style.cursor = "default";
      return;
    }

    if (event.type === "click") {
      const hit = hitTestTimeline(chart, event.x, event.y);
      if (hit && (hit.type === "outage" || hit.type === "blip")) {
        zoomChartRangeToBand(hit.band).catch(handleRefreshError);
      }
      return;
    }

    if (event.type !== "mousemove") {
      return;
    }

    const hit = hitTestTimeline(chart, event.x, event.y);
    if (!hit) {
      hideChartTooltip();
      chart.canvas.style.cursor = "default";
      return;
    }

    chart.canvas.style.cursor = "pointer";
    showChartTooltip(buildBandTooltip(hit.type, hit.band), event.x, event.y);
  },
};

const fmtTime = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
};

const fmtRTT = (ms) => {
  if (ms == null) return "—";
  return `${ms} ms`;
};

const toDatetimeLocalValue = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const setDefaultCustomRange = () => {
  const to = new Date();
  const from = new Date(to.getTime() - MS_PER_DAY);
  rangeTo.value = toDatetimeLocalValue(to);
  rangeFrom.value = toDatetimeLocalValue(from);
};

const presetRangeMs = (value) => {
  return parsePresetRange(value)?.ms ?? MS_PER_DAY;
};

const getSelectedRangeSpanMs = () => {
  if (rangeSelect.value === "custom") {
    if (rangeFrom.value && rangeTo.value) {
      try {
        const { from, to } = getCustomRangeDates();
        return Math.max(MS_PER_MINUTE, to.getTime() - from.getTime());
      } catch {
        return MS_PER_DAY;
      }
    }
    return MS_PER_DAY;
  }
  return presetRangeMs(rangeSelect.value);
};

const isTimelinePopoutView = () =>
  new URLSearchParams(window.location.search).get("view") === "timeline";

const collectTimelineMirrorState = () => ({
  rangeSelect: rangeSelect?.value ?? DEFAULT_RANGE,
  rangeFrom: rangeFrom?.value ?? "",
  rangeTo: rangeTo?.value ?? "",
  rangePlaybackActive,
  lineChartLayerVisible: { ...lineChartLayerVisible },
});

const publishTimelineMirrorState = () => {
  if (timelineMirrorSyncPaused || !rangeSelect) {
    return;
  }
  const state = collectTimelineMirrorState();
  try {
    localStorage.setItem(TIMELINE_MIRROR_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
  timelineMirrorChannel?.postMessage(state);
};

const applyTimelineMirrorState = (state, { skipPublish = false, skipRefresh = false } = {}) => {
  if (!state || !rangeSelect) {
    return;
  }
  timelineMirrorSyncPaused = true;
  try {
    if (typeof state.rangeSelect === "string") {
      rangeSelect.value = state.rangeSelect;
    }
    if (rangeFrom && typeof state.rangeFrom === "string") {
      rangeFrom.value = state.rangeFrom;
    }
    if (rangeTo && typeof state.rangeTo === "string") {
      rangeTo.value = state.rangeTo;
    }
    if (state.lineChartLayerVisible && typeof state.lineChartLayerVisible === "object") {
      for (const layerId of Object.keys(lineChartLayerVisible)) {
        if (typeof state.lineChartLayerVisible[layerId] === "boolean") {
          lineChartLayerVisible[layerId] = state.lineChartLayerVisible[layerId];
        }
      }
    }
    setRangePlaybackActive(Boolean(state.rangePlaybackActive), { skipWindowUpdate: true });
    updateCustomRangeVisibility();
    if (rangeFrom?.value && rangeTo?.value) {
      try {
        const { from, to } = getCustomRangeDates();
        activeChartRange = { min: from, max: to };
      } catch {
        activeChartRange = null;
      }
    }
    renderLineChartLegend();
    applyLineChartLayerVisibility({ skipMirror: true });
    timelineMirrorApplied = true;
  } finally {
    timelineMirrorSyncPaused = false;
  }
  if (!skipPublish) {
    publishTimelineMirrorState();
  }
  if (!skipRefresh) {
    refreshAll().catch(handleRefreshError);
  }
};

const initTimelineMirrorSync = () => {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }
  timelineMirrorChannel = new BroadcastChannel(TIMELINE_MIRROR_CHANNEL);
  timelineMirrorChannel.onmessage = (event) => {
    applyTimelineMirrorState(event.data, { skipPublish: true });
  };
};

const initTimelinePopoutView = () => {
  if (!isTimelinePopoutView()) {
    return;
  }
  document.body.classList.add("timeline-popout-view");
  document.title = "Network Status Timeline — Network Monitor";
  try {
    const raw = localStorage.getItem(TIMELINE_MIRROR_STORAGE_KEY);
    if (raw) {
      pendingTimelineMirrorState = JSON.parse(raw);
    }
  } catch {
    // Ignore invalid stored mirror state.
  }
};

const applyPendingTimelineMirrorState = () => {
  if (!pendingTimelineMirrorState) {
    return;
  }
  const state = pendingTimelineMirrorState;
  pendingTimelineMirrorState = null;
  applyTimelineMirrorState(state, { skipPublish: true, skipRefresh: true });
};

const TIMELINE_POPOUT_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.25H3.75A1.25 1.25 0 0 0 2.5 3.5v9A1.25 1.25 0 0 0 3.75 13.75H11a1.25 1.25 0 0 0 1.25-1.25V9M9.5 2.5H13.5V6.5M13.5 2.5L7 9" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const openTimelinePopoutTab = () => {
  publishTimelineMirrorState();
  const url = `${window.location.origin}${window.location.pathname}?${TIMELINE_POPOUT_QUERY}`;
  window.open(url, "_blank", "noopener");
};

const installLineChartPopoutButton = () => {
  if (isTimelinePopoutView()) {
    return;
  }
  const widget = document.getElementById("widget-line-chart");
  if (!widget || widget.querySelector(".widget-popout")) {
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "widget-popout";
  button.setAttribute("aria-label", "Open Network Status Timeline in new tab");
  button.title = "Open in new tab";
  button.innerHTML = TIMELINE_POPOUT_ICON;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openTimelinePopoutTab();
  });
  widget.appendChild(button);
};

const configureTimelinePopoutCloseButton = () => {
  if (!isTimelinePopoutView()) {
    return;
  }
  const widget = document.getElementById("widget-line-chart");
  const closeBtn = widget?.querySelector(".widget-close");
  if (!closeBtn) {
    return;
  }
  const replacement = closeBtn.cloneNode(true);
  replacement.setAttribute("aria-label", "Close timeline tab");
  replacement.title = "Close tab";
  closeBtn.replaceWith(replacement);
  replacement.addEventListener("click", (event) => {
    event.preventDefault();
    window.close();
  });
};

const setChartRangeWindow = (from, to) => {
  rangeFrom.value = toDatetimeLocalValue(from);
  rangeTo.value = toDatetimeLocalValue(to);
  activeChartRange = { min: from, max: to };
  publishTimelineMirrorState();
};

const freezeChartRangeWindow = () => {
  let from;
  let to;

  if (rangeFrom.value && rangeTo.value) {
    try {
      ({ from, to } = getCustomRangeDates());
    } catch {
      const spanMs =
        rangeSelect.value === "custom" ? MS_PER_DAY : presetRangeMs(rangeSelect.value);
      to = new Date();
      from = new Date(to.getTime() - spanMs);
    }
  } else {
    const spanMs =
      rangeSelect.value === "custom" ? MS_PER_DAY : presetRangeMs(rangeSelect.value);
    to = new Date();
    from = new Date(to.getTime() - spanMs);
  }

  rangeSelect.value = "custom";
  setChartRangeWindow(from, to);
  updateRangeStatus(`Custom: ${from.toLocaleString()} to ${to.toLocaleString()}`);
};

const advanceChartRangeWindow = () => {
  const to = new Date();
  const from = new Date(to.getTime() - getSelectedRangeSpanMs());
  setChartRangeWindow(from, to);
};

const updateRangePlaybackUI = () => {
  if (rangeLiveBtn) {
    rangeLiveBtn.classList.toggle("is-active", rangePlaybackActive);
    rangeLiveBtn.setAttribute("aria-pressed", rangePlaybackActive ? "true" : "false");
  }
  if (rangePauseBtn) {
    rangePauseBtn.classList.toggle("is-active", !rangePlaybackActive);
    rangePauseBtn.setAttribute("aria-pressed", !rangePlaybackActive ? "true" : "false");
  }
};

const setRangePlaybackActive = (active, { skipWindowUpdate = false } = {}) => {
  rangePlaybackActive = active;
  updateRangePlaybackUI();
  updateCustomRangeVisibility();
  if (skipWindowUpdate) {
    publishTimelineMirrorState();
    return;
  }
  if (active) {
    advanceChartRangeWindow();
  } else {
    freezeChartRangeWindow();
  }
  publishTimelineMirrorState();
};

const showRangeError = (message) => {
  if (!message) {
    rangeError.hidden = true;
    rangeError.textContent = "";
    return;
  }
  rangeError.hidden = false;
  rangeError.textContent = message;
};

const updateCustomRangeVisibility = () => {
  const showCustomInputs = rangeSelect.value === "custom" || rangePlaybackActive;
  customRange.hidden = !showCustomInputs;
  if (rangeSelect.value === "custom" && !rangeFrom.value && !rangeTo.value) {
    setDefaultCustomRange();
  }
  requestAnimationFrame(() => {
    window.WidgetDashboard?.refitContentSizedWidgets?.();
  });
};

const applyDefaultRangeFromDataBounds = (status) => {
  activeChartRange = null;
  resetLineChartYScale();
  showRangeError("");

  const oldest = status?.oldest_ping_at ? new Date(status.oldest_ping_at) : null;
  const newest = status?.newest_ping_at ? new Date(status.newest_ping_at) : null;

  if (!oldest || !newest || Number.isNaN(oldest.getTime()) || Number.isNaN(newest.getTime())) {
    rangeSelect.value = DEFAULT_RANGE;
    customRange.hidden = true;
    updateRangeStatus("");
    return;
  }

  let from = oldest;
  let to = newest;
  if (to.getTime() <= from.getTime()) {
    to = new Date(from.getTime() + MS_PER_MINUTE);
  }

  const dataSpanMs = to.getTime() - from.getTime();
  if (dataSpanMs >= MS_PER_DAY) {
    rangeSelect.value = DEFAULT_RANGE;
    customRange.hidden = true;
    updateRangeStatus("");
    return;
  }

  rangeSelect.value = "custom";
  rangeFrom.value = toDatetimeLocalValue(from);
  rangeTo.value = toDatetimeLocalValue(to);
  customRange.hidden = false;
};

const initializeDefaultRange = async () => {
  if (timelineMirrorApplied) {
    updateCustomRangeVisibility();
    return;
  }
  try {
    const status = await fetchJSON("/api/status");
    applyDefaultRangeFromDataBounds(status);
  } catch {
    rangeSelect.value = DEFAULT_RANGE;
    customRange.hidden = true;
    updateRangeStatus("");
  }
  updateCustomRangeVisibility();
  freezeChartRangeWindow();
};

const resetRangeControls = async () => {
  rangePlaybackActive = false;
  updateRangePlaybackUI();
  await initializeDefaultRange();
};

const parseDatetimeLocalInput = (input) => {
  const value = input.value.trim();
  if (!value) {
    return null;
  }

  // datetime-local values are always YYYY-MM-DDTHH:mm in the value property.
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, year, month, day, hour, minute, second = "0"] = match;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      0
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (input.valueAsDate instanceof Date && !Number.isNaN(input.valueAsDate.getTime())) {
    return input.valueAsDate;
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const getCustomRangeDates = () => {
  if (!rangeFrom.value || !rangeTo.value) {
    throw new Error("Enter a start and end time for the custom range.");
  }

  const from = parseDatetimeLocalInput(rangeFrom);
  const toStart = parseDatetimeLocalInput(rangeTo);
  if (!from || !toStart) {
    throw new Error(
      `Custom range times are not valid. From="${rangeFrom.value}" To="${rangeTo.value}"`
    );
  }

  const to = new Date(toStart.getTime());
  to.setSeconds(59, 999);

  if (from >= to) {
    throw new Error("Custom range start must be before the end time.");
  }

  return { from, to };
};

const getDownloadCheckbox = (prefix, id) => document.getElementById(`${prefix}-${id}`);

const getCheckedDownloadFormats = () =>
  DOWNLOAD_FORMAT_IDS.filter((id) => getDownloadCheckbox("download-format", id)?.checked);

const getCheckedDownloadDatatypes = () =>
  DOWNLOAD_DATATYPE_IDS.filter((id) => getDownloadCheckbox("download-datatype", id)?.checked);

const countExportFiles = (formats, datatypes) => {
  let count = 0;
  if (formats.includes("log")) count += 1;
  if (formats.includes("md")) count += 1;
  if (formats.includes("html")) count += 1;
  if (formats.includes("csv")) count += datatypes.length;
  return count;
};

const setDownloadPanelRangeWindow = (from, to) => {
  if (downloadRangeFrom) downloadRangeFrom.value = toDatetimeLocalValue(from);
  if (downloadRangeTo) downloadRangeTo.value = toDatetimeLocalValue(to);
};

const applyDownloadPanelPreset = () => {
  if (!downloadRangeSelect || downloadRangeSelect.value === "custom") {
    return;
  }
  const preset = parsePresetRange(downloadRangeSelect.value);
  if (!preset) {
    return;
  }
  const to = new Date();
  const from = new Date(to.getTime() - preset.ms);
  setDownloadPanelRangeWindow(from, to);
};

const getDownloadPanelRangeISO = () => {
  if (downloadRangeSelect && downloadRangeSelect.value !== "custom") {
    applyDownloadPanelPreset();
  }
  if (!downloadRangeFrom?.value || !downloadRangeTo?.value) {
    throw new Error("Select a valid From and To range.");
  }
  const fromLocal = new Date(downloadRangeFrom.value);
  const toLocal = new Date(downloadRangeTo.value);
  if (Number.isNaN(fromLocal.getTime()) || Number.isNaN(toLocal.getTime())) {
    throw new Error("Select a valid From and To range.");
  }
  if (fromLocal >= toLocal) {
    throw new Error("Range start must be before the end time.");
  }
  const fromISO = fromLocal.toISOString();
  const toISO = toLocal.toISOString();
  return { from: fromISO, to: toISO };
};

const showDownloadValidationError = (message) => {
  if (!downloadErrorEl) {
    return;
  }
  if (!message) {
    downloadErrorEl.hidden = true;
    downloadErrorEl.textContent = "";
    return;
  }
  downloadErrorEl.hidden = false;
  downloadErrorEl.textContent = message;
};

const updateDownloadZipNote = () => {
  if (!downloadZipNoteEl) {
    return;
  }
  const formats = getCheckedDownloadFormats();
  const datatypes = getCheckedDownloadDatatypes();
  const showZip = countExportFiles(formats, datatypes) > 1;
  downloadZipNoteEl.hidden = !showZip;
};

const setDownloadSelectAllChecked = (checked) => {
  for (const id of DOWNLOAD_FORMAT_IDS) {
    const el = getDownloadCheckbox("download-format", id);
    if (el) el.checked = checked;
  }
  for (const id of DOWNLOAD_DATATYPE_IDS) {
    const el = getDownloadCheckbox("download-datatype", id);
    if (el) el.checked = checked;
  }
  if (downloadSelectAllCheckbox) {
    downloadSelectAllCheckbox.checked = checked;
  }
  updateDownloadZipNote();
};

const syncDownloadSelectAll = () => {
  if (!downloadSelectAllCheckbox) {
    return;
  }
  const allFormatsChecked = DOWNLOAD_FORMAT_IDS.every((id) => getDownloadCheckbox("download-format", id)?.checked);
  const allDatatypesChecked = DOWNLOAD_DATATYPE_IDS.every((id) => getDownloadCheckbox("download-datatype", id)?.checked);
  downloadSelectAllCheckbox.checked = allFormatsChecked && allDatatypesChecked;
  updateDownloadZipNote();
};

const initDownloadPanelRange = () => {
  if (!downloadRangeSelect || !downloadRangeFrom || !downloadRangeTo) {
    return;
  }
  downloadRangeSelect.value = rangeSelect?.value || "24h";
  if (rangeFrom?.value && rangeTo?.value) {
    downloadRangeFrom.value = rangeFrom.value;
    downloadRangeTo.value = rangeTo.value;
  } else if (downloadRangeSelect.value !== "custom") {
    applyDownloadPanelPreset();
  }
};

const openDownloadPanel = () => {
  if (!downloadPanelOverlay) {
    return;
  }
  showDownloadValidationError("");
  initDownloadPanelRange();
  updateDownloadZipNote();
  downloadPanelOverlay.hidden = false;
};

const closeDownloadPanel = () => {
  if (!downloadPanelOverlay) {
    return;
  }
  downloadPanelOverlay.hidden = true;
  showDownloadValidationError("");
};

const extractDownloadFilename = (contentDisposition) => {
  if (!contentDisposition) {
    return "network-monitor-export.zip";
  }
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  return match?.[1] || "network-monitor-export.zip";
};

const triggerDownload = async () => {
  showDownloadValidationError("");
  const formats = getCheckedDownloadFormats();
  const datatypes = getCheckedDownloadDatatypes();
  if (formats.length === 0 || datatypes.length === 0) {
    showDownloadValidationError("Select at least one format and one data type.");
    return;
  }

  let range;
  try {
    range = getDownloadPanelRangeISO();
  } catch (err) {
    showDownloadValidationError(err.message || "Invalid range.");
    return;
  }

  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    formats: formats.join(","),
    datatypes: datatypes.join(","),
  });

  if (downloadPanelDownloadBtn) {
    downloadPanelDownloadBtn.disabled = true;
  }
  try {
    const res = await fetch(`/api/export?${params.toString()}`, { method: "GET", cache: "no-store" });
    if (!res.ok) {
      let message = "Export failed.";
      try {
        const body = await res.json();
        if (body?.error) {
          message = body.error;
        }
      } catch {
        // Keep default message.
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const filename = extractDownloadFilename(res.headers.get("Content-Disposition"));
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    closeDownloadPanel();
  } catch (err) {
    showDownloadValidationError(err.message || "Export failed.");
  } finally {
    if (downloadPanelDownloadBtn) {
      downloadPanelDownloadBtn.disabled = false;
    }
  }
};

// Returns a ?from=...&to=... query string for the given Date objects.
// Always encodes the ISO strings. Both params are required.
function buildFromToParams(fromDate, toDate) {
  return `?from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}`;
}

const buildRangeQuery = () => {
  if (!rangeFrom.value || !rangeTo.value) {
    freezeChartRangeWindow();
  }

  const { from, to } = getCustomRangeDates();
  activeChartRange = { min: from, max: to };

  if (rangeSelect.value === "custom") {
    updateRangeStatus(`Custom: ${from.toLocaleString()} to ${to.toLocaleString()}`);
  } else {
    updateRangeStatus("");
  }

  return buildFromToParams(from, to).slice(1);
};

const updateRangeStatus = (message) => {
  if (!rangeStatus) return;
  rangeStatus.textContent = message;
  rangeStatus.hidden = !message;
};

const zoomChartRangeToBand = (band) => {
  const from = new Date(band.start.getTime() - MS_PER_MINUTE);
  const to = new Date(band.end.getTime() + MS_PER_MINUTE);

  rangeSelect.value = "custom";
  setChartRangeWindow(from, to);
  setRangePlaybackActive(false, { skipWindowUpdate: true });
  showRangeError("");
  resetLineChartYScale();
  return refreshAll();
};

const fetchJSON = async (url) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

const postJSON = async (url, body, { signal } = {}) => {
  const options = {
    method: "POST",
    cache: "no-store",
    signal,
  };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    let message = await res.text();
    try {
      const parsed = JSON.parse(message);
      if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      // Keep raw response text.
    }
    throw new Error(message || "Request failed.");
  }
  return res.json();
};

const normalizeTargetInput = (input) => {
  let value = String(input ?? "").trim();
  value = value.replace(/^https:\/\//i, "").replace(/^http:\/\//i, "");
  value = value.replace(/\/+$/, "");
  const slashIndex = value.indexOf("/");
  if (slashIndex >= 0) {
    value = value.slice(0, slashIndex);
  }
  return value.trim();
};

const isValidIPv4 = (value) => {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
};

const isValidIPv6 = (value) => {
  try {
    const url = new URL(`http://[${value}]/`);
    return url.hostname.includes(":");
  } catch {
    return false;
  }
};

const validateTargetInput = (input) => {
  const normalized = normalizeTargetInput(input);
  if (!normalized) {
    return { ok: false, error: "Enter an IP address or hostname." };
  }
  if (normalized.length > 253) {
    return { ok: false, error: "Hostname is too long (maximum 253 characters)." };
  }
  if (!TARGET_ALLOWED_CHARS_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: "Use only letters, numbers, dots, colons, and hyphens.",
    };
  }

  if (TARGET_IPV4_LIKE_PATTERN.test(normalized)) {
    if (!isValidIPv4(normalized)) {
      return {
        ok: false,
        error: "Each part of an IP address must be a number from 0 to 255.",
      };
    }
    return { ok: true, value: normalized };
  }

  if (normalized.includes(":")) {
    if (!isValidIPv6(normalized)) {
      return { ok: false, error: "Enter a valid IPv6 address." };
    }
    return { ok: true, value: normalized };
  }

  if (!TARGET_HOSTNAME_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: "Enter a valid hostname (for example google.com).",
    };
  }
  return { ok: true, value: normalized };
};

const isDigitsOnly = (value) => {
  return /^\d+$/.test(String(value ?? "").trim());
};

const validateWebPortInput = (input) => {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: false, error: "Enter a web port number." };
  }
  if (!isDigitsOnly(raw)) {
    return { ok: false, error: "Web port must contain numbers only." };
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Web port must be between 1 and 65535." };
  }
  return { ok: true, value: String(port) };
};

const validateDataDirInput = (input) => {
  const value = String(input ?? "").trim();
  if (!value) {
    return { ok: false, error: "Enter a data directory path." };
  }
  if (/[<>|"?*]/.test(value)) {
    return { ok: false, error: "Data directory contains invalid characters." };
  }
  return { ok: true, value };
};

const validateRetentionDaysInput = (input) => {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: false, error: "Enter a retention period in days." };
  }
  if (!isDigitsOnly(raw)) {
    return { ok: false, error: "Retention days must contain numbers only." };
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS) {
    return { ok: false, error: "Retention must be 24 hours (1 day) or more." };
  }
  return { ok: true, value: String(days) };
};

const collectSettingsForm = () => {
  const targetResult = validateTargetInput(settingsTargetInput?.value ?? "");
  if (!targetResult.ok) {
    return targetResult;
  }
  const webPortResult = validateWebPortInput(settingsWebPortInput?.value ?? "");
  if (!webPortResult.ok) {
    return webPortResult;
  }
  const dataDirResult = validateDataDirInput(settingsDataDirInput?.value ?? "");
  if (!dataDirResult.ok) {
    return dataDirResult;
  }
  const retentionResult = validateRetentionDaysInput(settingsRetentionDaysInput?.value ?? "");
  if (!retentionResult.ok) {
    return retentionResult;
  }

  return {
    ok: true,
    value: {
      target: targetResult.value,
      web_port: Number(webPortResult.value),
      data_dir: dataDirResult.value,
      retention_days: Number(retentionResult.value),
      auto_check_updates: settingsAutoCheckUpdatesInput?.checked !== false,
    },
  };
};

const applySettingsDraftToInputs = () => {
  if (settingsTargetInput) {
    settingsTargetInput.value = settingsDraft.target;
  }
  if (settingsWebPortInput) {
    settingsWebPortInput.value = settingsDraft.web_port;
  }
  if (settingsDataDirInput) {
    settingsDataDirInput.value = settingsDraft.data_dir;
  }
  if (settingsRetentionDaysInput) {
    settingsRetentionDaysInput.value = settingsDraft.retention_days;
  }
  if (settingsAutoCheckUpdatesInput) {
    settingsAutoCheckUpdatesInput.checked = settingsDraft.auto_check_updates !== false;
  }
  syncTargetPresetSelect();
  setTargetInputValidity("");
  syncDefaultTargetButtonHighlight();
};

const setTargetInputValidity = (message) => {
  if (!settingsTargetInput) {
    return;
  }
  settingsTargetInput.setCustomValidity(message || "");
};

const populateTargetPresetSelect = () => {
  if (!settingsTargetPresetSelect) {
    return;
  }
  settingsTargetPresetSelect.innerHTML = '<option value="">Choose a preset…</option>';
  for (const preset of TARGET_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = formatPresetLabel(preset);
    settingsTargetPresetSelect.appendChild(option);
  }
};

const syncTargetPresetSelect = () => {
  if (!settingsTargetPresetSelect || !settingsTargetInput) {
    return;
  }
  const value = settingsTargetInput.value.trim();
  const match = TARGET_PRESETS.find((preset) => preset.target === value);
  settingsTargetPresetSelect.value = match ? match.id : "";
};

const syncDefaultTargetButtonHighlight = () => {
  if (!settingsTargetInput) {
    return;
  }
  const value = normalizeTargetInput(settingsTargetInput.value);
  const defaultSelected = value === DEFAULT_TARGET;
  const altSelected = value === ALT_DEFAULT_TARGET;

  if (settingsDefaultTargetBtn) {
    settingsDefaultTargetBtn.classList.toggle(
      "app-settings-default-target-btn-selected",
      defaultSelected
    );
    settingsDefaultTargetBtn.setAttribute("aria-pressed", defaultSelected ? "true" : "false");
  }
  if (settingsAltTargetBtn) {
    settingsAltTargetBtn.classList.toggle(
      "app-settings-default-target-btn-selected",
      altSelected
    );
    settingsAltTargetBtn.setAttribute("aria-pressed", altSelected ? "true" : "false");
  }
};

const setSettingsTargetValue = (value) => {
  if (!settingsTargetInput) {
    return;
  }
  settingsTargetInput.value = value;
  syncTargetPresetSelect();
  syncDefaultTargetButtonHighlight();
  if (settingsError && !settingsError.hidden) {
    showSettingsError("");
  }
};

const applySelectedTargetPreset = () => {
  if (!settingsTargetPresetSelect) {
    return;
  }
  const preset = TARGET_PRESETS.find((entry) => entry.id === settingsTargetPresetSelect.value);
  if (!preset) {
    return;
  }
  setSettingsTargetValue(preset.target);
  settingsTargetInput?.focus();
};

const showSettingsUpdatesStatus = (message, { isError = false } = {}) => {
  if (!settingsUpdatesStatusEl) {
    return;
  }
  if (!message) {
    settingsUpdatesStatusEl.hidden = true;
    settingsUpdatesStatusEl.textContent = "";
    settingsUpdatesStatusEl.classList.remove("app-settings-updates-status-error");
    return;
  }
  settingsUpdatesStatusEl.hidden = false;
  settingsUpdatesStatusEl.textContent = message;
  settingsUpdatesStatusEl.classList.toggle("app-settings-updates-status-error", isError);
};

const formatUpdateCheckMessage = (result) => {
  if (result?.update_available) {
    let message = `Update available: ${result.latest_version} (you have ${result.current_version}).`;
    if (result.download_url) {
      message += ` Download: ${result.download_url}`;
    }
    return message;
  }
  return result?.message || "Could not determine update status.";
};

const runUpdateCheck = async ({ silent = false } = {}) => {
  if (settingsCheckUpdatesBtn) {
    settingsCheckUpdatesBtn.disabled = true;
  }
  if (!silent) {
    showSettingsUpdatesStatus("Checking for updates…");
  }
  try {
    const result = await fetchJSON("/api/updates/check");
    lastUpdateCheckResult = result;
    if (!silent || result.update_available) {
      showSettingsUpdatesStatus(formatUpdateCheckMessage(result));
    }
    return result;
  } catch (err) {
    if (!silent) {
      showSettingsUpdatesStatus(err.message || "Could not check for updates.", { isError: true });
    }
    throw err;
  } finally {
    if (settingsCheckUpdatesBtn) {
      settingsCheckUpdatesBtn.disabled = false;
    }
  }
};

const maybeAutoCheckForUpdates = async () => {
  if (autoUpdateCheckStarted) {
    return;
  }
  autoUpdateCheckStarted = true;
  try {
    const data = await fetchJSON("/api/settings");
    if (data.auto_check_updates === false) {
      return;
    }
    await runUpdateCheck({ silent: true });
  } catch {
    // Automatic update checks are best-effort.
  }
};

const showSettingsError = (message) => {
  setTargetInputValidity(message || "");
  if (!settingsError) {
    return;
  }
  if (!message) {
    settingsError.hidden = true;
    settingsError.textContent = "";
    return;
  }
  settingsError.hidden = false;
  settingsError.textContent = message;
};

const openSettingsDialog = async () => {
  showSettingsError("");
  setSettingsTesting(false);
  pendingSettingsPayload = null;
  dismissSettingsUnreachableDialog();
  closeSettingsRetentionYearDialog();
  closeSettingsRetentionDataDialog();
  try {
    const data = await fetchJSON("/api/settings");
    settingsDraft = settingsDraftFromApi(data);
    settingsDataCoverageDays = Number(data.data_coverage_days ?? 0);
    await loadTraceIntervals(data);
  } catch {
    settingsDraft = createDefaultSettingsDraft();
    settingsDataCoverageDays = 0;
  }
  applySettingsDraftToInputs();
  if (lastUpdateCheckResult) {
    showSettingsUpdatesStatus(formatUpdateCheckMessage(lastUpdateCheckResult));
  } else {
    showSettingsUpdatesStatus("");
  }
  if (!settingsDialog) {
    return;
  }
  openDialog(settingsDialog);
};

const closeSettingsDialog = () => {
  if (!settingsDialog) {
    return;
  }
  showSettingsError("");
  setSettingsTesting(false);
  pendingSettingsPayload = null;
  applySettingsDraftToInputs();
  closeDialog(settingsDialog);
};

const showIpEchoError = (message) => {
  if (!ipEchoErrorEl) {
    return;
  }
  if (!message) {
    ipEchoErrorEl.hidden = true;
    ipEchoErrorEl.textContent = "";
    return;
  }
  ipEchoErrorEl.hidden = false;
  ipEchoErrorEl.textContent = message;
};

const setIpEchoLoading = (loading) => {
  if (ipEchoLoadingEl) {
    ipEchoLoadingEl.hidden = !loading;
  }
};

const IP_ECHO_SERVICE_IP_BAD =
  "This IP Echo Service Provider URL is not resolvable to an IP address at this time";
const IP_ECHO_ECHOED_BAD = "This IP Echo Service Provider is currently unreachable";
const IP_ECHO_UNREACHABLE_KIND_LOCAL_IPV6 = "local_ipv6";

const renderIpEchoServiceIpCell = (provider) => {
  if (provider.dns_ok && provider.service_ip) {
    return `<span class="ip-echo-cell ip-echo-cell-good">${escapeHtml(provider.service_ip)}</span>`;
  }
  return `<span class="ip-echo-cell-wrap">
    <span class="ip-echo-cell ip-echo-cell-bad">Not resolvable</span>
    <span class="ip-echo-cell-popup ip-echo-cell-popup-bad" role="tooltip">${escapeHtml(IP_ECHO_SERVICE_IP_BAD)}</span>
  </span>`;
};

const renderIpEchoEchoedIpCell = (provider) => {
  if (provider.reachable && provider.echo_ip) {
    return `<span class="ip-echo-cell ip-echo-cell-good">${escapeHtml(provider.echo_ip)}</span>`;
  }
  const isLocalIPv6 = provider.unreachable_kind === IP_ECHO_UNREACHABLE_KIND_LOCAL_IPV6;
  const cellClass = isLocalIPv6 ? "ip-echo-cell-warn" : "ip-echo-cell-bad";
  const popupClass = isLocalIPv6 ? "ip-echo-cell-popup-warn" : "ip-echo-cell-popup-bad";
  const reason = provider.unreachable_reason || IP_ECHO_ECHOED_BAD;
  return `<span class="ip-echo-cell-wrap">
    <span class="ip-echo-cell ${cellClass}">Unreachable</span>
    <span class="ip-echo-cell-popup ${popupClass}" role="tooltip">${escapeHtml(reason)}</span>
  </span>`;
};

const renderIpEchoProviderRow = (provider) => {
  const serviceHost = provider.host || "";

  return `<tr class="ip-echo-provider-row" data-host="${escapeHtml(provider.host)}" tabindex="0" role="button">
    <td class="ip-echo-url-col">
      <span class="ip-echo-url-text">${escapeHtml(serviceHost)}</span>
    </td>
    <td class="ip-echo-service-col">${renderIpEchoServiceIpCell(provider)}</td>
    <td class="ip-echo-echoed-col">${renderIpEchoEchoedIpCell(provider)}</td>
  </tr>`;
};

const renderIpEchoProviders = (providers) => {
  if (!ipEchoProviderListEl) {
    return;
  }
  ipEchoProvidersCache = Array.isArray(providers) ? providers : [];
  if (!ipEchoProvidersCache.length) {
    ipEchoProviderListEl.innerHTML =
      "<tr><td colspan=\"3\" class=\"ip-echo-dns-empty\">No providers configured.</td></tr>";
    return;
  }
  ipEchoProviderListEl.innerHTML = ipEchoProvidersCache.map(renderIpEchoProviderRow).join("");
};

const openIpEchoDnsDialog = (provider) => {
  if (!ipEchoDnsDialog || !provider) {
    return;
  }
  if (ipEchoDnsTitleEl) {
    ipEchoDnsTitleEl.textContent = "DNS lookup";
  }
  if (ipEchoDnsHostEl) {
    ipEchoDnsHostEl.textContent = provider.host;
  }
  const ips = Array.isArray(provider.dns_ips) ? provider.dns_ips : [];
  if (ipEchoDnsListEl) {
    ipEchoDnsListEl.innerHTML = ips.map((ip) => `<li>${escapeHtml(ip)}</li>`).join("");
  }
  if (ipEchoDnsEmptyEl) {
    ipEchoDnsEmptyEl.hidden = ips.length > 0;
  }
  openDialog(ipEchoDnsDialog);
};

const closeIpEchoDnsDialog = () => {
  if (!ipEchoDnsDialog) {
    return;
  }
  closeDialog(ipEchoDnsDialog);
};

const closeIpEchoDialog = () => {
  if (!ipEchoDialog) {
    return;
  }
  showIpEchoError("");
  setIpEchoLoading(false);
  closeDialog(ipEchoDialog);
};

const closeAboutDialog = () => {
  if (!aboutDialog) {
    return;
  }
  closeDialog(aboutDialog);
};

const openAboutDialog = async () => {
  if (!aboutDialog) {
    return;
  }
  if (aboutVersionEl) {
    aboutVersionEl.textContent = "Version: …";
  }
  openDialog(aboutDialog);
  try {
    const data = await fetchJSON("/api/version");
    if (aboutVersionEl) {
      const version = String(data.version ?? "").trim() || "unknown";
      aboutVersionEl.textContent = `Version: ${version}`;
    }
    const instanceId = String(data.instance_id ?? "").trim();
    if (instanceId) {
      const parts = instanceId.split("-");
      if (parts.length === 4) {
        if (aboutSegInstanceEl) aboutSegInstanceEl.textContent = parts[0];
        if (aboutSegVersionEl) aboutSegVersionEl.textContent = parts[1];
        if (aboutSegBuildEl) aboutSegBuildEl.textContent = parts[2];
        if (aboutSegIntegrityEl) aboutSegIntegrityEl.textContent = parts[3];
      }
      if (aboutInstanceCopyBtn) {
        aboutInstanceCopyBtn.dataset.instanceId = instanceId;
      }
    }
  } catch {
    if (aboutVersionEl) {
      aboutVersionEl.textContent = "Version: unknown";
    }
  }
};

const openIpEchoDialog = async () => {
  if (!ipEchoDialog) {
    return;
  }
  showIpEchoError("");
  renderIpEchoProviders([]);
  setIpEchoLoading(true);
  openDialog(ipEchoDialog);
  try {
    const data = await fetchJSON("/api/ip-echo-services");
    renderIpEchoProviders(data.providers);
  } catch (err) {
    showIpEchoError(err.message || "Could not load IP echo services.");
  } finally {
    setIpEchoLoading(false);
  }
};

const isTargetFieldValidationError = (message) => {
  const lower = String(message ?? "").toLowerCase();
  return lower.includes("target") || lower.includes("hostname") || lower.includes("ip");
};

const applySettings = async (options = {}) => {
  const {
    skipReachabilityTest = false,
    skipRetentionYearWarning = false,
    skipRetentionDataWarning = false,
    forceDeleteData = false,
  } = options;

  const collected = collectSettingsForm();
  if (!collected.ok) {
    showSettingsError(collected.error);
    if (isTargetFieldValidationError(collected.error)) {
      settingsTargetInput?.reportValidity();
      settingsTargetInput?.focus();
    }
    return;
  }

  applySettingsDraftToInputs();
  showSettingsError("");

  if (!skipRetentionYearWarning && collected.value.retention_days > RETENTION_YEAR_WARN_DAYS) {
    pendingSettingsPayload = { ...collected.value, forceDeleteData };
    openSettingsRetentionYearDialog(collected.value.retention_days);
    return;
  }

  if (
    !skipRetentionDataWarning &&
    !forceDeleteData &&
    settingsDataCoverageDays > 0 &&
    collected.value.retention_days < Math.ceil(settingsDataCoverageDays)
  ) {
    pendingSettingsPayload = { ...collected.value, forceDeleteData };
    openSettingsRetentionDataDialog(collected.value.retention_days, settingsDataCoverageDays);
    return;
  }

  if (!skipReachabilityTest) {
    setSettingsTesting(true);
    setSettingsFormDisabled(true);
    try {
      const test = await postJSON("/api/settings/test-target", { target: collected.value.target });
      if (!test.reachable) {
        pendingSettingsPayload = { ...collected.value, forceDeleteData };
        openSettingsUnreachableDialog(collected.value.target);
        return;
      }
    } catch (err) {
      showSettingsError(err.message || "Could not test target reachability.");
      return;
    } finally {
      setSettingsTesting(false);
      setSettingsFormDisabled(false);
    }
  }

  await saveSettings({
    ...collected.value,
    forceDeleteData: Boolean(forceDeleteData),
  });
};

const setSettingsTesting = (active) => {
  if (!settingsTestingEl) {
    return;
  }
  settingsTestingEl.hidden = !active;
  settingsTestingEl.textContent = active
    ? "Testing target reachability (3 pings)…"
    : "";
};

const setSettingsFormDisabled = (disabled) => {
  for (const control of [
    settingsApplyBtn,
    settingsCancelBtn,
    settingsTargetInput,
    settingsTargetPresetSelect,
    settingsDefaultTargetBtn,
    settingsAltTargetBtn,
    settingsRestoreDefaultsBtn,
    settingsWebPortInput,
    settingsDataDirInput,
    settingsPickFolderBtn,
    settingsRetentionDaysInput,
    settingsAutoCheckUpdatesInput,
    settingsCheckUpdatesBtn,
  ]) {
    if (control) {
      control.disabled = disabled;
    }
  }
};

const saveSettings = async (payload) => {
  if (settingsApplyBtn) {
    settingsApplyBtn.disabled = true;
  }
  setSettingsFormDisabled(true);

  try {
    const body = await postJSON("/api/settings", {
      target: payload.target,
      web_port: payload.web_port,
      data_dir: payload.data_dir,
      retention_days: payload.retention_days,
      auto_check_updates: payload.auto_check_updates !== false,
      force_delete_data: Boolean(payload.forceDeleteData),
    });

    settingsDraft = {
      target: body.target || payload.target,
      web_port: String(body.web_port ?? payload.web_port),
      data_dir: body.data_dir || payload.data_dir,
      retention_days: String(body.retention_days ?? payload.retention_days),
      auto_check_updates: body.auto_check_updates !== false,
    };
    settingsDataCoverageDays = 0;
    pendingSettingsPayload = null;
    closeSettingsUnreachableDialog();
    closeSettingsRetentionYearDialog();
    closeSettingsRetentionDataDialog();

    if (body.restart_required && body.redirect_url) {
      closeSettingsDialog();
      window.location.href = body.redirect_url;
      return;
    }

    rttBaseline = null;
    rttBaselineLastFetched = 0;
    speedtestConfigCache = null;
    closeSettingsDialog();
    await refreshAll();
  } catch (err) {
    showSettingsError(err.message || "Could not save settings.");
  } finally {
    setSettingsFormDisabled(false);
    if (settingsApplyBtn) {
      settingsApplyBtn.disabled = false;
    }
  }
};

const openSettingsUnreachableDialog = (target) => {
  if (settingsUnreachableTargetEl) {
    settingsUnreachableTargetEl.textContent = target;
  }
  openDialog(settingsUnreachableDialog);
};

const closeSettingsUnreachableDialog = () => {
  closeDialog(settingsUnreachableDialog);
};

const dismissSettingsUnreachableDialog = () => {
  closeSettingsUnreachableDialog();
  pendingSettingsPayload = null;
};

const openSettingsRetentionYearDialog = (days) => {
  if (settingsRetentionYearValueEl) {
    settingsRetentionYearValueEl.textContent = String(days);
  }
  openDialog(settingsRetentionYearDialog);
};

const closeSettingsRetentionYearDialog = () => {
  closeDialog(settingsRetentionYearDialog);
};

const dismissSettingsRetentionYearDialog = () => {
  closeSettingsRetentionYearDialog();
  pendingSettingsPayload = null;
};

const openSettingsRetentionDataDialog = (retentionDays, coverageDays) => {
  if (settingsRetentionDataMessageEl) {
    settingsRetentionDataMessageEl.textContent =
      `Stored data goes back about ${Math.ceil(coverageDays)} days, but retention is set to ${retentionDays} days. Delete all stored data to continue, or choose Never mind.`;
  }
  openDialog(settingsRetentionDataDialog);
};

const closeSettingsRetentionDataDialog = () => {
  closeDialog(settingsRetentionDataDialog);
};

const dismissSettingsRetentionDataDialog = () => {
  closeSettingsRetentionDataDialog();
  pendingSettingsPayload = null;
};

const pickSettingsDataFolder = async () => {
  showSettingsError("");
  if (settingsPickFolderBtn) {
    settingsPickFolderBtn.disabled = true;
  }
  try {
    const result = await postJSON("/api/settings/pick-folder");
    if (settingsDataDirInput && result.path) {
      settingsDataDirInput.value = result.path;
    }
  } catch (err) {
    if (!/cancel/i.test(err.message)) {
      showSettingsError(err.message || "Could not open folder picker.");
    }
  } finally {
    if (settingsPickFolderBtn) {
      settingsPickFolderBtn.disabled = false;
    }
  }
};

const openDeleteDataDialog = () => {
  openDialog(deleteDataDialog);
};

const closeDeleteDataDialog = () => {
  closeDialog(deleteDataDialog);
};

const confirmDeleteStoredData = async () => {
  if (!deleteDataConfirmBtn) return;

  deleteDataConfirmBtn.disabled = true;
  showRangeError("");

  try {
    await postJSON("/api/data/delete");
    closeDeleteDataDialog();
    resetLineChartYScale();
    await refreshAll();
  } catch (err) {
    handleRefreshError(err);
  } finally {
    deleteDataConfirmBtn.disabled = false;
  }
};

const formatSecondsShort = (totalSec) => {
  const { hours, minutes, seconds } = splitDurationParts(totalSec);
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const getChartRange = (summary) => {
  if (activeChartRange) {
    return { start: activeChartRange.min, end: activeChartRange.max };
  }
  if (summary?.from && summary?.to) {
    return { start: new Date(summary.from), end: new Date(summary.to) };
  }
  const end = new Date();
  const ms = rangeSelect?.value === "custom" ? MS_PER_DAY : presetRangeMs(rangeSelect.value);
  return { start: new Date(end.getTime() - ms), end };
};

const getTimeScaleTickConfig = (durationMs) => {
  if (durationMs <= 30 * MS_PER_MINUTE) {
    return { unit: "minute", stepSize: 5, maxTicksLimit: 8, displayFormats: { minute: "h:mm a" } };
  }
  if (durationMs <= 2 * MS_PER_HOUR) {
    return { unit: "minute", stepSize: 15, maxTicksLimit: 10, displayFormats: { minute: "h:mm a" } };
  }
  if (durationMs <= 6 * MS_PER_HOUR) {
    return { unit: "hour", stepSize: 1, maxTicksLimit: 8, displayFormats: { hour: "h:mm a" } };
  }
  if (durationMs <= MS_PER_DAY) {
    return { unit: "hour", stepSize: 3, maxTicksLimit: 10, displayFormats: { hour: "MMM d, ha" } };
  }
  if (durationMs <= 7 * MS_PER_DAY) {
    return { unit: "hour", stepSize: 12, maxTicksLimit: 12, displayFormats: { hour: "MMM d, ha" } };
  }
  if (durationMs <= 30 * MS_PER_DAY) {
    return { unit: "day", stepSize: 1, maxTicksLimit: 14, displayFormats: { day: "MMM d" } };
  }
  if (durationMs <= 90 * MS_PER_DAY) {
    return { unit: "day", stepSize: 3, maxTicksLimit: 12, displayFormats: { day: "MMM d" } };
  }
  return { unit: "day", stepSize: 7, maxTicksLimit: 14, displayFormats: { day: "MMM d, yyyy" } };
};

const applyChartTimeScale = (chartInstance, summary) => {
  if (!chartInstance) {
    return;
  }

  const { start, end } = getChartRange(summary);
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const tickConfig = getTimeScaleTickConfig(durationMs);
  const xScale = chartInstance.options.scales.x;

  xScale.min = start.getTime();
  xScale.max = end.getTime();
  xScale.time.unit = tickConfig.unit;
  xScale.time.stepSize = tickConfig.stepSize;
  // Do not round parsed data to tick units — that stacks every ping in a minute
  // onto one x pixel and produces vertical "combs" plus multi-line tooltips.
  xScale.time.round = false;
  xScale.ticks.maxTicksLimit = tickConfig.maxTicksLimit;
  xScale.ticks.autoSkip = true;
  xScale.time.displayFormats = {
    ...xScale.time.displayFormats,
    ...tickConfig.displayFormats,
  };
};

const getChartRangeKey = () => {
  if (activeChartRange) {
    return `custom:${activeChartRange.min.getTime()}-${activeChartRange.max.getTime()}`;
  }
  return `preset:${rangeSelect.value}`;
};

const resetLineChartYScale = () => {
  lineChartYScaleState = { rangeKey: null, max: LINE_CHART_Y_FLOOR };
};

const applyLineChartYScale = (linePoints) => {
  if (!chart) {
    return;
  }

  const rangeKey = getChartRangeKey();
  if (lineChartYScaleState.rangeKey !== rangeKey) {
    lineChartYScaleState = { rangeKey, max: LINE_CHART_Y_FLOOR };
  }

  let dataMax = 0;
  for (const point of linePoints) {
    if (point.y != null && point.y > dataMax) {
      dataMax = point.y;
    }
  }

  if (dataMax > 0) {
    const neededMax = Math.max(
      LINE_CHART_Y_FLOOR,
      Math.ceil((dataMax * LINE_CHART_Y_HEADROOM) / LINE_CHART_Y_STEP) * LINE_CHART_Y_STEP
    );
    lineChartYScaleState.max = Math.max(lineChartYScaleState.max, neededMax);
  }

  const yScale = chart.options.scales.y;
  yScale.min = LINE_CHART_Y_MIN;
  yScale.max = lineChartYScaleState.max;
  yScale.ticks.stepSize = LINE_CHART_Y_STEP;
};

const clipBandSeconds = (band, rangeStart, rangeEnd) => {
  const startMs = Math.max(band.start.getTime(), rangeStart.getTime());
  const endMs = Math.min(band.end.getTime(), rangeEnd.getTime());
  if (endMs <= startMs) {
    return 0;
  }
  let seconds = (endMs - startMs) / 1000;
  if (seconds === 0 && band.durationSec > 0) {
    seconds = Math.min(band.durationSec, (rangeEnd.getTime() - rangeStart.getTime()) / 1000);
  }
  if (seconds === 0) {
    seconds = 1;
  }
  return seconds;
};

const computeUptimeBreakdown = (summary) => {
  const { start, end } = getChartRange(summary);
  const totalSec = Math.max(0, (end.getTime() - start.getTime()) / 1000);
  if (totalSec <= 0) {
    return { upSec: 0, downSec: 0, totalSec: 0 };
  }

  let outageSec = 0;
  for (const band of outageBands) {
    outageSec += clipBandSeconds(band, start, end);
  }

  let blipSec = 0;
  for (const band of blipBands) {
    blipSec += clipBandSeconds(band, start, end);
  }

  const upSec = Math.max(0, totalSec - outageSec - blipSec);
  const downSec = outageSec + blipSec;
  return { upSec, downSec, totalSec };
};

const formatUptimePercent = (value, dataset) => {
  return `${getUptimeShare(value, dataset).pct}%`;
};

const parseHexColor = (hex) => {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

const lerpHexColor = (fromHex, toHex, t) => {
  const from = parseHexColor(fromHex);
  const to = parseHexColor(toHex);
  const clamped = Math.min(1, Math.max(0, t));
  const channel = (start, end) => Math.round(start + (end - start) * clamped);
  const r = channel(from.r, to.r);
  const g = channel(from.g, to.g);
  const b = channel(from.b, to.b);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

const availabilityPercentColor = (pct) => {
  const value = Math.min(100, Math.max(0, pct));
  if (value >= 50) {
    return lerpHexColor(PALETTE.warn, PALETTE.ok, (value - 50) / 50);
  }
  return lerpHexColor(PALETTE.bad, PALETTE.warn, value / 50);
};

const formatUptimeTooltipLine = (label, value, dataset) => {
  const { pct } = getUptimeShare(value, dataset);
  return `${label}: ${formatSecondsShort(value)} (${pct}%)`;
};

const formatUptimeTooltipHtml = (label, value, dataset) => {
  return `<strong>${escapeHtml(label)}</strong>${escapeHtml(formatUptimeTooltipLine(label, value, dataset))}`;
};

const hideUptimeChartTooltip = () => {
  hideTooltip(uptimeChartTooltip);
};

const showUptimeChartTooltipAtPointer = (html, clientX, clientY) => {
  showTooltipHtml(uptimeChartTooltip, uptimeChartWrap, html, clientX, clientY);
};

const bindUptimeLegendEvents = () => {
  if (uptimeLegendEventsBound || !uptimeLegendContainer) return;

  const showForTarget = (event) => {
    const button = event.target.closest(".uptime-legend-item");
    if (!button || !uptimeChart) {
      hideUptimeChartTooltip();
      return;
    }

    const index = Number(button.dataset.index);
    const dataset = uptimeChart.data.datasets[0];
    const label = uptimeChart.data.labels[index];
    const value = dataset.data[index];
    showUptimeChartTooltipAtPointer(
      formatUptimeTooltipHtml(label, value, dataset),
      event.clientX,
      event.clientY
    );
  };

  uptimeLegendContainer.addEventListener("mouseover", showForTarget);
  uptimeLegendContainer.addEventListener("mousemove", showForTarget);
  uptimeLegendContainer.addEventListener("mouseleave", hideUptimeChartTooltip);
  uptimeLegendEventsBound = true;
};

const renderUptimeLegend = () => {
  if (!uptimeLegendContainer || !uptimeChart) return;

  const dataset = uptimeChart.data.datasets[0];

  uptimeLegendContainer.innerHTML = uptimeChart.data.labels
    .map((label, index) => {
      const value = dataset.data[index];
      const percent = formatUptimePercent(value, dataset);
      return (
        `<button type="button" class="uptime-legend-item" data-index="${index}">` +
        `<span class="uptime-legend-heading">` +
        `<span class="uptime-legend-swatch" style="background:${UPTIME_LEGEND_COLORS[index]}"></span>` +
        `<span class="uptime-legend-label">${escapeHtml(label)}</span>` +
        `</span>` +
        `<span class="uptime-legend-percent">${percent}</span>` +
        `</button>`
      );
    })
    .join("");
};

const buildUptimeChart = () => {
  uptimeChartTooltip = document.getElementById("uptime-chart-tooltip");
  bindUptimeLegendEvents();

  const ctx = document.getElementById("uptime-chart");
  if (!ctx) {
    return;
  }
  uptimeChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: ["Up", "Down"],
      datasets: [
        {
          data: [1, 0],
          backgroundColor: [paletteRgba(PALETTE.ok, 0.72), paletteRgba(PALETTE.bad, 0.72)],
          borderColor: UPTIME_LEGEND_COLORS,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      layout: { padding: 4 },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              return formatUptimeTooltipLine(context.label, context.raw, context.dataset);
            },
          },
        },
      },
    },
  });

  renderUptimeLegend();
};

const renderUptimeChart = (summary) => {
  if (!uptimeChart) {
    return;
  }

  const { upSec, downSec, totalSec } = computeUptimeBreakdown(summary);
  const values =
    totalSec > 0 && upSec + downSec > 0 ? [upSec, downSec] : [1, 0];

  uptimeChart.data.datasets[0].data = values;
  uptimeChart.update("none");
  renderUptimeLegend();
};

const applyLineChartLayerVisibility = ({ skipMirror = false } = {}) => {
  if (!chart) {
    return;
  }
  chart.setDatasetVisibility(0, lineChartLayerVisible.ping);
  chart.update("none");
  if (!skipMirror) {
    publishTimelineMirrorState();
  }
};

const renderCheckboxChartLegend = ({
  container,
  layers,
  visibilityMap,
  onVisibilityChange,
  includeInfo = false,
}) => {
  if (!container) {
    return;
  }

  container.innerHTML = layers
    .map((layer) => {
      const checked = visibilityMap[layer.id] !== false ? " checked" : "";
      const infoHtml =
        includeInfo && layer.info
          ? `<span class="line-chart-legend-info" role="tooltip">${escapeHtml(layer.info)}</span>`
          : "";
      return (
        `<label class="line-chart-legend-item">` +
        `<span class="line-chart-legend-wrap">` +
        `<span class="line-chart-legend-swatch" style="background:${layer.color}"></span>` +
        `<span class="line-chart-legend-label">${escapeHtml(layer.label)}</span>` +
        infoHtml +
        `</span>` +
        `<input type="checkbox" class="line-chart-legend-hide" data-layer="${layer.id}"${checked} aria-label="Show ${escapeHtml(layer.label)}">` +
        `</label>`
      );
    })
    .join("");

  container.querySelectorAll(".line-chart-legend-hide").forEach((input) => {
    input.addEventListener("change", (event) => {
      const layerId = event.target.dataset.layer;
      if (!layerId || !(layerId in visibilityMap)) {
        return;
      }
      visibilityMap[layerId] = event.target.checked;
      onVisibilityChange();
    });
  });
};

const renderLineChartLegend = () => {
  renderCheckboxChartLegend({
    container: lineChartLegendContainer,
    layers: LINE_CHART_LAYERS,
    visibilityMap: lineChartLayerVisible,
    onVisibilityChange: applyLineChartLayerVisibility,
    includeInfo: true,
  });
};

const isDashboardGridEditMode = () =>
  document.getElementById("dashboard")?.classList.contains("grid-edit-mode") ?? false;

const getDashboardChartGridOptions = () => ({
  display: !isDashboardGridEditMode(),
  color: PALETTE.chartGrid,
});

const applyDashboardChartGridVisibility = (hideGrids = isDashboardGridEditMode()) => {
  for (const instance of [chart, speedtestChart]) {
    if (!instance?.options?.scales) {
      continue;
    }
    for (const scaleKey of ["x", "y"]) {
      const scale = instance.options.scales[scaleKey];
      if (!scale) {
        continue;
      }
      if (!scale.grid) {
        scale.grid = {};
      }
      scale.grid.display = !hideGrids;
      if (!hideGrids) {
        scale.grid.color = PALETTE.chartGrid;
      }
    }
    instance.update("none");
  }
};

const buildChart = () => {
  const ctx = document.getElementById("rtt-chart");
  if (!ctx) {
    return;
  }
  chart = new Chart(ctx, {
    type: "line",
    plugins: [timelineBandPlugin],
    data: {
      datasets: [
        {
          label: "Ping Delay (TTL ms)",
          data: [],
          borderColor: UPTIME_LEGEND_COLORS[0],
          backgroundColor: paletteRgba(PALETTE.ok, 0.15),
          pointRadius: 0,
          pointStyle: "line",
          borderWidth: 2,
          tension: 0,
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false, axis: "x" },
      scales: {
        x: {
          type: "time",
          time: {
            tooltipFormat: "PPpp",
            displayFormats: {
              minute: "h:mm a",
              hour: "MMM d, ha",
              day: "MMM d",
            },
          },
          grid: getDashboardChartGridOptions(),
          ticks: {
            color: PALETTE.chartTick,
            autoSkip: true,
            maxRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "ms", color: PALETTE.chartTick },
          grid: getDashboardChartGridOptions(),
          ticks: { color: PALETTE.chartTick },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          mode: "nearest",
          intersect: false,
          axis: "x",
          callbacks: {
            label(context) {
              const raw = context.raw;
              if (raw && typeof raw === "object" && raw.detail) {
                return `${context.dataset.label}: ${raw.detail}`;
              }
              const y = context.parsed.y;
              if (y == null) {
                return `${context.dataset.label}: —`;
              }
              return `${context.dataset.label}: ${y} ms`;
            },
            afterBody(items) {
              const target = items[0]?.raw?.target;
              if (!target) {
                return [];
              }
              return [`Target Host: ${target}`];
            },
          },
        },
      },
    },
  });
  renderLineChartLegend();
  applyLineChartLayerVisibility();
};

const createCopiedMessageController = (copiedEl) => {
  let copiedHideTimer = null;
  return () => {
    if (!copiedEl) {
      return;
    }
    if (copiedHideTimer) {
      clearTimeout(copiedHideTimer);
    }
    copiedEl.classList.add("is-visible");
    copiedHideTimer = setTimeout(() => {
      copiedEl.classList.remove("is-visible");
      copiedHideTimer = null;
    }, IP_COPIED_MESSAGE_MS);
  };
};

const bindCopyableIpButton = (btn, copiedEl) => {
  if (!btn) {
    return;
  }
  const showCopiedMessage = createCopiedMessageController(copiedEl);
  btn.addEventListener("click", async () => {
    const value = btn.textContent.trim();
    if (IP_COPY_SKIP.has(value)) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showCopiedMessage();
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  });
};

const bindCopyableValueButton = (btn, copiedEl, getCopyValue) => {
  if (!btn || typeof getCopyValue !== "function") {
    return;
  }
  const showCopiedMessage = createCopiedMessageController(copiedEl);
  btn.addEventListener("click", async () => {
    const value = String(getCopyValue() || "").trim();
    if (!value || IP_COPY_SKIP.has(value)) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showCopiedMessage();
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  });
};

const formatPublicIspSuffix = (isp) => (isp ? ` · ${isp}` : "");

const formatTargetInfoSuffix = (data) => {
  if (!data) {
    return "";
  }
  const parts = [];
  const target = String(data.target || "").trim().toLowerCase();
  const hostname = String(data.hostname || "").trim();
  const isp = String(data.isp || "").trim();
  if (hostname && hostname.toLowerCase() !== target) {
    parts.push(hostname);
  }
  if (isp) {
    parts.push(isp);
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
};

const refreshSourceNetworkInfo = async () => {
  await Promise.all([refreshPrivateIP(), refreshPublicIP()]);
};

const refreshPrivateIP = async () => {
  if (!subtitlePrivateIpBtn) {
    return;
  }
  try {
    const data = await fetchJSON("/api/private-ip");
    subtitlePrivateIpBtn.textContent = data.ip || "—";
    if (subtitlePrivatePrefixBtn) {
      subtitlePrivatePrefixBtn.textContent = data.prefix ? `/${data.prefix}` : "/—";
      subtitlePrivatePrefixBtn.dataset.subnetMask = data.subnet_mask || "";
    }
    if (subtitlePrivateGatewayBtn) {
      subtitlePrivateGatewayBtn.textContent = data.gateway || "—";
    }
  } catch {
    subtitlePrivateIpBtn.textContent = "Unavailable";
    if (subtitlePrivatePrefixBtn) {
      subtitlePrivatePrefixBtn.textContent = "/—";
      subtitlePrivatePrefixBtn.dataset.subnetMask = "";
    }
    if (subtitlePrivateGatewayBtn) {
      subtitlePrivateGatewayBtn.textContent = "Unavailable";
    }
  }
};

const refreshPublicIP = async () => {
  if (!subtitlePublicIpBtn) {
    return;
  }
  try {
    const data = await fetchJSON("/api/public-ip");
    subtitlePublicIpBtn.textContent = data.ip || "—";
    if (subtitlePublicIpIspEl) {
      subtitlePublicIpIspEl.textContent = formatPublicIspSuffix(data.isp);
    }
  } catch {
    subtitlePublicIpBtn.textContent = "Unavailable";
    if (subtitlePublicIpIspEl) {
      subtitlePublicIpIspEl.textContent = "";
    }
  }
};

const refreshTargetInfo = async () => {
  if (!subtitleTargetInfoEl) {
    return;
  }
  try {
    const data = await fetchJSON("/api/target-info");
    subtitleTargetInfoEl.textContent = formatTargetInfoSuffix(data);
  } catch {
    subtitleTargetInfoEl.textContent = "";
  }
};

const renderStatus = (status) => {
  if (subtitleLoadingEl) {
    subtitleLoadingEl.hidden = true;
  }
  if (subtitleErrorEl) {
    subtitleErrorEl.hidden = true;
  }
  if (subtitleReadyEl) {
    subtitleReadyEl.hidden = false;
  }
  if (subtitleTargetBtn) {
    subtitleTargetBtn.textContent = status.target;
    subtitleTargetBtn.classList.remove("subtitle-target-healthy", "subtitle-target-outage");
    subtitleTargetBtn.classList.add(
      status.failure_active ? "subtitle-target-outage" : "subtitle-target-healthy"
    );
  }
  if (subtitleMetaEl) {
    subtitleMetaEl.innerHTML =
      ` · Last ping: ${escapeHtml(fmtTime(status.last_ping_at))} · <span id="subtitle-meta-rtt"></span>`;
    const rttSpan = subtitleMetaEl.querySelector("#subtitle-meta-rtt");
    if (rttSpan) {
      const currentRttMs = status.last_rtt_ms;
      const headerRttQuality = getRTTQuality(currentRttMs, rttBaseline);
      if (headerRttQuality) {
        rttSpan.textContent = fmtRTT(currentRttMs);
        rttSpan.style.color = headerRttQuality.color;
      } else {
        rttSpan.textContent = "—";
        rttSpan.style.color = "";
      }
    }
  }
  if (status.target && status.target !== lastTargetInfoKey) {
    lastTargetInfoKey = status.target;
    refreshTargetInfo().catch((err) => console.error(err));
  }
  if (previousFailureActive === true && !status.failure_active) {
    refreshSourceNetworkInfo().catch((err) => console.error(err));
  }
  previousFailureActive = status.failure_active;

  if (status.failure_active) {
    statusPillEl.textContent = "OUTAGE";
    statusPillEl.className = "pill outage";
  } else if (status.up) {
    statusPillEl.textContent = "UP";
    statusPillEl.className = "pill up";
  } else {
    statusPillEl.textContent = "DOWN";
    statusPillEl.className = "pill down";
  }

  applyRttQualityToCard(lastRttEl, status.last_rtt_ms, (ms) => fmtRTT(ms), rttBaseline, true);
};

const showSubtitleLoadError = (message) => {
  if (subtitleLoadingEl) {
    subtitleLoadingEl.hidden = true;
  }
  if (subtitleReadyEl) {
    subtitleReadyEl.hidden = true;
  }
  if (subtitleErrorEl) {
    subtitleErrorEl.hidden = false;
    subtitleErrorEl.textContent = message;
  }
};

const renderSummary = (summary) => {
  if (summary.total_pings) {
    const pct = summary.availability;
    availabilityEl.textContent = `${pct.toFixed(1)}%`;
    availabilityEl.style.color = availabilityPercentColor(pct);
  } else {
    availabilityEl.textContent = "—";
    availabilityEl.style.color = "";
  }
  if (summary.ok_pings) {
    applyRttQualityToCard(avgRttEl, summary.avg_rtt_ms, (ms) => `${ms.toFixed(1)} ms`, rttBaseline);
  } else {
    applyRttQualityToCard(avgRttEl, null);
  }
  if (jitterMsEl) {
    if (summary.jitter_ms != null && Number.isFinite(summary.jitter_ms)) {
      jitterMsEl.textContent = `${Number(summary.jitter_ms).toFixed(1)} ms`;
      jitterMsEl.style.color = getJitterColor(summary.jitter_ms);
    } else {
      jitterMsEl.textContent = "—";
      jitterMsEl.style.color = "";
    }
  }
};

const formatLastOutageTracerouteTime = (tr) => {
  if (!tr || !tr.output) {
    return "None";
  }
  return fmtTime(tr.ts);
};

const renderLastOutageTime = (traceOutage) => {
  if (!lastOutageEl) {
    return;
  }
  const text = formatLastOutageTracerouteTime(traceOutage);
  lastOutageEl.textContent = text;
  lastOutageEl.classList.toggle("last-outage-recorded", text !== "None");
};

const sortByTime = (items) => {
  return items.slice().sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
};

const overlapsAnyBands = (start, end, ...bandLists) => {
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const bands of bandLists) {
    for (const band of bands) {
      if (startMs <= band.end.getTime() && endMs >= band.start.getTime()) {
        return true;
      }
    }
  }
  return false;
};

const mergeTimelineGapIntervals = (...bandLists) => {
  const intervals = bandLists.flatMap((bands) =>
    bands.map((band) => ({
      startMs: band.start.getTime(),
      endMs: band.end.getTime(),
    }))
  );
  if (intervals.length === 0) {
    return [];
  }
  intervals.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i];
    const previous = merged[merged.length - 1];
    if (current.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, current.endMs);
    } else {
      merged.push(current);
    }
  }
  return merged;
};

const isTimeMsInMergedIntervals = (timeMs, mergedIntervals) => {
  let lo = 0;
  let hi = mergedIntervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const interval = mergedIntervals[mid];
    if (timeMs < interval.startMs) {
      hi = mid - 1;
    } else if (timeMs > interval.endMs) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
};

const bandDurationSec = (band) => {
  return (band.end.getTime() - band.start.getTime()) / 1000;
};

const findFailureStreakStart = (sortedPings, endTime) => {
  const endMs = endTime.getTime();
  let start = endTime;

  for (let i = sortedPings.length - 1; i >= 0; i--) {
    const pingTime = tsMs(sortedPings[i].ts);
    if (pingTime > endMs) continue;
    if (!sortedPings[i].ok) {
      start = new Date(sortedPings[i].ts);
      while (i > 0 && !sortedPings[i - 1].ok) {
        i--;
        start = new Date(sortedPings[i].ts);
      }
      return start;
    }
    break;
  }

  return start;
};

const buildOutageBands = (sortedEvents, sortedPings, status) => {
  const bands = [];
  let openConfirm = null;

  for (const event of sortedEvents) {
    if (event.type === "failure_confirmed") {
      openConfirm = new Date(event.ts);
    } else if (event.type === "recovered" && openConfirm) {
      bands.push({
        start: findFailureStreakStart(sortedPings, openConfirm),
        end: new Date(event.ts),
      });
      openConfirm = null;
    }
  }

  if (openConfirm) {
    bands.push({
      start: findFailureStreakStart(sortedPings, openConfirm),
      end: new Date(),
    });
  } else if (status?.failure_active && status?.last_failure_at) {
    const alreadyCovered = bands.some((band) => Math.abs(band.end.getTime() - Date.now()) < 2000);
    if (!alreadyCovered) {
      bands.push({
        start: findFailureStreakStart(sortedPings, new Date(status.last_failure_at)),
        end: new Date(),
      });
    }
  }

  return bands;
};

const hasFailureConfirmedNear = (start, end, sortedEvents) => {
  const windowStartMs = start.getTime() - 2000;
  const windowEndMs = end.getTime() + 10000;
  for (let i = findFirstIndexAtOrAfterTime(sortedEvents, windowStartMs); i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    const eventMs = tsMs(event.ts);
    if (eventMs > windowEndMs) {
      break;
    }
    if (event.type === "failure_confirmed") {
      return true;
    }
  }
  return false;
};

const mergeNearbyBlipBands = (bands, gapMs = 8000) => {
  if (bands.length <= 1) {
    return bands;
  }

  const sorted = [...bands].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged = [{ start: sorted[0].start, end: sorted[0].end }];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start.getTime() - prev.end.getTime() <= gapMs) {
      if (cur.end.getTime() > prev.end.getTime()) {
        prev.end = cur.end;
      }
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }

  return merged;
};

const pushBlipBandIfClear = (bands, start, end, ...bandLists) => {
  if (overlapsAnyBands(start, end, ...bandLists)) {
    return;
  }
  bands.push({ start, end });
};

const buildBlipBands = (sortedEvents, sortedPings, outageBands) => {
  const bands = [];

  for (const event of sortedEvents) {
    if (event.type !== "blip") continue;

    const end = new Date(event.ts);
    const start = findFailureStreakStart(sortedPings, end);
    pushBlipBandIfClear(bands, start, end, outageBands, bands);
  }

  for (let i = 0; i < sortedPings.length; i++) {
    if (sortedPings[i].ok) continue;

    const streakStart = i;
    while (i < sortedPings.length && !sortedPings[i].ok) i++;

    const start = new Date(sortedPings[streakStart].ts);
    const end = i < sortedPings.length ? new Date(sortedPings[i].ts) : start;
    const failCount = i - streakStart;

    if (overlapsAnyBands(start, end, outageBands, bands)) continue;
    if (hasFailureConfirmedNear(start, end, sortedEvents)) continue;
    if (failCount <= BLIP_MAX_SECONDS) bands.push({ start, end });
  }

  for (const ping of sortedPings) {
    if (ping.ok) continue;
    const ts = new Date(ping.ts);
    pushBlipBandIfClear(bands, ts, ts, outageBands, bands);
  }

  return mergeNearbyBlipBands(bands);
};

const updateTimelineBands = (sortedEvents, sortedPings, status) => {
  const allOutageBands = buildOutageBands(sortedEvents, sortedPings, status);
  const shortOutageBlips = [];
  const confirmedOutages = [];

  for (const band of allOutageBands) {
    if (bandDurationSec(band) <= BLIP_MAX_SECONDS) shortOutageBlips.push(band);
    else confirmedOutages.push(band);
  }

  outageBands = confirmedOutages;
  blipBands = enrichBlipBandsFromPings(
    mergeNearbyBlipBands([...shortOutageBlips, ...buildBlipBands(sortedEvents, sortedPings, outageBands)]),
    sortedPings
  );
  timelineGapIntervals = mergeTimelineGapIntervals(outageBands, blipBands);
};

const isPingInTimelineGap = (ping) => isTimeMsInMergedIntervals(tsMs(ping.ts), timelineGapIntervals);

const pingSecondKey = (ts) => {
  return Math.floor(tsMs(ts) / 1000);
};

// Input must be sorted by time. Keeps the last ping in each UTC second.
const dedupePingsBySecond = (sortedPings) => {
  if (sortedPings.length === 0) {
    return [];
  }

  const deduped = [sortedPings[0]];
  let lastKey = pingSecondKey(sortedPings[0].ts);
  for (let i = 1; i < sortedPings.length; i++) {
    const ping = sortedPings[i];
    const key = pingSecondKey(ping.ts);
    if (key === lastKey) {
      deduped[deduped.length - 1] = ping;
    } else {
      deduped.push(ping);
      lastKey = key;
    }
  }
  return deduped;
};

const buildRTTLinePoints = (sortedPings, fallbackTarget = "") => {
  return dedupePingsBySecond(sortedPings).map((ping) => {
    const inGap = isPingInTimelineGap(ping) || !ping.ok || ping.rtt_ms == null;
    return {
      x: new Date(ping.ts),
      y: inGap ? null : ping.rtt_ms,
      target: ping.target || fallbackTarget,
    };
  });
};

const renderChartData = (sortedPings, sortedEvents, status, summary) => {
  if (!chart) {
    return;
  }

  updateTimelineBands(sortedEvents, sortedPings, status);

  const linePoints = buildRTTLinePoints(sortedPings, status?.target ?? "");
  chart.data.datasets[0].data = linePoints;
  applyChartTimeScale(chart, summary);
  applyLineChartYScale(linePoints);
  chart.update("none");
};

const renderEvents = (events) => {
  if (!events.length) {
    eventListEl.innerHTML = "<li>No events in this range.</li>";
    return;
  }

  eventListEl.innerHTML = events
    .slice()
    .reverse()
    .map((e) => {
      const downtime =
        e.type === "recovered" && e.downtime
          ? `<strong class="downtime">Down for ${escapeHtml(e.downtime)}</strong> · `
          : "";
      const typeLabel = EVENT_TYPE_LABELS[e.type] || e.type;
      return `<li><span class="event-type ${e.type}">${escapeHtml(typeLabel)}</span>${fmtTime(e.ts)} — ${downtime}${escapeHtml(e.detail || "")}</li>`;
    })
    .join("");
};

const TRACE_IP_PATTERN = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g;
const TRACE_MS_PATTERN = /(\d+)\s*ms/gi;

const applyTraceLineHighlightReplacements = (html) =>
  html
    .replace(/\*+/g, '<span class="trace-star">*</span>')
    .replace(TRACE_MS_PATTERN, '<span class="trace-ms">$1 ms</span>')
    .replace(TRACE_IP_PATTERN, '<span class="trace-ip">$1</span>');

const highlightTracerouteOutput = (raw) => {
  return String(raw)
    .split("\n")
    .map((line) => {
      let html = escapeHtml(line);
      if (!html) {
        return "";
      }

      if (/tracert|traceroute|tracing route/i.test(line)) {
        return `<span class="trace-label">${html}</span>`;
      }

      if (/\*|timed out|unreachable|failed|could not|request timed out|general failure|error/i.test(line)) {
        return `<span class="trace-error">${applyTraceLineHighlightReplacements(html)}</span>`;
      }

      html = html.replace(/^(\s*\d+)\s+/, '<span class="trace-hop">$1</span> ');
      return applyTraceLineHighlightReplacements(html);
    })
    .join("\n");
};

const renderTraceroute = (tr, outputEl, emptyMessage = "No traceroute recorded yet.") => {
  if (!outputEl) {
    return;
  }
  if (!tr || !tr.output) {
    outputEl.textContent = emptyMessage;
    outputEl.classList.remove("trace-output");
    return;
  }
  outputEl.classList.add("trace-output");
  const header = `[${fmtTime(tr.ts)}]`;
  outputEl.innerHTML = `<span class="trace-ts">${escapeHtml(header)}</span>\n${highlightTracerouteOutput(tr.output)}`;
};

const formatIntervalLabel = (seconds) => {
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
};

const renderTraceIntervalHints = () => {
  if (traceHealthyMetaEl) {
    traceHealthyMetaEl.textContent =
      `Routine path check every ${formatIntervalLabel(healthyTraceIntervalSec)} while Status is UP`;
  }
  if (traceOutageMetaEl) {
    traceOutageMetaEl.textContent =
      `During confirmed outages, every ${formatIntervalLabel(traceIntervalSec)}`;
  }
};

async function loadTraceIntervals(settingsData = null) {
  try {
    const data = settingsData ?? (await fetchJSON("/api/settings"));
    if (!data) {
      return;
    }
    applyTraceIntervalSettings(data);
  } catch {
    // Keep defaults when settings are unavailable.
  }
  renderTraceIntervalHints();
}

async function getSpeedtestConfig() {
  if (speedtestConfigCache) {
    return speedtestConfigCache;
  }
  speedtestConfigCache = await fetchJSON("/api/speedtest/config");
  return speedtestConfigCache;
}

const fmtBytes = (bytes) => {
  if (bytes == null || bytes === 0) return "empty";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const renderLogInfo = (info) => {
  if (!info || !info.available) {
    if (logMetaEl) logMetaEl.textContent = "";
    if (logDownloadWrap) logDownloadWrap.hidden = true;
    return;
  }

  if (logDownloadWrap) logDownloadWrap.hidden = false;
  const modified = info.modified ? fmtTime(info.modified) : "not created yet";
  if (logMetaEl) {
    logMetaEl.textContent = `${fmtBytes(info.size_bytes)} · updated ${modified}`;
  }
};

const handleRefreshError = (err) => {
  console.error(err);
  showRangeError(err.message);
};

const appendSpeedTestCacheBuster = (url) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}nocache=${Date.now()}`;
};

const buildSpeedTestDownloadUrl = (baseUrl, downloadBytes) => {
  const parsed = new URL(baseUrl);
  parsed.searchParams.set("bytes", String(downloadBytes));
  return parsed.toString();
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = SPEEDTEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  try {
    const { signal: _ignored, ...fetchOptions } = options;
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const polarToCartesian = (cx, cy, r, angleDeg) => {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const describeGaugeArc = (cx, cy, r, startDeg, endDeg) => {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
};

const build125SeriesCandidatesMbps = (maxMbps) => {
  const values = [0];
  const max = Math.max(1, maxMbps);
  const maxExp = Math.ceil(Math.log10(max));
  for (let exp = 0; exp <= maxExp; exp++) {
    const base = 10 ** exp;
    const multipliers = exp === 0 ? [1, 5] : [1, 2, 5];
    for (const multiplier of multipliers) {
      const value = multiplier * base;
      if (value <= max) {
        values.push(value);
      }
    }
  }
  return [...new Set(values)].sort((a, b) => a - b);
};

const pruneGaugeTickValuesMbps = (candidates, maxMbps) => {
  const max = Math.max(1, maxMbps);
  const floor = max / 1000;
  const ticks = candidates.filter((value) => value === 0 || value >= floor);
  if (!ticks.includes(max)) {
    ticks.push(max);
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
};

const getGaugeTickValuesMbps = (maxMbps) =>
  pruneGaugeTickValuesMbps(build125SeriesCandidatesMbps(maxMbps), maxMbps);

const formatGaugeTickUnitValue = (value, unit) => {
  if (value >= 100) {
    return `${Math.round(value)}${unit}`;
  }
  if (value >= 10) {
    return `${Math.round(value)}${unit}`;
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}${unit}` : `${rounded}${unit}`;
};

const formatSpeedGaugeTickLabel = (mbps) => {
  if (mbps === 0) {
    return "0";
  }
  if (mbps < 1000) {
    return formatGaugeTickUnitValue(mbps, " Mbps");
  }
  if (mbps < 1_000_000) {
    return formatGaugeTickUnitValue(mbps / 1000, " Gbps");
  }
  if (mbps < 1_000_000_000) {
    return formatGaugeTickUnitValue(mbps / 1_000_000, " Tbps");
  }
  return formatGaugeTickUnitValue(mbps / 1_000_000_000, " Pbps");
};

const computeGaugePeakMbps = (mbps) => {
  const current = Math.max(0, Number(mbps) || 0);
  return Math.max(current, speedtestGaugeStoredDownload || 0, speedtestGaugeStoredUpload || 0);
};

const computeGaugeMaxMbps = (peakMbps) => {
  const peak = Math.max(0, Number(peakMbps) || 0);
  return peak > 0 ? peak : SPEEDTEST_GAUGE_DEFAULT_MAX_MBPS;
};

const mbpsToGaugeFraction = (mbps, maxMbps = speedtestGaugeMaxMbps) => {
  const value = Math.max(0, Number(mbps) || 0);
  const max = Math.max(1, maxMbps);
  return Math.min(1, Math.max(0, Math.log10(value + 1) / Math.log10(max + 1)));
};

const syncSpeedTestGaugeScale = (mbps) => {
  const maxMbps = computeGaugeMaxMbps(computeGaugePeakMbps(mbps));
  if (maxMbps !== speedtestGaugeMaxMbps) {
    speedtestGaugeMaxMbps = maxMbps;
    renderSpeedTestGaugeTicks(maxMbps);
  }
  return maxMbps;
};

const fractionToGaugeAngle = (fraction) =>
  SPEEDTEST_GAUGE.startDeg + Math.max(0, Math.min(1, fraction)) * SPEEDTEST_GAUGE.sweepDeg;

const formatGaugeMbps = (value) => {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
};

const normalizeStoredMbps = (value) => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return null;
  }
  return value;
};

const setSpeedTestGaugeResults = (downloadMbps, uploadMbps) => {
  if (downloadMbps !== undefined) {
    speedtestGaugeStoredDownload = normalizeStoredMbps(downloadMbps);
  }
  if (uploadMbps !== undefined) {
    speedtestGaugeStoredUpload = normalizeStoredMbps(uploadMbps);
  }
  if (speedtestGaugeDownloadEl) {
    speedtestGaugeDownloadEl.textContent = formatGaugeMbps(speedtestGaugeStoredDownload);
  }
  if (speedtestGaugeUploadEl) {
    speedtestGaugeUploadEl.textContent = formatGaugeMbps(speedtestGaugeStoredUpload);
  }
  updateSpeedTestGaugeSelectionUI();
};

const speedTestGaugeUsesUploadStyle = () =>
  speedtestGaugePhase === "upload" ||
  (["idle", "done"].includes(speedtestGaugePhase) &&
    speedtestGaugeDisplayMode === "upload" &&
    !speedtestRunning);

const updateSpeedTestGaugeSelectionUI = () => {
  if (speedtestGaugeDownloadLabelBtn) {
    speedtestGaugeDownloadLabelBtn.classList.toggle("is-active", speedtestGaugeDisplayMode === "download");
    speedtestGaugeDownloadLabelBtn.classList.remove("is-upload-view");
  }
  if (speedtestGaugeUploadLabelBtn) {
    speedtestGaugeUploadLabelBtn.classList.toggle("is-active", speedtestGaugeDisplayMode === "upload");
    speedtestGaugeUploadLabelBtn.classList.toggle("is-upload-view", speedtestGaugeDisplayMode === "upload");
  }
};

const applySpeedTestGaugeDisplay = () => {
  if (speedtestRunning || speedtestGaugePhase === "download" || speedtestGaugePhase === "upload") {
    return;
  }
  const mbps =
    speedtestGaugeDisplayMode === "upload"
      ? speedtestGaugeStoredUpload
      : speedtestGaugeStoredDownload;
  updateSpeedTestGauge(mbps, speedtestGaugePhase === "done" ? "done" : "idle");
};

const setSpeedTestGaugeDisplayMode = (mode) => {
  if (mode !== "download" && mode !== "upload") {
    return;
  }
  speedtestGaugeDisplayMode = mode;
  updateSpeedTestGaugeSelectionUI();
  applySpeedTestGaugeDisplay();
};

const updateSpeedTestGauge = (mbps, phase) => {
  if (phase) {
    speedtestGaugePhase = phase;
  }
  const maxMbps = syncSpeedTestGaugeScale(mbps);
  const { cx, cy, r, startDeg } = SPEEDTEST_GAUGE;
  const endDeg = fractionToGaugeAngle(mbpsToGaugeFraction(mbps, maxMbps));
  const visibleEndDeg = Math.max(startDeg + 0.5, endDeg);

  if (speedtestGaugeProgressEl) {
    speedtestGaugeProgressEl.setAttribute("d", describeGaugeArc(cx, cy, r, startDeg, visibleEndDeg));
    speedtestGaugeProgressEl.classList.toggle("is-upload", speedTestGaugeUsesUploadStyle());
  }
  if (speedtestGaugeKnobEl) {
    const knob = polarToCartesian(cx, cy, r, visibleEndDeg);
    speedtestGaugeKnobEl.setAttribute("cx", knob.x.toFixed(2));
    speedtestGaugeKnobEl.setAttribute("cy", knob.y.toFixed(2));
  }
  if (speedtestGaugeValueEl) {
    speedtestGaugeValueEl.textContent = formatGaugeMbps(mbps);
  }
  if (speedtestGaugePhaseTextEl) {
    if (speedtestGaugePhase === "download") {
      speedtestGaugePhaseTextEl.textContent = "Testing download…";
    } else if (speedtestGaugePhase === "upload") {
      speedtestGaugePhaseTextEl.textContent = "Testing upload…";
    } else if (speedtestGaugePhase === "done") {
      speedtestGaugePhaseTextEl.textContent = "Test complete";
    } else {
      speedtestGaugePhaseTextEl.textContent = "Ready to test";
    }
  }
  if (speedtestGaugePhaseIconEl) {
    speedtestGaugePhaseIconEl.hidden = speedtestGaugePhase !== "upload";
  }
};

const renderSpeedTestGaugeTicks = (maxMbps = speedtestGaugeMaxMbps) => {
  if (!speedtestGaugeTicksEl) {
    return;
  }
  speedtestGaugeTicksEl.replaceChildren();
  const svgNs = "http://www.w3.org/2000/svg";
  const { cx, cy, startDeg, sweepDeg, labelRadius } = SPEEDTEST_GAUGE;
  const tickValues = getGaugeTickValuesMbps(maxMbps);
  for (const tickMbps of tickValues) {
    const fraction = mbpsToGaugeFraction(tickMbps, maxMbps);
    const angle = startDeg + fraction * sweepDeg;
    const labelPos = polarToCartesian(cx, cy, labelRadius, angle);
    const group = document.createElementNS(svgNs, "g");
    group.setAttribute("class", "speedtest-gauge-tick");
    group.setAttribute(
      "transform",
      `translate(${labelPos.x.toFixed(2)}, ${labelPos.y.toFixed(2)})`
    );
    const text = document.createElementNS(svgNs, "text");
    text.setAttribute("class", "speedtest-gauge-tick-label");
    text.setAttribute("x", "0");
    text.setAttribute("y", "0");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = formatSpeedGaugeTickLabel(tickMbps);
    group.appendChild(text);
    speedtestGaugeTicksEl.appendChild(group);
    const bbox = text.getBBox();
    const padX = 3;
    const padY = 1.5;
    const rect = document.createElementNS(svgNs, "rect");
    rect.setAttribute("class", "speedtest-gauge-tick-bg");
    rect.setAttribute("x", (bbox.x - padX).toFixed(2));
    rect.setAttribute("y", (bbox.y - padY).toFixed(2));
    rect.setAttribute("width", (bbox.width + padX * 2).toFixed(2));
    rect.setAttribute("height", (bbox.height + padY * 2).toFixed(2));
    rect.setAttribute("rx", "3");
    group.insertBefore(rect, text);
  }
};

const resetSpeedTestGauge = () => {
  speedtestGaugeStoredDownload = null;
  speedtestGaugeStoredUpload = null;
  speedtestGaugeDisplayMode = "download";
  speedtestGaugeMaxMbps = SPEEDTEST_GAUGE_DEFAULT_MAX_MBPS;
  renderSpeedTestGaugeTicks(speedtestGaugeMaxMbps);
  updateSpeedTestGauge(null, "idle");
  updateSpeedTestGaugeSelectionUI();
};

const initSpeedTestGauge = () => {
  if (!speedtestGaugeTrackEl) {
    return;
  }
  const { cx, cy, r, startDeg, sweepDeg } = SPEEDTEST_GAUGE;
  speedtestGaugeTrackEl.setAttribute("d", describeGaugeArc(cx, cy, r, startDeg, startDeg + sweepDeg));
  resetSpeedTestGauge();
  if (speedtestGaugeDownloadEl) {
    speedtestGaugeDownloadEl.textContent = "—";
  }
  if (speedtestGaugeUploadEl) {
    speedtestGaugeUploadEl.textContent = "—";
  }
  if (speedtestGaugeDownloadLabelBtn) {
    speedtestGaugeDownloadLabelBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setSpeedTestGaugeDisplayMode("download");
    });
  }
  if (speedtestGaugeUploadLabelBtn) {
    speedtestGaugeUploadLabelBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setSpeedTestGaugeDisplayMode("upload");
    });
  }
};

const setSpeedTestControlsRunning = (running) => {
  if (speedtestRunBtn) {
    speedtestRunBtn.disabled = running;
  }
  if (speedtestCancelBtn) {
    speedtestCancelBtn.hidden = !running;
  }
};

const cancelSpeedTest = () => {
  if (speedtestAbortController) {
    speedtestAbortController.abort();
  }
};

const downloadOnce = async (baseUrl, downloadBytes, { onProgress, signal } = {}) => {
  const url = appendSpeedTestCacheBuster(buildSpeedTestDownloadUrl(baseUrl, downloadBytes));
  const start = performance.now();
  const response = await fetchWithTimeout(url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`Download test failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error("Download test failed (no response body)");
  }

  const reader = response.body.getReader();
  let bytesReceived = 0;
  while (true) {
    if (signal?.aborted) {
      throw new DOMException("Speed test cancelled", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytesReceived += value.length;
    const elapsedSec = (performance.now() - start) / 1000;
    if (elapsedSec > 0 && onProgress) {
      onProgress((bytesReceived * 8) / (elapsedSec * 1_000_000), bytesReceived);
    }
  }

  const durationSec = (performance.now() - start) / 1000;
  if (durationSec <= 0) {
    throw new Error("Download test failed (zero duration)");
  }

  return {
    bytes: bytesReceived,
    durationSec,
    mbps: (bytesReceived * 8) / (durationSec * 1_000_000),
  };
};

const measureDownloadSpeed = async (configuredUrl, downloadBytes, { onProgress, signal } = {}) => {
  const primaryUrl = configuredUrl || "https://speed.cloudflare.com/__down";
  let serverUrl = primaryUrl;
  let runs = [];

  const runThree = async (url) => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      const result = await downloadOnce(url, downloadBytes, {
        signal,
        onProgress: i === 0 ? null : onProgress,
      });
      if (i > 0) {
        results.push(result);
      }
    }
    return results;
  };

  try {
    runs = await runThree(primaryUrl);
  } catch {
    if (speedtestStatusEl) {
      speedtestStatusEl.textContent = "Primary download failed, retrying with fallback CDN…";
    }
    serverUrl = SPEEDTEST_FALLBACK_URL;
    runs = await runThree(serverUrl);
  }

  const downloadMbps = runs.reduce((sum, run) => sum + run.mbps, 0) / runs.length;
  const downloadBytesAvg = Math.round(runs.reduce((sum, run) => sum + run.bytes, 0) / runs.length);

  return {
    downloadMbps,
    downloadBytes: downloadBytesAvg,
    serverUrl,
  };
};

const measureUploadSpeed = async ({ signal } = {}) => {
  const result = await postJSON("/api/speedtest/upload", {}, { signal });
  const uploadMbps = Number(result.upload_mbps);
  if (!Number.isFinite(uploadMbps) || uploadMbps <= 0) {
    throw new Error("Upload test failed (no result)");
  }
  return {
    uploadMbps,
    uploadBytes: result.upload_bytes,
    serverUrl: result.server_url,
  };
};

const formatSpeedtestMbps = (value) => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return "—";
  }
  return value.toFixed(1);
};

const formatSpeedtestRateDisplay = (value) => {
  const formatted = formatSpeedtestMbps(value);
  return formatted === "—" ? formatted : `${formatted} Mbps`;
};

const formatSpeedtestLatencyDisplay = (value) => {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value)} ms`;
};

const getSpeedtestLatencyColor = (latencyMs) => {
  const ms = Number.parseFloat(latencyMs);
  if (!Number.isFinite(ms)) {
    return "";
  }
  if (ms <= 30) {
    return PALETTE.rttExcellent;
  }
  if (ms <= 80) {
    return PALETTE.rttAverage;
  }
  return PALETTE.rttBad;
};

const getJitterColor = (jitterMs) => {
  const ms = Number.parseFloat(jitterMs);
  if (!Number.isFinite(ms)) {
    return "";
  }
  if (ms <= 5) {
    return PALETTE.rttExcellent;
  }
  if (ms <= 15) {
    return PALETTE.rttAverage;
  }
  return PALETTE.rttBad;
};

const renderSpeedTestResultCards = (result) => {
  if (speedtestDownloadValEl) {
    speedtestDownloadValEl.textContent = formatSpeedtestRateDisplay(result.downloadMbps);
  }
  if (speedtestUploadValEl) {
    speedtestUploadValEl.textContent = formatSpeedtestRateDisplay(result.uploadMbps);
  }
  if (speedtestLatencyValEl) {
    speedtestLatencyValEl.textContent = formatSpeedtestLatencyDisplay(result.latencyMs);
    speedtestLatencyValEl.style.color = getSpeedtestLatencyColor(result.latencyMs);
  }
  if (speedtestServerLabelEl) {
    speedtestServerLabelEl.textContent = result.serverUrl
      ? `Download server: ${result.serverUrl}`
      : "";
  }
};

const destroySpeedTestChart = () => {
  if (speedtestChart) {
    speedtestChart.destroy();
    speedtestChart = null;
  }
};

const applySpeedTestChartLayerVisibility = () => {
  if (!speedtestChart) {
    return;
  }
  for (const layer of SPEEDTEST_CHART_LAYERS) {
    speedtestChart.setDatasetVisibility(
      layer.datasetIndex,
      speedtestChartLayerVisible[layer.id] !== false
    );
  }
  speedtestChart.update("none");
};

const renderSpeedTestChartLegend = () => {
  renderCheckboxChartLegend({
    container: speedtestChartLegendContainer,
    layers: SPEEDTEST_CHART_LAYERS,
    visibilityMap: speedtestChartLayerVisible,
    onVisibilityChange: applySpeedTestChartLayerVisibility,
  });
};

const buildSpeedTestChart = () => {
  const canvas = document.getElementById("speedtest-chart");
  if (!canvas) {
    return;
  }
  destroySpeedTestChart();
  speedtestChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Download (Mbps)",
          data: [],
          borderColor: PALETTE.speedtestDownload,
          backgroundColor: paletteRgba(PALETTE.speedtestDownload, 0.15),
          pointRadius: 2,
          borderWidth: 2,
          tension: 0,
          spanGaps: false,
        },
        {
          label: "Upload (Mbps)",
          data: [],
          borderColor: PALETTE.speedtestUpload,
          backgroundColor: paletteRgba(PALETTE.speedtestUpload, 0.15),
          pointRadius: 2,
          borderWidth: 2,
          tension: 0,
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false, axis: "x" },
      scales: {
        x: {
          type: "time",
          time: {
            tooltipFormat: "PPpp",
            displayFormats: {
              minute: "h:mm a",
              hour: "MMM d, ha",
              day: "MMM d",
            },
            round: false,
          },
          grid: getDashboardChartGridOptions(),
          ticks: { color: PALETTE.chartTick, autoSkip: true, maxRotation: 0 },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Mbps", color: PALETTE.chartTick },
          grid: getDashboardChartGridOptions(),
          ticks: { color: PALETTE.chartTick },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
  applySpeedTestChartLayerVisibility();
  renderSpeedTestChartLegend();
};

const applySpeedTestChartTimeScale = (summary) => applyChartTimeScale(speedtestChart, summary);

const renderSpeedTestChart = (history, summary) => {
  if (!speedtestChart) {
    buildSpeedTestChart();
  }
  if (!speedtestChart) {
    return;
  }

  const rangeKey = getChartRangeKey();
  if (speedtestChartRangeKey !== rangeKey) {
    destroySpeedTestChart();
    buildSpeedTestChart();
    speedtestChartRangeKey = rangeKey;
  }
  if (!speedtestChart) {
    return;
  }

  const downloadPoints = [];
  const uploadPoints = [];
  for (const row of history) {
    const x = new Date(row.ts);
    if (row.download_mbps != null) {
      downloadPoints.push({ x, y: row.download_mbps });
    }
    if (row.upload_mbps != null && row.upload_mbps > 0) {
      uploadPoints.push({ x, y: row.upload_mbps });
    }
  }

  speedtestChart.data.datasets[0].data = downloadPoints;
  speedtestChart.data.datasets[1].data = uploadPoints;
  applySpeedTestChartTimeScale(summary);
  speedtestChart.update("none");
};

const updateSpeedTestDataUsage = (config) => {
  if (!speedtestDataUsageEl || !config) {
    return;
  }
  const downloadBytes = config.download_bytes || 10_000_000;
  const uploadBytes = config.upload_bytes || SPEEDTEST_UPLOAD_BYTES;
  const intervalMin = config.interval_min || 60;
  const monthlyMB = Math.round(
    ((downloadBytes + uploadBytes) / 1_000_000) * (60 / intervalMin) * 24 * 30
  );
  speedtestDataUsageEl.textContent =
    `~${monthlyMB} MB/month at current settings (${intervalMin} min interval)`;
};

const refreshSpeedTestChart = async (summary = null) => {
  try {
    const rangeQuery = buildRangeQuery();
    const [history, summaryData, config] = await Promise.all([
      fetchJSON(`/api/speedtest/history?${rangeQuery}&limit=${SPEEDTEST_HISTORY_LIMIT}`),
      summary ? Promise.resolve(summary) : fetchJSON(`/api/summary?${rangeQuery}`),
      getSpeedtestConfig(),
    ]);
    updateSpeedTestDataUsage(config);
    renderSpeedTestChart(Array.isArray(history) ? history : [], summaryData);
    if (history.length > 0 && !speedtestRunning) {
      const latest = history[history.length - 1];
      renderSpeedTestResultCards({
        downloadMbps: latest.download_mbps,
        uploadMbps: latest.upload_mbps,
        latencyMs: latest.latency_ms,
        serverUrl: latest.server_url,
      });
      setSpeedTestGaugeResults(latest.download_mbps, latest.upload_mbps);
      applySpeedTestGaugeDisplay();
    }
  } catch (err) {
    console.error(err);
  }
};

const runSpeedTest = async () => {
  if (speedtestRunning) {
    return;
  }

  speedtestRunning = true;
  speedtestAbortController = new AbortController();
  const signal = speedtestAbortController.signal;
  setSpeedTestControlsRunning(true);
  if (speedtestStatusEl) {
    speedtestStatusEl.textContent = "Running… (this may take 30–60 seconds)";
  }
  if (speedtestErrorEl) {
    speedtestErrorEl.hidden = true;
    speedtestErrorEl.textContent = "";
  }
  updateSpeedTestGauge(0, "download");
  setSpeedTestGaugeResults(null, null);

  const testStart = performance.now();
  let errorMsg = "";
  let downloadMbps = null;
  let uploadMbps = null;
  let latencyMs = null;
  let downloadBytes = 0;
  let uploadBytes = 0;
  let serverUrl = "";

  try {
    const status = await fetchJSON("/api/status");
    latencyMs = status.last_rtt_ms ?? null;

    const config = await getSpeedtestConfig();
    updateSpeedTestDataUsage(config);
    const download = await measureDownloadSpeed(config.download_url, config.download_bytes, {
      signal,
      onProgress: (mbps) => updateSpeedTestGauge(mbps, "download"),
    });
    downloadMbps = download.downloadMbps;
    downloadBytes = download.downloadBytes;
    serverUrl = download.serverUrl;
    setSpeedTestGaugeResults(downloadMbps, undefined);
    updateSpeedTestGauge(downloadMbps, "download");

    updateSpeedTestGauge(speedtestGaugeStoredDownload, "upload");
    const upload = await measureUploadSpeed({ signal });
    uploadMbps = upload.uploadMbps;
    uploadBytes = upload.uploadBytes;
    setSpeedTestGaugeResults(downloadMbps, uploadMbps);
    speedtestGaugeDisplayMode = "upload";
    updateSpeedTestGaugeSelectionUI();
    updateSpeedTestGauge(uploadMbps, "done");
  } catch (err) {
    if (err.name === "AbortError") {
      errorMsg = "Speed test cancelled";
      resetSpeedTestGauge();
    } else {
      errorMsg = err.message || String(err);
      updateSpeedTestGauge(null, "idle");
    }
    if (speedtestErrorEl) {
      speedtestErrorEl.textContent = errorMsg;
      speedtestErrorEl.hidden = false;
    }
  }

  const durationSec = (performance.now() - testStart) / 1000;

  if (!signal.aborted) {
    try {
      const speedTestResultPayload = {
        download_mbps: downloadMbps,
        latency_ms: latencyMs,
        download_bytes: downloadBytes,
        upload_bytes: uploadBytes,
        duration_sec: durationSec,
        server_url: serverUrl,
        error: errorMsg,
      };
      if (uploadMbps != null && uploadMbps > 0) {
        speedTestResultPayload.upload_mbps = uploadMbps;
      }
      await postJSON("/api/speedtest/result", speedTestResultPayload);
    } catch (err) {
      console.error(err);
      if (!errorMsg && speedtestErrorEl) {
        speedtestErrorEl.textContent = err.message || "Could not save speed test result.";
        speedtestErrorEl.hidden = false;
      }
    }

    if (!errorMsg) {
      renderSpeedTestResultCards({
        downloadMbps,
        uploadMbps,
        latencyMs,
        serverUrl,
      });
      await refreshSpeedTestChart();
    }
  }

  if (speedtestStatusEl) {
    speedtestStatusEl.textContent = errorMsg
      ? errorMsg
      : `Last test: ${fmtTime(new Date())}`;
  }
  setSpeedTestControlsRunning(false);
  speedtestAbortController = null;
  speedtestRunning = false;
};

const initSpeedTestWidget = () => {
  initSpeedTestGauge();
  buildSpeedTestChart();
  if (speedtestCancelBtn) {
    speedtestCancelBtn.addEventListener("click", cancelSpeedTest);
  }
  if (speedtestRunBtn) {
    speedtestRunBtn.addEventListener("click", () => {
      runSpeedTest().catch((err) => {
        console.error(err);
        speedtestRunning = false;
        speedtestAbortController = null;
        setSpeedTestControlsRunning(false);
        if (speedtestErrorEl) {
          speedtestErrorEl.textContent = err.message || "Speed test failed.";
          speedtestErrorEl.hidden = false;
        }
      });
    });
  }
};

const refreshAll = async () => {
  const rangeQuery = buildRangeQuery();
  showRangeError("");

  await maybeRefreshRTTBaseline();

  const [status, summary, pings, events, traceOutage, traceHealthy, logInfo] = await Promise.all([
    fetchJSON("/api/status"),
    fetchJSON(`/api/summary?${rangeQuery}`),
    fetchJSON(`/api/pings?${rangeQuery}&limit=${PING_FETCH_LIMIT}`),
    fetchJSON(`/api/events?${rangeQuery}`),
    fetchJSON("/api/traceroute/latest"),
    fetchJSON("/api/traceroute/latest-successful"),
    fetchJSON("/api/log/info").catch(() => null),
  ]);

  renderStatus(status);
  renderSummary(summary);
  renderLastOutageTime(traceOutage);
  const sortedPings = sortByTime(pings);
  const sortedEvents = sortByTime(events);
  renderChartData(sortedPings, sortedEvents, status, summary);
  renderUptimeChart(summary);
  renderEvents(events);
  renderTraceroute(traceHealthy, traceHealthyOutputEl);
  renderTraceroute(traceOutage, traceOutageOutputEl, "No outage detected yet.");
  renderLogInfo(logInfo);
  await refreshSpeedTestChart(summary);
};

const INFO_TIP_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.75 4.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Zm.75 2.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 8Z"/></svg>';

const WIDGET_HEADER_TIPS = {
  "line-chart":
    "Round-trip time chart with Ping Delay, Outage, and Blip layers for the selected time range.",
  "pie-chart": "Share of up vs down time in the selected range, based on confirmed outages and blips.",
  speedtest:
    "Historical download and upload speed test results for the selected time range.",
  "speedtest-gauge":
    "Run a live speed test with a real-time gauge showing download and upload throughput.",
};

const INFO_TIP_VIEWPORT_MARGIN = 8;
const INFO_TIP_GAP = 6;

const measureInfoTipPopup = (popup) => {
  popup.style.position = "fixed";
  popup.style.visibility = "hidden";
  popup.style.opacity = "0";
  popup.style.left = "0";
  popup.style.top = "0";
  popup.style.right = "auto";
  popup.style.bottom = "auto";
  popup.style.transform = "none";
  const rect = popup.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
};

const infoTipPlacementFits = (left, top, width, height) => {
  const margin = INFO_TIP_VIEWPORT_MARGIN;
  return (
    left >= margin &&
    top >= margin &&
    left + width <= window.innerWidth - margin &&
    top + height <= window.innerHeight - margin
  );
};

const clampInfoTipPlacement = (left, top, width, height) => {
  const margin = INFO_TIP_VIEWPORT_MARGIN;
  const maxLeft = Math.max(margin, window.innerWidth - margin - width);
  const maxTop = Math.max(margin, window.innerHeight - margin - height);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
};

const getInfoTipPlacements = (btnRect, popupSize, preferBelow) => {
  const { width, height } = popupSize;
  const gap = INFO_TIP_GAP;
  const centerY = btnRect.top + btnRect.height / 2 - height / 2;
  const belowLeft = { left: btnRect.left, top: btnRect.bottom + gap };
  const belowRight = { left: btnRect.right - width, top: btnRect.bottom + gap };
  const aboveLeft = { left: btnRect.left, top: btnRect.top - gap - height };
  const aboveRight = { left: btnRect.right - width, top: btnRect.top - gap - height };
  const rightSide = { left: btnRect.right + gap, top: centerY };
  const leftSide = { left: btnRect.left - gap - width, top: centerY };

  if (preferBelow) {
    return [belowLeft, belowRight, rightSide, leftSide, aboveLeft, aboveRight];
  }
  return [rightSide, leftSide, belowLeft, belowRight, aboveLeft, aboveRight];
};

const positionInfoTipPopup = (wrap) => {
  const btn = wrap.querySelector(".info-tip-btn");
  const popup = wrap.querySelector(".info-tip-popup");
  if (!btn || !popup) {
    return;
  }

  const btnRect = btn.getBoundingClientRect();
  const popupSize = measureInfoTipPopup(popup);
  const preferBelow = Boolean(wrap.closest(".widget-panel-title, .chart-panel-title"));
  const placements = getInfoTipPlacements(btnRect, popupSize, preferBelow);
  let chosen = placements.find((placement) =>
    infoTipPlacementFits(placement.left, placement.top, popupSize.width, popupSize.height)
  );
  if (!chosen) {
    chosen = clampInfoTipPlacement(placements[0].left, placements[0].top, popupSize.width, popupSize.height);
  }

  popup.style.left = `${chosen.left}px`;
  popup.style.top = `${chosen.top}px`;
  popup.style.removeProperty("visibility");
  popup.style.removeProperty("opacity");
};

let infoTipScrollListenerBound = false;

const bindInfoTipScrollReposition = () => {
  if (infoTipScrollListenerBound) {
    return;
  }
  infoTipScrollListenerBound = true;
  const repositionVisibleInfoTips = () => {
    document.querySelectorAll(".info-tip-wrap").forEach((wrap) => {
      if (wrap.matches(":hover") || wrap.contains(document.activeElement)) {
        positionInfoTipPopup(wrap);
      }
    });
  };
  window.addEventListener("scroll", repositionVisibleInfoTips, true);
  window.addEventListener("resize", repositionVisibleInfoTips);
};

const bindInfoTipPositioning = (wrap) => {
  if (wrap.dataset.infoTipPositionBound) {
    return;
  }
  wrap.dataset.infoTipPositionBound = "1";
  const position = () => positionInfoTipPopup(wrap);
  wrap.addEventListener("mouseenter", position);
  wrap.addEventListener("focusin", position);
  bindInfoTipScrollReposition();
};

const createInfoTipButton = (text) => {
  const wrap = document.createElement("span");
  wrap.className = "info-tip-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "info-tip-btn";
  btn.setAttribute("aria-label", "More information");
  btn.innerHTML = INFO_TIP_ICON;
  const popup = document.createElement("span");
  popup.className = "info-tip-popup";
  popup.setAttribute("role", "tooltip");
  popup.textContent = text;
  wrap.appendChild(btn);
  wrap.appendChild(popup);
  bindInfoTipPositioning(wrap);
  return wrap;
};

const initFieldInfoTips = () => {
  document.querySelectorAll("[data-info-tip]").forEach((el) => {
    if (el.querySelector(".info-tip-wrap")) {
      return;
    }
    const text = el.dataset.infoTip;
    if (!text) {
      return;
    }
    el.classList.add("field-label-row");
    el.appendChild(createInfoTipButton(text));
  });
};

const initWidgetHeaderInfoTips = () => {
  if (!window.WidgetDashboard?.definitions) {
    return;
  }

  for (const widget of WidgetDashboard.definitions) {
    const panel = document.getElementById(`widget-${widget.id}`);
    if (!panel) {
      continue;
    }

    const title = panel.querySelector(".widget-panel-title, .chart-panel-title");
    if (!title || title.querySelector(".info-tip-wrap")) {
      continue;
    }

    const tip = WIDGET_HEADER_TIPS[widget.id] || widget.description;
    title.classList.add("field-label-row");
    title.appendChild(createInfoTipButton(tip));
  }
};

const getFocusPanelWidgets = () => [...document.querySelectorAll("#dashboard > section.widget")];

const WIDGET_PANEL_INTERACTIVE_SELECTORS = [
  ".widget-close",
  ".widget-popout",
  ".info-tip-wrap",
  ".widget-drag-handle",
  ".card-drag-handle",
  ".card-close",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "a[href]",
  ".line-chart-legend-item",
  ".uptime-legend-item",
  ".speedtest-gauge-result-label",
].join(", ");

const initFocusPanelWidgets = () => {
  const panels = getFocusPanelWidgets();

  const setSelectedPanel = (selected) => {
    for (const panel of panels) {
      panel.classList.toggle("widget-selected", panel === selected);
    }
  };

  for (const panel of panels) {
    panel.classList.add("widget-focus-panel");
    panel.addEventListener("click", (event) => {
      if (event.target.closest(WIDGET_PANEL_INTERACTIVE_SELECTORS)) {
        return;
      }
      setSelectedPanel(panel.classList.contains("widget-selected") ? null : panel);
    });
  }
};

const openResetAppDialog = () => {
  openDialog(resetAppDialog);
};

const closeResetAppDialog = () => {
  closeDialog(resetAppDialog);
};

const confirmResetApp = async () => {
  if (!resetAppConfirmBtn) {
    return;
  }

  resetAppConfirmBtn.disabled = true;
  if (settingsResetAppBtn) {
    settingsResetAppBtn.disabled = true;
  }

  try {
    const body = await postJSON("/api/app/reset");
    closeResetAppDialog();
    closeSettingsDialog();
    if (body.redirect_url) {
      window.location.href = body.redirect_url;
      return;
    }
    window.location.reload();
  } catch (err) {
    showSettingsError(err.message || "Could not reset the app.");
    closeResetAppDialog();
  } finally {
    resetAppConfirmBtn.disabled = false;
    if (settingsResetAppBtn) {
      settingsResetAppBtn.disabled = false;
    }
  }
};

initTimelineMirrorSync();
initTimelinePopoutView();

WidgetDashboard.init();
installLineChartPopoutButton();
configureTimelinePopoutCloseButton();
initFieldInfoTips();
initWidgetHeaderInfoTips();
initFocusPanelWidgets();
buildChart();
applyPendingTimelineMirrorState();
requestAnimationFrame(() => {
  if (chart) {
    chart.resize();
  }
});
buildUptimeChart();
initSpeedTestWidget();
loadTraceIntervals().catch(() => renderTraceIntervalHints());

const resizeDashboardCharts = () => {
  if (chart) {
    chart.resize();
  }
  if (uptimeChart) {
    uptimeChart.resize();
  }
  if (speedtestChart) {
    speedtestChart.resize();
  }
};

document.addEventListener("dashboard:widgets-changed", resizeDashboardCharts);

document.addEventListener("dashboard:layout-changed", resizeDashboardCharts);

document.addEventListener("dashboard:grid-edit-mode", (event) => {
  applyDashboardChartGridVisibility(event.detail?.active === true);
});

refreshPrivateIP().catch((err) => console.error(err));
refreshPublicIP().catch((err) => console.error(err));
refreshTargetInfo().catch((err) => console.error(err));

initializeDefaultRange()
  .then(() => refreshAll())
  .then(() => publishTimelineMirrorState())
  .then(() => maybeAutoCheckForUpdates())
  .catch((err) => {
    handleRefreshError(err);
    showSubtitleLoadError(err.message || "Failed to load data. Is the monitor running?");
  });

setInterval(() => {
  refreshPrivateIP().catch((err) => console.error(err));
  refreshPublicIP().catch((err) => console.error(err));
}, SOURCE_IP_REFRESH_MS);

setInterval(() => {
  refreshPublicIP().catch((err) => console.error(err));
  refreshTargetInfo().catch((err) => console.error(err));
}, IP_LOOKUP_REFRESH_MS);

rangeSelect.addEventListener("change", () => {
  updateCustomRangeVisibility();
  showRangeError("");
  resetLineChartYScale();
  if (rangeSelect.value === "custom" && (!rangeFrom.value || !rangeTo.value)) {
    setDefaultCustomRange();
  }
  if (rangePlaybackActive) {
    advanceChartRangeWindow();
  } else {
    freezeChartRangeWindow();
  }
  refreshAll().catch(handleRefreshError);
});

if (rangeLiveBtn) {
  rangeLiveBtn.addEventListener("click", () => {
    setRangePlaybackActive(true);
    refreshAll().catch(handleRefreshError);
  });
}

if (rangePauseBtn) {
  rangePauseBtn.addEventListener("click", () => {
    setRangePlaybackActive(false);
    refreshAll().catch(handleRefreshError);
  });
}

applyRangeBtn.addEventListener("click", () => {
  rangeSelect.value = "custom";
  updateCustomRangeVisibility();
  if (!rangePlaybackActive) {
    freezeChartRangeWindow();
  }
  refreshAll().catch(handleRefreshError);
});

resetRangeBtn.addEventListener("click", () => {
  resetRangeControls().then(() => refreshAll().catch(handleRefreshError));
});

if (deleteDataBtn) {
  deleteDataBtn.addEventListener("click", openDeleteDataDialog);
}

if (deleteDataCancelBtn) {
  deleteDataCancelBtn.addEventListener("click", closeDeleteDataDialog);
}

if (deleteDataConfirmBtn) {
  deleteDataConfirmBtn.addEventListener("click", () => {
    confirmDeleteStoredData().catch(handleRefreshError);
  });
}

if (settingsResetAppBtn) {
  settingsResetAppBtn.addEventListener("click", openResetAppDialog);
}

if (resetAppCancelBtn) {
  resetAppCancelBtn.addEventListener("click", closeResetAppDialog);
}

if (resetAppConfirmBtn) {
  resetAppConfirmBtn.addEventListener("click", () => {
    confirmResetApp();
  });
}

if (resetAppDialog) {
  WidgetDashboard.registerDismiss(resetAppDialog, closeResetAppDialog);
}

if (deleteDataDialog) {
  WidgetDashboard.registerDismiss(deleteDataDialog, closeDeleteDataDialog);
}

if (downloadDataBtn) {
  downloadDataBtn.addEventListener("click", openDownloadPanel);
}

if (downloadPanelCancelBtn) {
  downloadPanelCancelBtn.addEventListener("click", closeDownloadPanel);
}

if (downloadPanelOverlay) {
  downloadPanelOverlay.addEventListener("click", (event) => {
    if (event.target === downloadPanelOverlay) {
      closeDownloadPanel();
    }
  });
}

if (downloadPanelDownloadBtn) {
  downloadPanelDownloadBtn.addEventListener("click", () => {
    triggerDownload();
  });
}

if (downloadRangeSelect) {
  downloadRangeSelect.addEventListener("change", () => {
    if (downloadRangeSelect.value === "custom") {
      return;
    }
    applyDownloadPanelPreset();
  });
}

if (downloadSelectAllCheckbox) {
  downloadSelectAllCheckbox.addEventListener("change", () => {
    setDownloadSelectAllChecked(downloadSelectAllCheckbox.checked);
  });
}

for (const id of DOWNLOAD_FORMAT_IDS) {
  const checkbox = getDownloadCheckbox("download-format", id);
  if (checkbox) {
    checkbox.addEventListener("change", syncDownloadSelectAll);
  }
}

for (const id of DOWNLOAD_DATATYPE_IDS) {
  const checkbox = getDownloadCheckbox("download-datatype", id);
  if (checkbox) {
    checkbox.addEventListener("change", syncDownloadSelectAll);
  }
}

if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    openSettingsDialog().catch((err) => showSettingsError(err.message));
  });
}

if (subtitleTargetBtn) {
  subtitleTargetBtn.addEventListener("click", () => {
    openSettingsDialog().catch((err) => showSettingsError(err.message));
  });
}

bindCopyableIpButton(subtitlePrivateIpBtn, subtitlePrivateIpCopiedEl);
bindCopyableValueButton(
  subtitlePrivatePrefixBtn,
  subtitlePrivatePrefixCopiedEl,
  () => subtitlePrivatePrefixBtn?.dataset.subnetMask || ""
);
bindCopyableIpButton(subtitlePrivateGatewayBtn, subtitlePrivateGatewayCopiedEl);
bindCopyableIpButton(subtitlePublicIpBtn, subtitlePublicIpCopiedEl);

if (settingsCancelBtn) {
  settingsCancelBtn.addEventListener("click", closeSettingsDialog);
}

if (settingsIpEchoBtn) {
  settingsIpEchoBtn.addEventListener("click", () => {
    openIpEchoDialog().catch((err) => showIpEchoError(err.message || "Could not open IP echo services."));
  });
}

if (settingsAboutBtn) {
  settingsAboutBtn.addEventListener("click", () => {
    openAboutDialog().catch(() => closeAboutDialog());
  });
}

if (settingsCheckUpdatesBtn) {
  settingsCheckUpdatesBtn.addEventListener("click", () => {
    runUpdateCheck().catch(() => {});
  });
}

if (aboutCloseBtn) {
  aboutCloseBtn.addEventListener("click", closeAboutDialog);
}

if (aboutInstanceCopyBtn) {
  aboutInstanceCopyBtn.addEventListener("click", async () => {
    const id = aboutInstanceCopyBtn.dataset.instanceId;
    if (!id) {
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      aboutInstanceCopyBtn.textContent = "Copied!";
      setTimeout(() => {
        aboutInstanceCopyBtn.textContent = "Copy";
      }, 1500);
    } catch {
      // ignore clipboard errors
    }
  });
}

if (ipEchoCloseBtn) {
  ipEchoCloseBtn.addEventListener("click", closeIpEchoDialog);
}

if (ipEchoDnsCloseBtn) {
  ipEchoDnsCloseBtn.addEventListener("click", closeIpEchoDnsDialog);
}

const openIpEchoProviderRow = (row) => {
  if (!row) {
    return;
  }
  const host = row.dataset.host;
  const provider = ipEchoProvidersCache.find((item) => item.host === host);
  if (provider) {
    openIpEchoDnsDialog(provider);
  }
};

if (ipEchoProviderListEl) {
  ipEchoProviderListEl.addEventListener("click", (event) => {
    openIpEchoProviderRow(event.target.closest(".ip-echo-provider-row"));
  });
  ipEchoProviderListEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const row = event.target.closest(".ip-echo-provider-row");
    if (!row) {
      return;
    }
    event.preventDefault();
    openIpEchoProviderRow(row);
  });
}

if (settingsForm) {
  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applySettings().catch((err) => showSettingsError(err.message));
  });
}

if (settingsTargetInput) {
  settingsTargetInput.addEventListener("input", () => {
    syncTargetPresetSelect();
    syncDefaultTargetButtonHighlight();
    if (settingsError && !settingsError.hidden) {
      showSettingsError("");
    }
  });
}

if (settingsTargetPresetSelect) {
  settingsTargetPresetSelect.addEventListener("change", applySelectedTargetPreset);
}

if (settingsRestoreDefaultsBtn) {
  settingsRestoreDefaultsBtn.addEventListener("click", restoreSettingsFormDefaults);
}

if (settingsDefaultTargetBtn) {
  settingsDefaultTargetBtn.addEventListener("click", () => {
    setSettingsTargetValue(DEFAULT_TARGET);
    settingsTargetInput?.focus();
  });
}

if (settingsAltTargetBtn) {
  settingsAltTargetBtn.addEventListener("click", () => {
    setSettingsTargetValue(ALT_DEFAULT_TARGET);
    settingsTargetInput?.focus();
  });
}

if (settingsUnreachableApplyBtn) {
  settingsUnreachableApplyBtn.addEventListener("click", () => {
    const payload = pendingSettingsPayload;
    closeSettingsUnreachableDialog();
    if (payload) {
      saveSettings(payload).catch((err) => showSettingsError(err.message));
    }
  });
}

if (settingsUnreachableCancelBtn) {
  settingsUnreachableCancelBtn.addEventListener("click", dismissSettingsUnreachableDialog);
}

if (settingsUnreachableDialog) {
  WidgetDashboard.registerDismiss(settingsUnreachableDialog, dismissSettingsUnreachableDialog);
}

if (settingsRetentionYearApplyBtn) {
  settingsRetentionYearApplyBtn.addEventListener("click", () => {
    closeSettingsRetentionYearDialog();
    applySettings({ skipRetentionYearWarning: true }).catch((err) => showSettingsError(err.message));
  });
}

if (settingsRetentionYearCancelBtn) {
  settingsRetentionYearCancelBtn.addEventListener("click", dismissSettingsRetentionYearDialog);
}

if (settingsRetentionYearDialog) {
  WidgetDashboard.registerDismiss(settingsRetentionYearDialog, dismissSettingsRetentionYearDialog);
}

if (settingsRetentionDataDeleteBtn) {
  settingsRetentionDataDeleteBtn.addEventListener("click", () => {
    closeSettingsRetentionDataDialog();
    applySettings({ skipRetentionDataWarning: true, forceDeleteData: true }).catch((err) =>
      showSettingsError(err.message),
    );
  });
}

if (settingsRetentionDataCancelBtn) {
  settingsRetentionDataCancelBtn.addEventListener("click", dismissSettingsRetentionDataDialog);
}

if (settingsRetentionDataDialog) {
  WidgetDashboard.registerDismiss(settingsRetentionDataDialog, dismissSettingsRetentionDataDialog);
}

if (settingsPickFolderBtn) {
  settingsPickFolderBtn.addEventListener("click", () => {
    pickSettingsDataFolder().catch((err) => showSettingsError(err.message));
  });
}

if (settingsWebPortInput) {
  settingsWebPortInput.addEventListener("input", () => {
    if (settingsError && !settingsError.hidden) {
      showSettingsError("");
    }
  });
}

if (settingsDataDirInput) {
  settingsDataDirInput.addEventListener("input", () => {
    if (settingsError && !settingsError.hidden) {
      showSettingsError("");
    }
  });
}

if (settingsRetentionDaysInput) {
  settingsRetentionDaysInput.addEventListener("input", () => {
    if (settingsError && !settingsError.hidden) {
      showSettingsError("");
    }
  });
}

populateTargetPresetSelect();

if (settingsDialog) {
  WidgetDashboard.registerDismiss(settingsDialog, closeSettingsDialog);
}

setInterval(() => {
  if (rangePlaybackActive) {
    advanceChartRangeWindow();
  }
  if (!rangeFrom.value || !rangeTo.value) {
    return;
  }
  refreshAll().catch((err) => console.error(err));
}, 5000);
