const WIDGET_STORAGE_KEY = "networkMonitor.dashboard.widgets";
const WIDGET_PREFS_VERSION = 1;
const LEGACY_WIDGET_STORAGE_KEYS = [
  "networkMonitor.dashboard.widgets.v3",
  "networkMonitor.dashboard.widgets.v2",
  "networkMonitor.dashboard.widgets.v1",
];

const WIDGET_DEFINITIONS = [
  {
    id: "summary-cards",
    label: "Summary Cards",
    description: "Status, RTT, availability, outage time, and latest speed test results",
    defaultVisible: true,
    group: "Overview",
  },
  {
    id: "range-controls",
    label: "Range Controls",
    description: "Time range selector and reset actions",
    defaultVisible: true,
    group: "Controls",
  },
  {
    id: "line-chart",
    label: "Line Chart",
    description: "RTT timeline with outage and blip markers",
    defaultVisible: true,
    group: "Charts",
  },
  {
    id: "pie-chart",
    label: "Pie Chart",
    description: "Up and down time breakdown",
    defaultVisible: true,
    group: "Charts",
  },
  {
    id: "speedtest",
    label: "Internet Speed Test",
    description: "Historical download and upload speed test chart for the selected range",
    defaultVisible: true,
    group: "Charts",
  },
  {
    id: "speedtest-gauge",
    label: "Speed Test",
    description: "Live speed gauge with download and upload readout",
    defaultVisible: true,
    group: "Charts",
  },
  {
    id: "event-list",
    label: "Event List",
    description: "Outages, recoveries, blips, and public IP changes in the selected range",
    defaultVisible: true,
    group: "Activity",
  },
  {
    id: "traceroute-healthy",
    label: "Last Successful Traceroute",
    description: "Routine path check every 5 minutes while Status is UP",
    defaultVisible: true,
    group: "Diagnostics",
  },
  {
    id: "traceroute-outage",
    label: "Latest Traceroute During an Outage",
    description: "Most recent traceroute captured during a confirmed outage",
    defaultVisible: true,
    group: "Diagnostics",
  },
];

const WIDGET_GROUPS = [...new Set(WIDGET_DEFINITIONS.map((widget) => widget.group))];

let modalScrollLockCount = 0;
let lockedScrollY = 0;

const lockPageScroll = () => {
  if (modalScrollLockCount === 0) {
    lockedScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
  }
  modalScrollLockCount += 1;
};

const unlockPageScroll = () => {
  if (modalScrollLockCount <= 0) {
    return;
  }
  modalScrollLockCount -= 1;
  if (modalScrollLockCount === 0) {
    const scrollY = lockedScrollY;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
    window.scrollTo(0, scrollY);
  }
};

const initModalScrollLock = () => {
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("close", () => {
      unlockPageScroll();
    });
  });
};

const modalDismissHandlers = new Map();

const registerModalDismiss = (dialog, onDismiss) => {
  if (!dialog || typeof onDismiss !== "function") {
    return;
  }
  modalDismissHandlers.set(dialog, onDismiss);
};

const runModalDismiss = (dialog, event) => {
  if (!dialog.open) {
    return;
  }
  if (event) {
    event.preventDefault();
  }
  const onDismiss = modalDismissHandlers.get(dialog);
  if (onDismiss) {
    onDismiss();
    return;
  }
  if (dialog.open) {
    toggleModalDialog(dialog, false);
  }
};

const initModalBackdropDismiss = () => {
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => {
      if (!dialog.open) {
        return;
      }
      runModalDismiss(dialog, event);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog || !dialog.open) {
        return;
      }
      runModalDismiss(dialog, event);
    });
  });
};

const initModalBehavior = () => {
  initModalScrollLock();
  initModalBackdropDismiss();
};

const toggleModalDialog = (dialog, open) => {
  if (!dialog) {
    return;
  }
  if (open) {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    lockPageScroll();
    return;
  }
  if (dialog.open) {
    dialog.close();
  }
  dialog.removeAttribute("open");
};

const getDefaultPreferences = () =>
  Object.fromEntries(WIDGET_DEFINITIONS.map((widget) => [widget.id, widget.defaultVisible]));

const extractWidgetMap = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (parsed.version === WIDGET_PREFS_VERSION && parsed.widgets && typeof parsed.widgets === "object") {
    return parsed.widgets;
  }

  // Older flat objects stored widget ids at the top level.
  const hasKnownWidget = WIDGET_DEFINITIONS.some((widget) => typeof parsed[widget.id] === "boolean");
  return hasKnownWidget ? parsed : null;
};

const normalizePreferences = (saved) => {
  const prefs = getDefaultPreferences();

  if (!saved || typeof saved !== "object") {
    return prefs;
  }

  for (const widget of WIDGET_DEFINITIONS) {
    if (typeof saved[widget.id] === "boolean") {
      prefs[widget.id] = saved[widget.id];
    }
  }

  return prefs;
};

const migrateLegacyWidgetMap = (legacyKey, widgets) => {
  const prefs = normalizePreferences(widgets);

  if (
    legacyKey === "networkMonitor.dashboard.widgets.v1" ||
    legacyKey === "networkMonitor.dashboard.widgets.v2"
  ) {
    // Early builds could save pie-chart as hidden while the widget still appeared, or vice versa.
    if (widgets["pie-chart"] === false) {
      prefs["pie-chart"] = true;
    }
  }

  return prefs;
};

const readStoredWidgetMap = () => {
  try {
    const current = localStorage.getItem(WIDGET_STORAGE_KEY);
    if (current) {
      const widgets = extractWidgetMap(JSON.parse(current));
      if (widgets) {
        return widgets;
      }
    }
  } catch {
    // Fall through to legacy keys or defaults.
  }

  for (const legacyKey of LEGACY_WIDGET_STORAGE_KEYS) {
    try {
      const legacyRaw = localStorage.getItem(legacyKey);
      if (!legacyRaw) {
        continue;
      }

      const widgets = extractWidgetMap(JSON.parse(legacyRaw));
      if (widgets) {
        return migrateLegacyWidgetMap(legacyKey, widgets);
      }
    } catch {
      continue;
    }
  }

  return null;
};

const loadWidgetPreferences = () => {
  try {
    const stored = readStoredWidgetMap();
    return normalizePreferences(stored);
  } catch {
    return getDefaultPreferences();
  }
};

const saveWidgetPreferences = (prefs) => {
  localStorage.setItem(
    WIDGET_STORAGE_KEY,
    JSON.stringify({
      version: WIDGET_PREFS_VERSION,
      widgets: normalizePreferences(prefs),
    })
  );
};

const getWidgetElement = (widgetId) => document.getElementById(`widget-${widgetId}`);

const isWidgetVisible = (prefs, widgetId) => prefs[widgetId] !== false;

let dashboardWidgetPrefs = null;

const getLayoutVisibilityPrefs = (prefs) =>
  normalizePreferences(prefs ?? dashboardWidgetPrefs ?? loadWidgetPreferences());

const isLayoutWidgetVisible = (widgetId, prefs) =>
  isWidgetVisible(getLayoutVisibilityPrefs(prefs), widgetId);

const LAYOUT_STORAGE_KEY = "networkMonitor.dashboard.layout";
const LAYOUT_VERSION = 25;
const SUMMARY_CARDS_MIN_DASHBOARD_ROW_SPAN = 3;
const SUMMARY_CARDS_DASHBOARD_ROW_SPAN = 4;
const RANGE_CONTROLS_MIN_DASHBOARD_ROW_SPAN = 2;
const RANGE_CONTROLS_DASHBOARD_ROW_SPAN = 4;
const GRID_COLUMNS = 36;

// Dashboard grid layout invariants — see .cursor/rules/dashboard-grid-layout.mdc
const WIDGET_PANEL_INSET_CSS_VAR = "--widget-panel-inset";
const DASHBOARD_GRID_GAP_CSS_VAR = "--dashboard-grid-gap";

const getWidgetPanelInsetPx = () => {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(WIDGET_PANEL_INSET_CSS_VAR)
    .trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 8;
};

const getDashboardGridGapPx = (dashboard) => {
  const el = dashboard ?? document.querySelector(".dashboard-grid");
  if (!el) {
    return 0;
  }
  const raw = getComputedStyle(el).getPropertyValue(DASHBOARD_GRID_GAP_CSS_VAR).trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const allocatedSpanPixels = (span, cellPx, gap) =>
  span * cellPx + Math.max(0, span - 1) * gap;

const renderedSpanPixels = (span, cellPx, gap, insetPx) =>
  Math.max(0, allocatedSpanPixels(span, cellPx, gap) - 2 * insetPx);

const minSpanForRenderedPixels = (pixels, cellPx, gap, insetPx, floorSpan = 1) => {
  let span = Math.max(1, floorSpan);
  while (span <= 200) {
    if (renderedSpanPixels(span, cellPx, gap, insetPx) >= pixels - 0.5) {
      return span;
    }
    span += 1;
  }
  return span;
};

const DASHBOARD_LAYOUT_STACK = [
  {
    type: "full",
    id: "summary-cards",
    contentSelector: ".cards-grid",
    minRowSpan: SUMMARY_CARDS_MIN_DASHBOARD_ROW_SPAN,
    fallbackRowSpan: SUMMARY_CARDS_DASHBOARD_ROW_SPAN,
  },
  {
    type: "full",
    id: "range-controls",
    contentSelector: ".controls",
    minRowSpan: RANGE_CONTROLS_MIN_DASHBOARD_ROW_SPAN,
    fallbackRowSpan: RANGE_CONTROLS_DASHBOARD_ROW_SPAN,
  },
  {
    type: "row",
    widgets: [
      { id: "line-chart", colSpan: 24 },
      { id: "pie-chart", colSpan: 12 },
    ],
  },
  {
    type: "row",
    widgets: [
      { id: "speedtest", colSpan: 24 },
      { id: "speedtest-gauge", colSpan: 12 },
    ],
  },
  {
    type: "full",
    id: "event-list",
  },
  {
    type: "row",
    widgets: [
      { id: "traceroute-healthy", colSpan: 18 },
      { id: "traceroute-outage", colSpan: 18 },
    ],
  },
];

const SUMMARY_CARD_IDS = [
  "status",
  "last-rtt",
  "availability",
  "avg-rtt",
  "jitter-ms",
  "last-outage",
  "speedtest-download",
  "speedtest-upload",
  "speedtest-latency",
];

const DEFAULT_SUMMARY_CARD_IDS = SUMMARY_CARD_IDS.filter((id) => id !== "last-rtt");

const SUMMARY_CARD_LABELS = {
  status: "Status",
  "last-rtt": "Last RTT",
  availability: "Availability",
  "avg-rtt": "Avg RTT (Ping delay)",
  "jitter-ms": "Jitter",
  "last-outage": "Last confirmed outage",
  "speedtest-download": "Download",
  "speedtest-upload": "Upload",
  "speedtest-latency": "Latency",
};

const GRIP_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="4" r="1.1"/><circle cx="11" cy="4" r="1.1"/><circle cx="5" cy="8" r="1.1"/><circle cx="11" cy="8" r="1.1"/><circle cx="5" cy="12" r="1.1"/><circle cx="11" cy="12" r="1.1"/></svg>';

const DEFAULT_WIDGET_PLACEMENTS = {
  "summary-cards": { col: 1, row: 1, colSpan: 36, rowSpan: SUMMARY_CARDS_DASHBOARD_ROW_SPAN },
  "range-controls": { col: 1, row: 5, colSpan: 36, rowSpan: RANGE_CONTROLS_DASHBOARD_ROW_SPAN },
  "line-chart": { col: 1, row: 9, colSpan: 24, rowSpan: 12 },
  "pie-chart": { col: 25, row: 9, colSpan: 12, rowSpan: 12 },
  "speedtest": { col: 1, row: 21, colSpan: 24, rowSpan: 10 },
  "speedtest-gauge": { col: 25, row: 21, colSpan: 12, rowSpan: 10 },
  "event-list": { col: 1, row: 31, colSpan: 36, rowSpan: 6 },
  "traceroute-healthy": { col: 1, row: 37, colSpan: 18, rowSpan: 9 },
  "traceroute-outage": { col: 19, row: 37, colSpan: 18, rowSpan: 9 },
};

const getDefaultLayout = () => ({
  version: LAYOUT_VERSION,
  widgets: Object.fromEntries(
    WIDGET_DEFINITIONS.map((widget) => [
      widget.id,
      { ...DEFAULT_WIDGET_PLACEMENTS[widget.id] },
    ])
  ),
  summaryCards: [...DEFAULT_SUMMARY_CARD_IDS],
});

const clonePlacement = (placement) => ({
  col: placement.col,
  row: placement.row,
  colSpan: placement.colSpan,
  rowSpan: placement.rowSpan,
});

const layoutDashboardStack = (layout, measureRowSpan, prefs) => {
  let nextRow = 1;

  for (const band of DASHBOARD_LAYOUT_STACK) {
    if (band.type === "full") {
      if (!isLayoutWidgetVisible(band.id, prefs)) {
        continue;
      }
      const placement = layout.widgets[band.id];
      if (!placement) {
        continue;
      }
      placement.col = 1;
      placement.colSpan = GRID_COLUMNS;
      placement.row = nextRow;
      if (measureRowSpan && band.contentSelector) {
        placement.rowSpan = measureRowSpan(
          band.id,
          band.contentSelector,
          band.minRowSpan,
          band.fallbackRowSpan
        );
      }
      nextRow += placement.rowSpan;
      continue;
    }

    if (band.type !== "row") {
      continue;
    }

    const visibleSpecs = band.widgets.filter(
      (spec) => isLayoutWidgetVisible(spec.id, prefs) && layout.widgets[spec.id]
    );
    if (visibleSpecs.length === 0) {
      continue;
    }

    let nextCol = 1;
    let groupRowSpan = 0;
    for (let index = 0; index < visibleSpecs.length; index++) {
      const spec = visibleSpecs[index];
      const placement = layout.widgets[spec.id];
      const colSpan =
        visibleSpecs.length === 1
          ? GRID_COLUMNS
          : index === visibleSpecs.length - 1
            ? GRID_COLUMNS - nextCol + 1
            : spec.colSpan;
      placement.col = nextCol;
      placement.colSpan = colSpan;
      placement.row = nextRow;
      nextCol += colSpan;
      groupRowSpan = Math.max(groupRowSpan, placement.rowSpan);
    }
    nextRow += groupRowSpan;
  }

  return layout;
};

const scalePlacementToFineGrid = (placement) => ({
  col: (placement.col - 1) * 2 + 1,
  row: (placement.row - 1) * 2 + 1,
  colSpan: Math.min(24, placement.colSpan * 2),
  rowSpan: placement.rowSpan * 2,
});

const scalePlacementToFinerGrid = (placement) => ({
  col: Math.round((placement.col - 1) * 1.5) + 1,
  row: Math.round((placement.row - 1) * 1.5) + 1,
  colSpan: Math.min(GRID_COLUMNS, Math.round(placement.colSpan * 1.5)),
  rowSpan: Math.round(placement.rowSpan * 1.5),
});

const shiftWidgetRowsAfter = (layout, afterRow, delta, ...excludeIds) => {
  if (delta === 0) {
    return;
  }
  const excluded = new Set(excludeIds);
  for (const widget of WIDGET_DEFINITIONS) {
    if (excluded.has(widget.id)) {
      continue;
    }
    const placement = layout.widgets[widget.id];
    if (placement && placement.row > afterRow) {
      placement.row += delta;
    }
  }
};

const updateWidgetRowSpanAndShiftBelow = (layout, widgetId, newRowSpan) => {
  const placement = layout.widgets[widgetId];
  if (!placement || placement.rowSpan === newRowSpan) {
    return;
  }
  const oldEndRow = placement.row + placement.rowSpan - 1;
  const delta = newRowSpan - placement.rowSpan;
  placement.rowSpan = newRowSpan;
  shiftWidgetRowsAfter(layout, oldEndRow, delta, widgetId);
};

const migrateLayoutVersion = (layout, savedVersion) => {
  if (savedVersion >= LAYOUT_VERSION) {
    return layout;
  }

  const summary = layout.widgets["summary-cards"];

  if (savedVersion < 2 && summary && summary.rowSpan === 1) {
    summary.rowSpan = 2;
    for (const widget of WIDGET_DEFINITIONS) {
      if (widget.id === "summary-cards") {
        continue;
      }
      const placement = layout.widgets[widget.id];
      if (placement && placement.row > 1) {
        placement.row += 1;
      }
    }
  }

  if (savedVersion < 3 && summary && summary.rowSpan === 2) {
    summary.rowSpan = 3;
    for (const widget of WIDGET_DEFINITIONS) {
      if (widget.id === "summary-cards") {
        continue;
      }
      const placement = layout.widgets[widget.id];
      if (placement && placement.row >= 3) {
        placement.row += 1;
      }
    }
  }

  if (savedVersion < 4) {
    for (const widget of WIDGET_DEFINITIONS) {
      const placement = layout.widgets[widget.id];
      if (!placement) {
        continue;
      }
      layout.widgets[widget.id] = scalePlacementToFineGrid(placement);
    }
  }

  if (savedVersion < 5) {
    const range = layout.widgets["range-controls"];
    if (range) {
      const oldRowSpan = range.rowSpan;
      const newRowSpan = Math.max(4, oldRowSpan);
      if (newRowSpan > oldRowSpan) {
        updateWidgetRowSpanAndShiftBelow(layout, "range-controls", newRowSpan);
      }
    }
  }

  if (savedVersion < 6) {
    const range = layout.widgets["range-controls"];
    if (range && range.rowSpan > 3) {
      updateWidgetRowSpanAndShiftBelow(layout, "range-controls", 3);
    } else if (range && range.rowSpan < 3) {
      updateWidgetRowSpanAndShiftBelow(layout, "range-controls", 3);
    }
  }

  if (savedVersion < 7) {
    for (const widget of WIDGET_DEFINITIONS) {
      const placement = layout.widgets[widget.id];
      if (!placement) {
        continue;
      }
      layout.widgets[widget.id] = scalePlacementToFinerGrid(placement);
    }
  }

  if (savedVersion < 8) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 9) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 4);
    }
  }

  if (savedVersion < 9) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 4) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 6);
    }
  }

  if (savedVersion < 10) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 6) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 7);
    }
  }

  if (savedVersion < 11) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 7) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 6);
    }
  }

  if (savedVersion < 12) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 6) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 5);
    }
  }

  if (savedVersion < 13) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 8) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 5);
    }
  }

  if (savedVersion < 14) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 5) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 6);
    }
  }

  if (savedVersion < 15) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 6) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 4);
    }
  }

  if (savedVersion < 16) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan === 4) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", 6);
    }
  }

  if (savedVersion < 17) {
    const summaryCards = layout.widgets["summary-cards"];
    if (summaryCards && summaryCards.rowSpan !== SUMMARY_CARDS_DASHBOARD_ROW_SPAN) {
      updateWidgetRowSpanAndShiftBelow(layout, "summary-cards", SUMMARY_CARDS_DASHBOARD_ROW_SPAN);
    }
  }

  if (savedVersion < 18) {
    layoutDashboardStack(layout);
  }

  if (savedVersion < 19) {
    layoutDashboardStack(layout);
  }

  if (savedVersion < 20) {
    layoutDashboardStack(layout);
  }

  if (savedVersion < 21) {
    layoutDashboardStack(layout);
    for (const id of ["speedtest-download", "speedtest-upload", "speedtest-latency"]) {
      if (!layout.summaryCards.includes(id)) {
        layout.summaryCards.push(id);
      }
    }
  }

  if (savedVersion < 22) {
    if (!layout.widgets["speedtest-gauge"]) {
      layout.widgets["speedtest-gauge"] = clonePlacement(DEFAULT_WIDGET_PLACEMENTS["speedtest-gauge"]);
    }
    layoutDashboardStack(layout);
  }

  if (savedVersion < 23) {
    const range = layout.widgets["range-controls"];
    if (range && range.rowSpan < RANGE_CONTROLS_DASHBOARD_ROW_SPAN) {
      updateWidgetRowSpanAndShiftBelow(layout, "range-controls", RANGE_CONTROLS_DASHBOARD_ROW_SPAN);
    }
    layoutDashboardStack(layout);
  }

  if (savedVersion < 24) {
    insertDefaultSummaryCard(layout, "jitter-ms");
    layoutDashboardStack(layout);
  }

  if (savedVersion < 25) {
    layoutDashboardStack(layout);
  }

  ensureDefaultSummaryCards(layout);

  layout.version = LAYOUT_VERSION;
  return layout;
};

const insertDefaultSummaryCard = (layout, cardId) => {
  if (!SUMMARY_CARD_IDS.includes(cardId) || layout.summaryCards.includes(cardId)) {
    return;
  }

  const defaultIndex = SUMMARY_CARD_IDS.indexOf(cardId);
  let insertAt = layout.summaryCards.length;
  for (let i = defaultIndex - 1; i >= 0; i--) {
    const anchorIndex = layout.summaryCards.indexOf(SUMMARY_CARD_IDS[i]);
    if (anchorIndex >= 0) {
      insertAt = anchorIndex + 1;
      break;
    }
  }
  layout.summaryCards.splice(insertAt, 0, cardId);
};

const ensureDefaultSummaryCards = (layout) => {
  for (const id of DEFAULT_SUMMARY_CARD_IDS) {
    insertDefaultSummaryCard(layout, id);
  }
  return layout;
};

const normalizeLayout = (saved) => {
  const layout = getDefaultLayout();
  if (!saved || typeof saved !== "object") {
    return layout;
  }

  const savedVersion = Number(saved.version) || 1;

  if (saved.widgets && typeof saved.widgets === "object") {
    for (const widget of WIDGET_DEFINITIONS) {
      const stored = saved.widgets[widget.id];
      const fallback = DEFAULT_WIDGET_PLACEMENTS[widget.id];
      if (!stored || !fallback) {
        continue;
      }
      layout.widgets[widget.id] = {
        col: Math.max(1, Math.min(GRID_COLUMNS, Number(stored.col) || fallback.col)),
        row: Math.max(1, Number(stored.row) || fallback.row),
        colSpan: Math.max(1, Math.min(GRID_COLUMNS, Number(stored.colSpan) || fallback.colSpan)),
        rowSpan: Math.max(1, Number(stored.rowSpan) || fallback.rowSpan),
      };
      if (widget.id === "summary-cards" && layout.widgets[widget.id].rowSpan < SUMMARY_CARDS_MIN_DASHBOARD_ROW_SPAN) {
        layout.widgets[widget.id].rowSpan = SUMMARY_CARDS_MIN_DASHBOARD_ROW_SPAN;
      }
      if (widget.id === "range-controls" && layout.widgets[widget.id].rowSpan < RANGE_CONTROLS_MIN_DASHBOARD_ROW_SPAN) {
        layout.widgets[widget.id].rowSpan = RANGE_CONTROLS_MIN_DASHBOARD_ROW_SPAN;
      }
      if (layout.widgets[widget.id].col + layout.widgets[widget.id].colSpan - 1 > GRID_COLUMNS) {
        layout.widgets[widget.id].col = fallback.col;
        layout.widgets[widget.id].colSpan = fallback.colSpan;
      }
    }
  }

  if (Array.isArray(saved.summaryCards)) {
    layout.summaryCards = saved.summaryCards.filter((id) => SUMMARY_CARD_IDS.includes(id));
  }

  return migrateLayoutVersion(layout, savedVersion);
};

const loadDashboardLayout = () => {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return getDefaultLayout();
    }
    const saved = JSON.parse(raw);
    const layout = normalizeLayout(saved);
    const savedSummaryCards = Array.isArray(saved.summaryCards) ? saved.summaryCards : [];
    const missingSummaryCards = DEFAULT_SUMMARY_CARD_IDS.some((id) => !savedSummaryCards.includes(id));
    if ((Number(saved.version) || 1) < LAYOUT_VERSION || missingSummaryCards) {
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
      } catch {
        // Ignore storage write failures; in-memory layout is still migrated.
      }
    }
    return layout;
  } catch {
    return getDefaultLayout();
  }
};

let dashboardLayout = loadDashboardLayout();

const saveDashboardLayout = (layout) => {
  dashboardLayout = normalizeLayout(layout);
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(dashboardLayout));
};

const resetDashboardLayout = () => {
  const layout = getDefaultLayout();
  saveDashboardLayout(layout);
  applyDashboardLayout(layout);
  return layout;
};

const placementsOverlap = (a, b) =>
  a.col < b.col + b.colSpan &&
  a.col + a.colSpan > b.col &&
  a.row < b.row + b.rowSpan &&
  a.row + a.rowSpan > b.row;

const applyWidgetPlacement = (element, placement) => {
  element.style.gridColumn = `${placement.col} / span ${placement.colSpan}`;
  element.style.gridRow = `${placement.row} / span ${placement.rowSpan}`;
};

const applySummaryCardPlacements = (cardsGrid, cardOrder) => {
  const visible = new Set(cardOrder);
  for (const cardId of SUMMARY_CARD_IDS) {
    const card = cardsGrid.querySelector(`[data-summary-card-id="${cardId}"]`);
    if (!card) {
      continue;
    }
    const isVisible = visible.has(cardId);
    card.toggleAttribute("hidden", !isVisible);
    card.classList.toggle("summary-card-hidden", !isVisible);
    if (isVisible) {
      card.style.removeProperty("display");
    } else {
      card.style.display = "none";
    }
  }

  cardOrder.forEach((cardId) => {
    const card = cardsGrid.querySelector(`[data-summary-card-id="${cardId}"]`);
    if (!card) {
      return;
    }
    cardsGrid.appendChild(card);
    card.style.removeProperty("grid-column");
    card.style.removeProperty("grid-row");
  });
};

const createSummaryCardCloseButton = (cardId) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card-close";
  button.dataset.summaryCardId = cardId;
  const label = SUMMARY_CARD_LABELS[cardId] || cardId;
  button.setAttribute("aria-label", `Hide ${label} card`);
  button.title = `Hide ${label} card`;
  button.textContent = "×";
  return button;
};

const swapSummaryCardsInOrder = (cardIdA, cardIdB) => {
  const layout =
    gridEditModeActive && gridEditLayoutDraft
      ? gridEditLayoutDraft
      : normalizeLayout(dashboardLayout);
  const order = [...layout.summaryCards];
  const fromIndex = order.indexOf(cardIdA);
  const toIndex = order.indexOf(cardIdB);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return false;
  }

  [order[fromIndex], order[toIndex]] = [order[toIndex], order[fromIndex]];
  layout.summaryCards = order;

  const cardsGrid = document.getElementById("summary-cards-grid");
  if (cardsGrid) {
    applySummaryCardPlacements(cardsGrid, layout.summaryCards);
  }

  if (gridEditModeActive && gridEditLayoutDraft) {
    return true;
  }

  saveDashboardLayout(layout);
  applyDashboardPlacementsOnly(layout, dashboardWidgetPrefs ?? loadWidgetPreferences());
  refitContentSizedWidgetRowSpans();
  return true;
};

const hideSummaryCard = (cardId) => {
  setSummaryCardVisible(cardId, false);
  syncSummaryCardSettingsCheckboxes(document.getElementById("widget-settings-list"));
};

const setSummaryCardVisible = (cardId, visible) => {
  if (!SUMMARY_CARD_IDS.includes(cardId)) {
    return normalizeLayout(dashboardLayout);
  }

  const layout = normalizeLayout(dashboardLayout);
  const visibleSet = new Set(layout.summaryCards);
  if (visible) {
    visibleSet.add(cardId);
  } else {
    visibleSet.delete(cardId);
  }
  layout.summaryCards = SUMMARY_CARD_IDS.filter((id) => visibleSet.has(id));
  saveDashboardLayout(layout);

  const cardsGrid = document.getElementById("summary-cards-grid");
  if (cardsGrid) {
    applySummaryCardPlacements(cardsGrid, layout.summaryCards);
  }

  applyDashboardPlacementsOnly(layout, dashboardWidgetPrefs ?? loadWidgetPreferences());
  refitContentSizedWidgetRowSpans();
  return layout;
};

const isSummaryCardVisible = (layout, cardId) =>
  normalizeLayout(layout).summaryCards.includes(cardId);

const getDashboardGridMetrics = (dashboard) => {
  const el = dashboard ?? document.getElementById("dashboard");
  if (!el) {
    return { gap: 0, colWidth: 0, rowHeight: 0, panelInset: getWidgetPanelInsetPx() };
  }

  const rect = el.getBoundingClientRect();
  const gap = getDashboardGridGapPx(el);
  const panelInset = getWidgetPanelInsetPx();
  const colWidth = (rect.width - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  return {
    dashboard: el,
    gap,
    colWidth,
    rowHeight: colWidth,
    panelInset,
  };
};

const measureWidgetDashboardRowSpan = (widgetId, contentSelector, minRowSpan, fallbackRowSpan) => {
  const metrics = getDashboardGridMetrics();
  const widget = getWidgetElement(widgetId);
  if (!metrics.colWidth || !widget || widget.hasAttribute("hidden")) {
    return fallbackRowSpan;
  }

  const { colWidth, gap, panelInset, dashboard } = metrics;
  const dashboardWidth = dashboard?.clientWidth ?? 0;
  const widgetWidth = widget.getBoundingClientRect().width;
  if (dashboardWidth > 0 && widgetWidth < dashboardWidth * 0.85) {
    return fallbackRowSpan;
  }

  const content = widget.querySelector(contentSelector);
  const title = widget.querySelector(".widget-panel-title");
  const widgetStyles = getComputedStyle(widget);
  const paddingY =
    parseFloat(widgetStyles.paddingTop) + parseFloat(widgetStyles.paddingBottom);
  const borderY =
    parseFloat(widgetStyles.borderTopWidth) + parseFloat(widgetStyles.borderBottomWidth);
  const titleHeight = title
    ? title.offsetHeight + parseFloat(getComputedStyle(title).marginBottom)
    : 0;
  const bodyHeight = content ? content.offsetHeight : 0;
  if (bodyHeight <= 0) {
    return fallbackRowSpan;
  }

  const heightPx = paddingY + borderY + titleHeight + bodyHeight;
  return minSpanForRenderedPixels(heightPx, colWidth, gap, panelInset, minRowSpan);
};

const layoutPlacementsEqual = (left, right) =>
  left.col === right.col &&
  left.row === right.row &&
  left.colSpan === right.colSpan &&
  left.rowSpan === right.rowSpan;

const applyDashboardPlacements = (layout, prefs) => {
  for (const widget of WIDGET_DEFINITIONS) {
    const element = getWidgetElement(widget.id);
    const placement = layout.widgets[widget.id];
    if (!element || !placement) {
      continue;
    }
    if (!isLayoutWidgetVisible(widget.id, prefs)) {
      element.style.removeProperty("grid-column");
      element.style.removeProperty("grid-row");
      continue;
    }
    applyWidgetPlacement(element, placement);
  }
};

const cloneDashboardLayout = (layout) => {
  const normalized = normalizeLayout(layout);
  return {
    version: normalized.version,
    summaryCards: [...normalized.summaryCards],
    widgets: Object.fromEntries(
      WIDGET_DEFINITIONS.map((widget) => {
        const placement = normalized.widgets[widget.id];
        return [widget.id, placement ? clonePlacement(placement) : null];
      }).filter(([, placement]) => placement)
    ),
  };
};

let gridEditModeActive = false;
let gridEditLayoutSnapshot = null;
let gridEditLayoutDraft = null;
let gridEditResizeDrag = null;

const measureWidgetMinSpans = (widgetEl) => {
  const { colWidth, gap, panelInset } = getDashboardGridMetrics();
  if (!colWidth) {
    return { colSpan: 4, rowSpan: 3 };
  }

  const originalWidth = widgetEl.style.minWidth;
  const originalHeight = widgetEl.style.minHeight;
  widgetEl.style.minWidth = "0";
  widgetEl.style.minHeight = "0";

  const contentEl =
    widgetEl.querySelector(".widget-body") ||
    widgetEl.querySelector(".cards-grid, .controls, .line-chart-area, .uptime-chart-area, .speedtest-body, .speedtest-gauge-body") ||
    widgetEl;
  const header =
    widgetEl.querySelector(".widget-header") ||
    widgetEl.querySelector(".widget-panel-title, .chart-panel-title");
  const headerH = header ? header.getBoundingClientRect().height : 0;
  const contentScrollW = contentEl.scrollWidth;
  const contentScrollH = contentEl.scrollHeight + headerH;

  widgetEl.style.minWidth = originalWidth;
  widgetEl.style.minHeight = originalHeight;

  const minColSpan = minSpanForRenderedPixels(contentScrollW, colWidth, gap, panelInset, 4);
  const minRowSpan = minSpanForRenderedPixels(contentScrollH, colWidth, gap, panelInset, 3);

  return { colSpan: minColSpan, rowSpan: minRowSpan };
};

const applyDashboardPlacementsOnly = (layout, prefs) => {
  const normalized = normalizeLayout(layout);
  const visibilityPrefs = getLayoutVisibilityPrefs(
    prefs ?? dashboardWidgetPrefs ?? loadWidgetPreferences()
  );
  dashboardWidgetPrefs = visibilityPrefs;

  const cardsGrid = document.getElementById("summary-cards-grid");
  if (cardsGrid) {
    applySummaryCardPlacements(cardsGrid, normalized.summaryCards);
  }

  applyDashboardPlacements(normalized, visibilityPrefs);
  dashboardLayout = normalized;
  document.dispatchEvent(new CustomEvent("dashboard:layout-changed"));
  return normalized;
};

const stackMeasureAndApplyDashboardLayout = (layout, prefs) => {
  const normalized = normalizeLayout(layout);
  const visibilityPrefs = getLayoutVisibilityPrefs(prefs);
  dashboardWidgetPrefs = visibilityPrefs;

  const cardsGrid = document.getElementById("summary-cards-grid");
  if (cardsGrid) {
    applySummaryCardPlacements(cardsGrid, normalized.summaryCards);
  }

  // Pass 1: full-width grid slots so content-based row spans measure correctly.
  layoutDashboardStack(
    normalized,
    (_widgetId, _contentSelector, _minRowSpan, fallbackRowSpan) => fallbackRowSpan,
    visibilityPrefs
  );
  applyDashboardPlacements(normalized, visibilityPrefs);

  // Pass 2: measure content height and pack the stack with tight row spans.
  layoutDashboardStack(normalized, measureWidgetDashboardRowSpan, visibilityPrefs);
  applyDashboardPlacements(normalized, visibilityPrefs);

  dashboardLayout = normalized;
  document.dispatchEvent(new CustomEvent("dashboard:layout-changed"));
  return normalized;
};

const refitContentSizedWidgetRowSpans = () => {
  if (gridEditModeActive) {
    return dashboardLayout;
  }

  const previousLayout = normalizeLayout(dashboardLayout);
  const nextLayout = stackMeasureAndApplyDashboardLayout(
    dashboardLayout,
    dashboardWidgetPrefs ?? loadWidgetPreferences()
  );
  const layoutUnchanged = WIDGET_DEFINITIONS.every((widget) => {
    const before = previousLayout.widgets[widget.id];
    const after = nextLayout.widgets[widget.id];
    return !before || !after || layoutPlacementsEqual(before, after);
  });
  if (layoutUnchanged) {
    return nextLayout;
  }

  saveDashboardLayout(nextLayout);
  return nextLayout;
};

const applyDashboardLayout = (layout, prefs) => {
  if (gridEditModeActive) {
    return applyDashboardPlacementsOnly(layout, prefs);
  }
  return stackMeasureAndApplyDashboardLayout(layout, prefs);
};

const findOverlappingWidget = (layout, widgetId, placement, prefs) => {
  for (const widget of WIDGET_DEFINITIONS) {
    if (widget.id === widgetId) {
      continue;
    }
    if (!isLayoutWidgetVisible(widget.id, prefs)) {
      continue;
    }
    const other = layout.widgets[widget.id];
    if (other && placementsOverlap(placement, other)) {
      return widget.id;
    }
  }
  return null;
};

const tryMoveWidgetPlacement = (layout, widgetId, targetPlacement, prefs) => {
  const current = layout.widgets[widgetId];
  if (!current) {
    return false;
  }

  const nextPlacement = {
    col: Math.max(1, Math.min(GRID_COLUMNS - current.colSpan + 1, targetPlacement.col)),
    row: Math.max(1, targetPlacement.row),
    colSpan: current.colSpan,
    rowSpan: current.rowSpan,
  };

  if (findOverlappingWidget(layout, widgetId, nextPlacement, prefs)) {
    return false;
  }

  layout.widgets[widgetId] = nextPlacement;
  return true;
};

const trySetWidgetPlacement = (layout, widgetId, placement, prefs) => {
  if (findOverlappingWidget(layout, widgetId, placement, prefs)) {
    return false;
  }
  layout.widgets[widgetId] = clonePlacement(placement);
  return true;
};

const normalizeResizedPlacement = (start, direction, deltaCol, deltaRow, minSpans) => {
  let col = start.col;
  let row = start.row;
  let colSpan = start.colSpan;
  let rowSpan = start.rowSpan;

  if (direction.includes("e")) {
    colSpan = start.colSpan + deltaCol;
  }
  if (direction.includes("w")) {
    col = start.col + deltaCol;
    colSpan = start.colSpan - deltaCol;
  }
  if (direction.includes("s")) {
    rowSpan = start.rowSpan + deltaRow;
  }
  if (direction.includes("n")) {
    row = start.row + deltaRow;
    rowSpan = start.rowSpan - deltaRow;
  }

  colSpan = Math.max(minSpans.colSpan, colSpan);
  rowSpan = Math.max(minSpans.rowSpan, rowSpan);

  if (direction.includes("w")) {
    col = start.col + start.colSpan - colSpan;
  }
  if (direction.includes("n")) {
    row = start.row + start.rowSpan - rowSpan;
  }

  col = Math.max(1, Math.min(col, GRID_COLUMNS));
  row = Math.max(1, row);
  colSpan = Math.min(colSpan, GRID_COLUMNS - col + 1);

  return { col, row, colSpan, rowSpan };
};

const pointerToGridPlacement = (dashboard, clientX, clientY, colSpan, rowSpan) => {
  const rect = dashboard.getBoundingClientRect();
  const { gap, colWidth, rowHeight } = getDashboardGridMetrics(dashboard);
  const relX = Math.max(0, clientX - rect.left);
  const relY = Math.max(0, clientY - rect.top);
  const col = Math.min(
    GRID_COLUMNS - colSpan + 1,
    Math.max(1, Math.floor(relX / (colWidth + gap)) + 1)
  );
  const row = Math.max(1, Math.floor(relY / (rowHeight + gap)) + 1);
  return { col, row, colSpan, rowSpan };
};

const clearWidgetDropTargets = () => {
  document.querySelectorAll(".widget-grid-drop-target").forEach((el) => {
    el.classList.remove("widget-grid-drop-target");
  });
};

const createDragHandle = (className, label) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.innerHTML = GRIP_ICON;
  return button;
};

const DRAG_OPACITY = 0.5;

const positionDragGhost = (ghost, clientX, clientY, offsetX, offsetY) => {
  ghost.style.left = `${clientX - offsetX}px`;
  ghost.style.top = `${clientY - offsetY}px`;
};

const removeDragGhost = (ghost) => {
  if (ghost) {
    ghost.remove();
  }
};

const applyDragSourceOpacity = (element) => {
  element.style.opacity = String(DRAG_OPACITY);
};

const clearDragSourceOpacity = (element) => {
  element.style.opacity = "";
};

const applyDragGhostAppearance = (source, ghost) => {
  const computed = window.getComputedStyle(source);
  ghost.style.opacity = String(DRAG_OPACITY);
  ghost.style.backgroundColor = computed.backgroundColor;
  ghost.style.border = computed.border;
  ghost.style.borderRadius = computed.borderRadius;
  ghost.style.padding = computed.padding;
  ghost.style.color = computed.color;
  ghost.style.boxSizing = "border-box";
};

const createDragGhost = (element, ghostClassName, draggingClasses) => {
  const rect = element.getBoundingClientRect();
  const ghost = element.cloneNode(true);
  ghost.classList.add(ghostClassName);
  draggingClasses.forEach((className) => ghost.classList.remove(className));
  ghost.classList.remove("widget-selected");
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  applyDragGhostAppearance(element, ghost);
  document.body.appendChild(ghost);
  return ghost;
};

const createWidgetDragGhost = (widget, clientX, clientY, offsetX, offsetY) => {
  const ghost = createDragGhost(widget, "widget-grid-drag-ghost", [
    "widget-grid-dragging",
    "widget-grid-drop-target",
  ]);
  positionDragGhost(ghost, clientX, clientY, offsetX, offsetY);
  return ghost;
};

const createCardDragGhost = (card, clientX, clientY, offsetX, offsetY) => {
  const ghost = createDragGhost(card, "card-grid-drag-ghost", [
    "card-grid-dragging",
    "card-grid-drop-target",
  ]);
  positionDragGhost(ghost, clientX, clientY, offsetX, offsetY);
  return ghost;
};

const installWidgetDragHandles = () => {
  for (const widget of WIDGET_DEFINITIONS) {
    const element = getWidgetElement(widget.id);
    if (!element) {
      continue;
    }

    const title = element.querySelector(".widget-panel-title, .chart-panel-title");
    if (!title || title.querySelector(".widget-drag-handle")) {
      continue;
    }

    title.prepend(createDragHandle("widget-drag-handle", `Drag to rearrange ${widget.label}`));
  }
};

const initWidgetGridDrag = () => {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) {
    return;
  }

  let dragState = null;

  const finishDrag = () => {
    if (!dragState) {
      return;
    }

    dragState.handle.releasePointerCapture(dragState.pointerId);
    dragState.widget.classList.remove("widget-grid-dragging");
    clearDragSourceOpacity(dragState.widget);
    removeDragGhost(dragState.ghost);
    clearWidgetDropTargets();
    dragState = null;
  };

  dashboard.addEventListener("pointerdown", (event) => {
    if (!gridEditModeActive || gridEditResizeDrag) {
      return;
    }

    const handle = event.target.closest(".widget-drag-handle");
    const title = event.target.closest(".widget-panel-title, .chart-panel-title");
    if (!handle && !title) {
      return;
    }
    if (event.target.closest(".resize-handle, .widget-close, .widget-popout, .info-tip-wrap")) {
      return;
    }

    const widget = (handle ?? title).closest("section.widget[data-widget-id]");
    if (!widget) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const captureTarget = handle ?? title;
    const rect = widget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    dragState = {
      widgetId: widget.dataset.widgetId,
      widget,
      handle: captureTarget,
      pointerId: event.pointerId,
      offsetX,
      offsetY,
      ghost: createWidgetDragGhost(widget, event.clientX, event.clientY, offsetX, offsetY),
    };

    widget.classList.add("widget-grid-dragging");
    applyDragSourceOpacity(widget);
    captureTarget.setPointerCapture(event.pointerId);
  });

  dashboard.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    positionDragGhost(
      dragState.ghost,
      event.clientX,
      event.clientY,
      dragState.offsetX,
      dragState.offsetY
    );

    clearWidgetDropTargets();
  });

  dashboard.addEventListener("pointerup", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    if (gridEditLayoutDraft) {
      const prefs = dashboardWidgetPrefs ?? loadWidgetPreferences();
      const current = gridEditLayoutDraft.widgets[dragState.widgetId];
      if (current) {
        const targetPlacement = pointerToGridPlacement(
          dashboard,
          event.clientX,
          event.clientY,
          current.colSpan,
          current.rowSpan
        );
        if (tryMoveWidgetPlacement(gridEditLayoutDraft, dragState.widgetId, targetPlacement, prefs)) {
          applyGridEditDraftPlacements();
        }
      }
    }

    finishDrag();
  });

  dashboard.addEventListener("pointercancel", finishDrag);
};

const initSummaryCardGridDrag = () => {
  const grid = document.getElementById("summary-cards-grid");
  if (!grid) {
    return;
  }

  for (const card of grid.querySelectorAll(".card[data-summary-card-id]")) {
    if (card.querySelector(".card-drag-handle")) {
      continue;
    }
    card.prepend(createDragHandle("card-drag-handle", "Drag to rearrange summary card"));
  }

  for (const card of grid.querySelectorAll(".card[data-summary-card-id]")) {
    if (card.querySelector(".card-close")) {
      continue;
    }
    const cardId = card.dataset.summaryCardId;
    if (!cardId) {
      continue;
    }
    const button = createSummaryCardCloseButton(cardId);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideSummaryCard(cardId);
    });
    card.appendChild(button);
  }

  let dragState = null;

  const clearCardDropTargets = () => {
    grid.querySelectorAll(".card-grid-drop-target").forEach((el) => {
      el.classList.remove("card-grid-drop-target");
    });
  };

  const finishDrag = () => {
    if (!dragState) {
      return;
    }
    dragState.handle.releasePointerCapture(dragState.pointerId);
    dragState.card.classList.remove("card-grid-dragging");
    clearDragSourceOpacity(dragState.card);
    removeDragGhost(dragState.ghost);
    clearCardDropTargets();
    dragState = null;
  };

  grid.addEventListener("pointerdown", (event) => {
    if (!gridEditModeActive) {
      return;
    }

    if (event.target.closest(".card-close")) {
      return;
    }

    const handle = event.target.closest(".card-drag-handle");
    if (!handle) {
      return;
    }

    const card = handle.closest(".card[data-summary-card-id]");
    if (!card) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = card.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    dragState = {
      cardId: card.dataset.summaryCardId,
      card,
      handle,
      pointerId: event.pointerId,
      offsetX,
      offsetY,
      ghost: createCardDragGhost(card, event.clientX, event.clientY, offsetX, offsetY),
    };

    card.classList.add("card-grid-dragging");
    applyDragSourceOpacity(card);
    handle.setPointerCapture(event.pointerId);
  });

  grid.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    positionDragGhost(
      dragState.ghost,
      event.clientX,
      event.clientY,
      dragState.offsetX,
      dragState.offsetY
    );

    clearCardDropTargets();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(
      ".card[data-summary-card-id]"
    );
    if (target && target !== dragState.card) {
      target.classList.add("card-grid-drop-target");
    }
  });

  grid.addEventListener("pointerup", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(
      ".card[data-summary-card-id]"
    );

    if (target && target !== dragState.card) {
      swapSummaryCardsInOrder(dragState.cardId, target.dataset.summaryCardId);
    }

    finishDrag();
  });

  grid.addEventListener("pointercancel", finishDrag);
};

const initDashboardLayout = (prefs) => {
  installWidgetDragHandles();
  const fitted = applyDashboardLayout(dashboardLayout, prefs ?? dashboardWidgetPrefs);
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(fitted));
  } catch {
    // Ignore storage write failures.
  }
  initWidgetGridDrag();
  initSummaryCardGridDrag();

  let contentRowSpanFitTimer;
  window.addEventListener("resize", () => {
    clearTimeout(contentRowSpanFitTimer);
    contentRowSpanFitTimer = setTimeout(() => {
      refitContentSizedWidgetRowSpans();
    }, 150);
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      refitContentSizedWidgetRowSpans();
    });
  });
};

const applyWidgetVisibility = (prefs) => {
  const normalized = normalizePreferences(prefs);
  dashboardWidgetPrefs = normalized;

  for (const widget of WIDGET_DEFINITIONS) {
    const element = getWidgetElement(widget.id);
    if (!element) {
      continue;
    }

    element.toggleAttribute("hidden", !isWidgetVisible(normalized, widget.id));
  }

  const nextLayout = stackMeasureAndApplyDashboardLayout(dashboardLayout, normalized);
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout));
  } catch {
    // Ignore storage write failures.
  }

  document.dispatchEvent(
    new CustomEvent("dashboard:widgets-changed", {
      detail: { preferences: { ...normalized } },
    })
  );

  return normalized;
};

const setWidgetVisible = (widgetId, visible, prefs) => {
  const next = normalizePreferences({ ...prefs, [widgetId]: visible });
  saveWidgetPreferences(next);
  return applyWidgetVisibility(next);
};

const renderWidgetSettingsItem = (widget, prefs) => {
  const checked = isWidgetVisible(prefs, widget.id) ? "checked" : "";
  return (
    `<label class="widget-settings-item">` +
    `<input type="checkbox" data-widget-id="${widget.id}" ${checked}>` +
    `<span class="widget-settings-copy">` +
    `<strong>${widget.label}</strong>` +
    `<span>${widget.description}</span>` +
    `</span>` +
    `</label>`
  );
};

const syncWidgetSettingsCheckboxes = (container, prefs) => {
  if (!container) {
    return;
  }

  container.querySelectorAll('input[type="checkbox"][data-widget-id]').forEach((input) => {
    input.checked = isWidgetVisible(prefs, input.dataset.widgetId);
  });
};

const syncSummaryCardSettingsCheckboxes = (container) => {
  if (!container) {
    return;
  }

  const layout = normalizeLayout(dashboardLayout);
  container.querySelectorAll('input[type="checkbox"][data-summary-card-id]').forEach((input) => {
    input.checked = isSummaryCardVisible(layout, input.dataset.summaryCardId);
  });
};

const renderSummaryCardSettingsItems = (layout) =>
  SUMMARY_CARD_IDS.map((cardId) => {
    const checked = isSummaryCardVisible(layout, cardId) ? "checked" : "";
    const label = SUMMARY_CARD_LABELS[cardId] || cardId;
    return (
      `<label class="widget-settings-item widget-settings-item-nested">` +
      `<input type="checkbox" data-summary-card-id="${cardId}" ${checked}>` +
      `<span class="widget-settings-copy"><strong>${label}</strong></span>` +
      `</label>`
    );
  }).join("");

const renderWidgetSettingsList = (container, prefs, layout, onWidgetChange, onSummaryCardChange) => {
  container.innerHTML = WIDGET_GROUPS.map((group) => {
    const items = WIDGET_DEFINITIONS.filter((widget) => widget.group === group)
      .map((widget) => renderWidgetSettingsItem(widget, prefs))
      .join("");

    const summaryCardsSection =
      group === "Overview"
        ? `<fieldset class="widget-settings-subgroup">` +
          `<legend>Summary card panels</legend>` +
          renderSummaryCardSettingsItems(layout) +
          `</fieldset>`
        : "";

    return `<fieldset class="widget-settings-group"><legend>${group}</legend>${items}${summaryCardsSection}</fieldset>`;
  }).join("");

  container.querySelectorAll('input[type="checkbox"][data-widget-id]').forEach((input) => {
    input.addEventListener("change", () => {
      onWidgetChange(input.dataset.widgetId, input.checked);
    });
  });

  container.querySelectorAll('input[type="checkbox"][data-summary-card-id]').forEach((input) => {
    input.addEventListener("change", () => {
      onSummaryCardChange(input.dataset.summaryCardId, input.checked);
    });
  });
};

const createWidgetCloseButton = (widget) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "widget-close";
  button.dataset.widgetId = widget.id;
  button.setAttribute("aria-label", `Hide ${widget.label}`);
  button.title = `Hide ${widget.label}`;
  button.textContent = "×";
  return button;
};

const installWidgetCloseButtons = (onClose) => {
  for (const widget of WIDGET_DEFINITIONS) {
    const element = getWidgetElement(widget.id);
    if (!element || element.querySelector(".widget-close")) {
      continue;
    }

    const button = createWidgetCloseButton(widget);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onClose(widget.id);
    });
    element.appendChild(button);
  }
};

const GRID_EDIT_NORMAL_HEADER_IDS = [
  "log-download-wrap",
  "customize-dashboard-btn",
  "delete-data-btn",
  "settings-btn",
];

const getGridEditHeaderActions = () => document.getElementById("grid-edit-header-actions");

const setGridEditHeaderVisible = (active) => {
  const headerActions = document.querySelector(".header-actions");
  if (headerActions) {
    headerActions.classList.toggle("grid-edit-active", active);
  }

  for (const id of GRID_EDIT_NORMAL_HEADER_IDS) {
    const element = document.getElementById(id);
    if (element) {
      element.hidden = active;
    }
  }

  const editActions = getGridEditHeaderActions();
  if (editActions) {
    editActions.hidden = !active;
  }
};

const applyGridEditDraftPlacements = () => {
  if (!gridEditLayoutDraft) {
    return;
  }
  applyDashboardPlacementsOnly(gridEditLayoutDraft, dashboardWidgetPrefs ?? loadWidgetPreferences());
};

const removeGridEditResizeHandles = () => {
  document.querySelectorAll(".resize-handle").forEach((handle) => handle.remove());
};

const GRID_EDIT_RESIZE_DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const createGridEditResizeHandle = (direction) => {
  const handle = document.createElement("div");
  handle.className = `resize-handle resize-handle-${direction}`;
  handle.dataset.resizeDirection = direction;
  return handle;
};

const attachGridEditResizeHandles = () => {
  removeGridEditResizeHandles();
  const prefs = dashboardWidgetPrefs ?? loadWidgetPreferences();
  for (const widget of WIDGET_DEFINITIONS) {
    if (!isLayoutWidgetVisible(widget.id, prefs)) {
      continue;
    }
    const element = getWidgetElement(widget.id);
    if (!element || element.hasAttribute("hidden")) {
      continue;
    }
    for (const direction of GRID_EDIT_RESIZE_DIRECTIONS) {
      element.appendChild(createGridEditResizeHandle(direction));
    }
  }
};

const computeGridEditResizePlacement = (drag, clientX, clientY) => {
  const dashboard = document.getElementById("dashboard");
  const metrics = dashboard ? getDashboardGridMetrics(dashboard) : null;
  if (!metrics?.colWidth) {
    return null;
  }

  const deltaX = clientX - drag.startX;
  const deltaY = clientY - drag.startY;
  const deltaCol = Math.round(deltaX / (metrics.colWidth + metrics.gap));
  const deltaRow = Math.round(deltaY / (metrics.rowHeight + metrics.gap));

  return normalizeResizedPlacement(
    drag.startPlacement,
    drag.direction,
    deltaCol,
    deltaRow,
    drag.minSpans
  );
};

const previewGridEditResizePlacement = (widgetId, placement) => {
  const element = getWidgetElement(widgetId);
  if (!element || !placement) {
    return;
  }
  applyWidgetPlacement(element, placement);
};

const finishGridEditResizeDrag = (event) => {
  if (!gridEditResizeDrag || event.pointerId !== gridEditResizeDrag.pointerId) {
    return;
  }

  const { widgetId, handle, startPlacement, minSpans } = gridEditResizeDrag;
  const prefs = dashboardWidgetPrefs ?? loadWidgetPreferences();
  const candidate = computeGridEditResizePlacement(gridEditResizeDrag, event.clientX, event.clientY);

  if (candidate && gridEditLayoutDraft) {
    if (!trySetWidgetPlacement(gridEditLayoutDraft, widgetId, candidate, prefs)) {
      previewGridEditResizePlacement(widgetId, startPlacement);
    } else {
      applyGridEditDraftPlacements();
    }
  } else if (startPlacement) {
    previewGridEditResizePlacement(widgetId, startPlacement);
  }

  handle.releasePointerCapture(event.pointerId);
  handle.classList.remove("is-dragging");
  gridEditResizeDrag = null;
};

const handleGridEditResizeMove = (event) => {
  if (!gridEditResizeDrag || event.pointerId !== gridEditResizeDrag.pointerId) {
    return;
  }

  const { widgetId } = gridEditResizeDrag;
  const candidate = computeGridEditResizePlacement(gridEditResizeDrag, event.clientX, event.clientY);
  if (!candidate || !gridEditLayoutDraft) {
    return;
  }

  const prefs = dashboardWidgetPrefs ?? loadWidgetPreferences();
  if (findOverlappingWidget(gridEditLayoutDraft, widgetId, candidate, prefs)) {
    return;
  }

  previewGridEditResizePlacement(widgetId, candidate);
};

const handleGridEditResizeDown = (event) => {
  if (!gridEditModeActive || gridEditResizeDrag) {
    return;
  }

  const handle = event.target.closest(".resize-handle");
  if (!handle) {
    return;
  }

  const widget = handle.closest(".widget[data-widget-id]");
  if (!widget) {
    return;
  }

  const widgetId = widget.dataset.widgetId;
  const placement = gridEditLayoutDraft?.widgets[widgetId];
  if (!placement) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  gridEditResizeDrag = {
    widgetId,
    handle,
    pointerId: event.pointerId,
    direction: handle.dataset.resizeDirection,
    startX: event.clientX,
    startY: event.clientY,
    startPlacement: clonePlacement(placement),
    minSpans: measureWidgetMinSpans(widget),
  };

  handle.setPointerCapture(event.pointerId);
  handle.classList.add("is-dragging");
};

const exitGridEditMode = ({ restoreStackLayout = false } = {}) => {
  const dashboard = document.getElementById("dashboard");
  if (dashboard) {
    dashboard.classList.remove("grid-edit-mode");
  }

  removeGridEditResizeHandles();
  setGridEditHeaderVisible(false);
  gridEditModeActive = false;

  const prefs = dashboardWidgetPrefs ?? loadWidgetPreferences();
  const layoutToApply = restoreStackLayout
    ? gridEditLayoutSnapshot
    : dashboardLayout;

  gridEditLayoutSnapshot = null;
  gridEditLayoutDraft = null;
  gridEditResizeDrag = null;

  if (layoutToApply) {
    applyDashboardPlacementsOnly(layoutToApply, prefs);
  } else {
    document.dispatchEvent(new CustomEvent("dashboard:layout-changed"));
  }

  document.dispatchEvent(
    new CustomEvent("dashboard:grid-edit-mode", { detail: { active: false } })
  );
};

const enterGridEditMode = () => {
  if (gridEditModeActive) {
    return;
  }

  gridEditLayoutSnapshot = cloneDashboardLayout(WidgetDashboard.loadLayout());
  gridEditLayoutDraft = cloneDashboardLayout(gridEditLayoutSnapshot);

  gridEditModeActive = true;

  const dashboard = document.getElementById("dashboard");
  if (dashboard) {
    dashboard.classList.add("grid-edit-mode");
  }

  setGridEditHeaderVisible(true);
  applyGridEditDraftPlacements();
  attachGridEditResizeHandles();

  document.dispatchEvent(
    new CustomEvent("dashboard:grid-edit-mode", { detail: { active: true } })
  );
};

const applyGridEditChanges = () => {
  if (!gridEditModeActive || !gridEditLayoutDraft) {
    return;
  }

  WidgetDashboard.saveLayout(gridEditLayoutDraft);
  gridEditModeActive = false;
  exitGridEditMode({ restoreStackLayout: false });
};

const cancelGridEditChanges = () => {
  if (!gridEditModeActive) {
    return;
  }

  gridEditModeActive = false;
  exitGridEditMode({ restoreStackLayout: true });
};

const initGridEditMode = () => {
  const dashboard = document.getElementById("dashboard");
  if (dashboard) {
    dashboard.addEventListener("pointerdown", handleGridEditResizeDown);
    dashboard.addEventListener("pointermove", handleGridEditResizeMove);
    dashboard.addEventListener("pointerup", finishGridEditResizeDrag);
    dashboard.addEventListener("pointercancel", finishGridEditResizeDrag);
  }

  const applyBtn = document.getElementById("grid-edit-apply-btn");
  const cancelBtn = document.getElementById("grid-edit-cancel-btn");
  if (applyBtn) {
    applyBtn.addEventListener("click", applyGridEditChanges);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", cancelGridEditChanges);
  }

  setGridEditHeaderVisible(false);
};

const initWidgetDashboard = () => {
  initModalBehavior();
  let prefs = loadWidgetPreferences();

  // Migrate any legacy storage into the stable key without changing user choices.
  saveWidgetPreferences(prefs);
  prefs = applyWidgetVisibility(prefs);

  const dialog = document.getElementById("widget-settings");
  const openBtn = document.getElementById("customize-dashboard-btn");
  const list = document.getElementById("widget-settings-list");
  const resetBtn = document.getElementById("widget-reset-btn");
  const cancelBtn = document.getElementById("widget-cancel-btn");
  let dialogPrefsSnapshot = null;
  let dialogLayoutSnapshot = null;

  if (!dialog || !openBtn || !list) {
    installWidgetCloseButtons((widgetId) => {
      prefs = setWidgetVisible(widgetId, false, prefs);
    });
    initGridEditMode();
    initDashboardLayout(prefs);
    return prefs;
  }

  const syncSettingsUI = () => {
    renderWidgetSettingsList(
      list,
      prefs,
      dashboardLayout,
      (widgetId, visible) => {
        prefs = setWidgetVisible(widgetId, visible, prefs);
      },
      (cardId, visible) => {
        setSummaryCardVisible(cardId, visible);
      }
    );
  };

  installWidgetCloseButtons((widgetId) => {
    prefs = setWidgetVisible(widgetId, false, prefs);
    syncWidgetSettingsCheckboxes(list, prefs);
  });

  openBtn.addEventListener("click", () => {
    dialogPrefsSnapshot = { ...prefs };
    dialogLayoutSnapshot = {
      summaryCards: [...normalizeLayout(dashboardLayout).summaryCards],
    };
    syncSettingsUI();
    toggleModalDialog(dialog, true);
  });

  if (cancelBtn) {
    const cancelWidgetSettingsDialog = () => {
      if (dialogPrefsSnapshot) {
        prefs = { ...dialogPrefsSnapshot };
        saveWidgetPreferences(prefs);
        prefs = applyWidgetVisibility(prefs);
      }
      if (dialogLayoutSnapshot) {
        const layout = normalizeLayout(dashboardLayout);
        layout.summaryCards = [...dialogLayoutSnapshot.summaryCards];
        saveDashboardLayout(layout);
        applyDashboardLayout(layout);
        refitContentSizedWidgetRowSpans();
      }
      toggleModalDialog(dialog, false);
    };

    cancelBtn.addEventListener("click", cancelWidgetSettingsDialog);
    registerModalDismiss(dialog, cancelWidgetSettingsDialog);
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      prefs = getDefaultPreferences();
      saveWidgetPreferences(prefs);
      prefs = applyWidgetVisibility(prefs);
      resetDashboardLayout();
      syncSettingsUI();
    });
  }

  dialog.addEventListener("close", syncSettingsUI);

  const gridEditBtn = document.getElementById("widget-grid-edit-btn");
  if (gridEditBtn) {
    gridEditBtn.addEventListener("click", () => {
      if (dialogPrefsSnapshot) {
        prefs = { ...dialogPrefsSnapshot };
        saveWidgetPreferences(prefs);
        prefs = applyWidgetVisibility(prefs);
      }
      syncSettingsUI();
      toggleModalDialog(dialog, false);
      enterGridEditMode();
    });
  }

  initGridEditMode();

  initDashboardLayout(prefs);

  return prefs;
};

window.WidgetDashboard = {
  definitions: WIDGET_DEFINITIONS,
  loadPreferences: loadWidgetPreferences,
  savePreferences: saveWidgetPreferences,
  applyVisibility: applyWidgetVisibility,
  init: initWidgetDashboard,
  loadLayout: loadDashboardLayout,
  saveLayout: saveDashboardLayout,
  applyLayout: applyDashboardLayout,
  refitContentSizedWidgets: refitContentSizedWidgetRowSpans,
  resetLayout: resetDashboardLayout,
  registerDismiss: registerModalDismiss,
};
