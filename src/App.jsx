import { useEffect, useMemo, useState } from "react";

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STORAGE_KEY = "flowstate-alpha-calendar-clean";

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function formatMonthYear(year, month) {
  return new Date(year, month).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
}

function formatMoney(value, decimals = 0) {
  const number = Number(value || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}$${number.toFixed(decimals)}`;
}

function getMoneyColor(value) {
  if (value > 0) return "#22c55e";
  if (value < 0) return "#ef4444";
  return "#a1a1aa";
}

function normalizeEntry(entry = {}) {
  return {
    pl: entry.pl ?? "",
    trades: entry.trades ?? "",
    notes: entry.notes ?? "",
    account: entry.account ?? "Main",
    strategy: entry.strategy ?? "Scalp",
  };
}

function downloadCSV(filename, rows) {
  const escapeCell = (value) => {
    const str = String(value ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const today = new Date();

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [allData, setAllData] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [status, setStatus] = useState("Ready");
  const [activeAccount, setActiveAccount] = useState("All Accounts");
  const [activeStrategy, setActiveStrategy] = useState("All Strategies");
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 900 : false
  );

  const currentKey = monthKey(viewYear, viewMonth);
  const monthLabel = formatMonthYear(viewYear, viewMonth);
  const currentMonthData = allData[currentKey] || {};

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setAllData(parsed);
        setStatus("Loaded automatically");
      }
    } catch (error) {
      console.log("LOAD ERROR:", error);
      setStatus("Load failed");
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    } catch (error) {
      console.log("SAVE ERROR:", error);
      setStatus("Save failed");
    }
  }, [allData]);

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key === "Escape") setSelectedDay(null);
    };

    const onResize = () => {
      setIsMobile(window.innerWidth < 900);
    };

    window.addEventListener("keydown", onEscape);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const updateEntry = (day, field, value) => {
    setAllData((prev) => ({
      ...prev,
      [currentKey]: {
        ...(prev[currentKey] || {}),
        [day]: {
          ...normalizeEntry((prev[currentKey] || {})[day]),
          [field]: value,
        },
      },
    }));
    setStatus("Saved");
  };

  const clearMonth = () => {
    setAllData((prev) => ({
      ...prev,
      [currentKey]: {},
    }));
    setSelectedDay(null);
    setStatus("Month cleared");
  };

  const goMonth = (direction) => {
    const next = new Date(viewYear, viewMonth + direction, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setSelectedDay(null);
  };

  const selectedEntry = selectedDay
    ? normalizeEntry(currentMonthData[selectedDay])
    : normalizeEntry();

  const accounts = useMemo(() => {
    const set = new Set(["All Accounts"]);
    Object.values(currentMonthData).forEach((entry) => {
      set.add(normalizeEntry(entry).account);
    });
    return Array.from(set);
  }, [currentMonthData]);

  const strategies = useMemo(() => {
    const set = new Set(["All Strategies"]);
    Object.values(currentMonthData).forEach((entry) => {
      set.add(normalizeEntry(entry).strategy);
    });
    return Array.from(set);
  }, [currentMonthData]);

  const entryMatchesFilters = (entry) => {
    const normalized = normalizeEntry(entry);
    const accountMatch =
      activeAccount === "All Accounts" || normalized.account === activeAccount;
    const strategyMatch =
      activeStrategy === "All Strategies" ||
      normalized.strategy === activeStrategy;
    return accountMatch && strategyMatch;
  };

  const getPL = (day) => {
    const entry = currentMonthData[day];
    if (!entry || !entryMatchesFilters(entry)) return 0;
    return Number(entry.pl || 0);
  };

  const getTrades = (day) => {
    const entry = currentMonthData[day];
    if (!entry || !entryMatchesFilters(entry)) return 0;
    return Number(entry.trades || 0);
  };

  const filteredEntries = Object.entries(currentMonthData)
    .map(([day, values]) => {
      const normalized = normalizeEntry(values);
      return {
        day: Number(day),
        pl: Number(normalized.pl || 0),
        trades: Number(normalized.trades || 0),
        notes: normalized.notes,
        account: normalized.account,
        strategy: normalized.strategy,
      };
    })
    .filter((entry) => entry.day >= 1 && entry.day <= daysInMonth)
    .filter((entry) => entryMatchesFilters(entry))
    .sort((a, b) => a.day - b.day);

  const total = filteredEntries.reduce((sum, entry) => sum + entry.pl, 0);
  const activeDays = filteredEntries.filter(
    (entry) => entry.pl !== 0 || entry.trades > 0 || entry.notes.trim() !== ""
  );
  const winningDays = filteredEntries.filter((entry) => entry.pl > 0).length;
  const losingDays = filteredEntries.filter((entry) => entry.pl < 0).length;
  const totalTrades = filteredEntries.reduce(
    (sum, entry) => sum + entry.trades,
    0
  );
  const averageTradePL = totalTrades > 0 ? total / totalTrades : 0;
  const winRate =
    activeDays.length > 0 ? (winningDays / activeDays.length) * 100 : 0;

  const bestDay =
    filteredEntries.length > 0
      ? filteredEntries.reduce((best, current) =>
          current.pl > best.pl ? current : best
        )
      : null;

  const worstDay =
    filteredEntries.length > 0
      ? filteredEntries.reduce((worst, current) =>
          current.pl < worst.pl ? current : worst
        )
      : null;

  const equityData = useMemo(() => {
    let running = 0;
    const points = [];

    for (let day = 1; day <= daysInMonth; day++) {
      running += getPL(day);
      points.push({ day, value: running });
    }

    return points;
  }, [currentMonthData, activeAccount, activeStrategy, daysInMonth]);

  const weeks = useMemo(() => {
    const rows = [];
    let week = Array(firstDayOfMonth).fill(null);

    for (let day = 1; day <= daysInMonth; day++) {
      week.push(day);
      if (week.length === 7) {
        rows.push(week);
        week = [];
      }
    }

    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      rows.push(week);
    }

    return rows;
  }, [firstDayOfMonth, daysInMonth]);

  const getWeekTotal = (week) => {
    return week.reduce((sum, day) => {
      if (!day) return sum;
      return sum + getPL(day);
    }, 0);
  };

  const exportMonthCSV = () => {
    const rows = [
      ["Day", "P&L", "Trades", "Account", "Strategy", "Notes"],
      ...Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const entry = normalizeEntry(currentMonthData[day]);
        return [
          day,
          entry.pl,
          entry.trades,
          entry.account,
          entry.strategy,
          entry.notes,
        ];
      }),
    ];

    downloadCSV(`flowstate-alpha-${currentKey}.csv`, rows);
    setStatus("CSV exported");
  };

  const shareSummary = async () => {
    const summary = `${monthLabel}
Monthly Total: ${formatMoney(total)}
Win Rate: ${winRate.toFixed(1)}%
Winning Days: ${winningDays}
Losing Days: ${losingDays}
Total Trades: ${totalTrades}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: `FlowState Alpha - ${monthLabel}`,
          text: summary,
        });
        setStatus("Shared");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(summary);
        setStatus("Summary copied");
      } else {
        setStatus("Share not supported");
      }
    } catch (error) {
      console.log("SHARE ERROR:", error);
      setStatus("Share cancelled");
    }
  };

  const renderEquityCurve = () => {
    const width = 1200;
    const height = 260;
    const pad = 24;

    const minValue = Math.min(...equityData.map((p) => p.value), 0);
    const maxValue = Math.max(...equityData.map((p) => p.value), 0);
    const range = maxValue - minValue || 1;

    const xFor = (index) => {
      if (equityData.length <= 1) return width / 2;
      return pad + (index / (equityData.length - 1)) * (width - pad * 2);
    };

    const yFor = (value) => {
      return pad + ((maxValue - value) / range) * (height - pad * 2);
    };

    const linePath = equityData
      .map((point, index) => {
        const x = xFor(index);
        const y = yFor(point.value);
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

    const areaPath = `${linePath} L ${xFor(
      equityData.length - 1
    )} ${height - pad} L ${xFor(0)} ${height - pad} Z`;

    const zeroY = yFor(0);
    const finalValue = equityData[equityData.length - 1]?.value || 0;

    return (
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={smallLabelStyle}>Equity Curve</div>
            <div
              style={{
                fontSize: isMobile ? 22 : 28,
                fontWeight: 800,
                color: "#fff",
              }}
            >
              Running P&amp;L
            </div>
          </div>
          <div
            style={{
              fontSize: isMobile ? 20 : 24,
              fontWeight: 800,
              color: getMoneyColor(finalValue),
            }}
          >
            {formatMoney(finalValue)}
          </div>
        </div>

        <div style={{ width: "100%", overflowX: "auto" }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: "100%", height: 260, display: "block" }}
          >
            <defs>
              <linearGradient id="curveFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(34,197,94,0.28)" />
                <stop offset="100%" stopColor="rgba(34,197,94,0.02)" />
              </linearGradient>
            </defs>

            {[0, 0.25, 0.5, 0.75, 1].map((step) => {
              const y = pad + step * (height - pad * 2);
              return (
                <line
                  key={step}
                  x1={pad}
                  y1={y}
                  x2={width - pad}
                  y2={y}
                  stroke="#1f2937"
                  strokeWidth="1"
                  strokeDasharray="4 6"
                />
              );
            })}

            <line
              x1={pad}
              y1={zeroY}
              x2={width - pad}
              y2={zeroY}
              stroke="#374151"
              strokeWidth="1.2"
            />

            <path d={areaPath} fill="url(#curveFill)" />
            <path
              d={linePath}
              fill="none"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {equityData.map((point, index) => {
              const x = xFor(index);
              const y = yFor(point.value);
              const showLabel =
                point.day === 1 ||
                point.day === daysInMonth ||
                point.day % 5 === 0;

              return (
                <g key={point.day}>
                  <circle cx={x} cy={y} r="3.5" fill="#22c55e" />
                  {showLabel && (
                    <text
                      x={x}
                      y={height - 8}
                      textAnchor="middle"
                      fill="#9ca3af"
                      fontSize="12"
                    >
                      {point.day}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  const renderDayCard = (day) => {
    if (!day) {
      return (
        <div
          style={{
            minHeight: isMobile ? 92 : 125,
            borderRadius: 22,
            background: "transparent",
          }}
        />
      );
    }

    const rawEntry = currentMonthData[day];
    const entry = normalizeEntry(rawEntry);
    const pl = getPL(day);
    const trades = getTrades(day);
    const hasData = Boolean(entry.pl || entry.trades || entry.notes);
    const selected = selectedDay === day;

    return (
      <div
        onClick={() => setSelectedDay(day)}
        style={{
          minHeight: isMobile ? 92 : 125,
          padding: isMobile ? 10 : 14,
          border: selected ? "1px solid #22c55e" : "1px solid #27272a",
          borderRadius: 22,
          cursor: "pointer",
          background: selected
            ? "linear-gradient(180deg, rgba(34,197,94,0.12), rgba(15,15,15,1))"
            : "linear-gradient(180deg, rgba(24,24,27,1), rgba(10,10,10,1))",
          boxShadow: selected
            ? "0 0 24px rgba(34,197,94,0.18)"
            : "0 10px 30px rgba(0,0,0,0.30)",
          transition: "all 0.2s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: isMobile ? 28 : 34,
              height: isMobile ? 28 : 34,
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#18181b",
              color: "#fff",
              fontWeight: 700,
              fontSize: isMobile ? 12 : 14,
              border: "1px solid #27272a",
            }}
          >
            {day}
          </div>

          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: hasData ? "#22c55e" : "#3f3f46",
              boxShadow: hasData ? "0 0 12px rgba(34,197,94,0.9)" : "none",
            }}
          />
        </div>

        <div
          style={{
            color: getMoneyColor(pl),
            fontWeight: 700,
            fontSize: isMobile ? 18 : 22,
            lineHeight: 1.1,
            marginBottom: 6,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {pl !== 0 ? formatMoney(pl) : "—"}
        </div>

        {!isMobile && (
          <div style={{ fontSize: 13, color: hasData ? "#d4d4d8" : "#71717a" }}>
            {hasData ? `${trades} trade${trades === 1 ? "" : "s"}` : "No entry"}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(34,197,94,0.10), transparent 22%), #020202",
        color: "#fff",
        fontFamily: "Inter, Arial, Helvetica, sans-serif",
        padding: isMobile ? 14 : 24,
      }}
    >
      <div style={{ maxWidth: 1380, margin: "0 auto" }}>
        <div
          style={{
            textAlign: "center",
            marginBottom: 22,
            padding: isMobile ? "24px 14px 16px" : "30px 20px 18px",
            borderRadius: 28,
            border: "1px solid #18181b",
            background:
              "linear-gradient(180deg, rgba(12,12,12,0.95), rgba(5,5,5,0.98))",
            boxShadow: "0 25px 60px rgba(0,0,0,0.45)",
          }}
        >
          <div style={topKickerStyle}>Performance Calendar</div>

          <h1
            style={{
              margin: 0,
              fontSize: isMobile ? 36 : 56,
              color: "#fff",
              fontWeight: 800,
              letterSpacing: -1,
              textShadow: "0 0 20px rgba(255,255,255,0.06)",
            }}
          >
            FlowState Alpha
          </h1>

          <div
            style={{
              marginTop: 10,
              fontSize: isMobile ? 20 : 24,
              color: "#d4d4d8",
              fontWeight: 500,
            }}
          >
            {monthLabel}
          </div>

          <div
            style={{
              marginTop: 14,
              fontSize: 15,
              color: (() => {
                if (status.toLowerCase().includes("saved")) return "#22c55e";
                if (status.toLowerCase().includes("failed")) return "#ef4444";
                if (status.toLowerCase().includes("loaded")) return "#38bdf8";
                if (status.toLowerCase().includes("cleared")) return "#f59e0b";
                return "#a1a1aa";
              })(),
            }}
          >
            Status: {status}
          </div>

          <div
            style={{
              marginTop: 18,
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 22px",
              borderRadius: 18,
              border: "1px solid #1f2937",
              background:
                "linear-gradient(180deg, rgba(9,9,11,1), rgba(3,3,3,1))",
              boxShadow:
                total > 0
                  ? "0 0 25px rgba(34,197,94,0.12)"
                  : total < 0
                  ? "0 0 25px rgba(239,68,68,0.10)"
                  : "0 10px 30px rgba(0,0,0,0.35)",
              maxWidth: "100%",
            }}
          >
            <span style={{ color: "#a1a1aa", fontSize: isMobile ? 14 : 16 }}>
              Monthly Total
            </span>
            <span
              style={{
                color: getMoneyColor(total),
                fontSize: isMobile ? 28 : 34,
                fontWeight: 800,
                letterSpacing: -1,
                whiteSpace: "nowrap",
              }}
            >
              {formatMoney(total)}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            marginBottom: 22,
            flexWrap: "wrap",
          }}
        >
          <button onClick={() => goMonth(-1)} style={buttonStyle}>
            ← Prev
          </button>
          <button onClick={() => goMonth(1)} style={buttonStyle}>
            Next →
          </button>

          <select
            value={activeAccount}
            onChange={(e) => setActiveAccount(e.target.value)}
            style={selectStyle}
          >
            {accounts.map((account) => (
              <option key={account} value={account}>
                {account}
              </option>
            ))}
          </select>

          <select
            value={activeStrategy}
            onChange={(e) => setActiveStrategy(e.target.value)}
            style={selectStyle}
          >
            {strategies.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>

          <button onClick={shareSummary} style={buttonStyle}>
            Share
          </button>
          <button onClick={exportMonthCSV} style={buttonStyle}>
            Export CSV
          </button>
          <button onClick={clearMonth} style={buttonStyle}>
            Clear Month
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(7, 1fr)",
            gap: 14,
            marginBottom: 28,
          }}
        >
          <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} />
          <StatCard
            label="Winning Days"
            value={String(winningDays)}
            color="#22c55e"
          />
          <StatCard
            label="Losing Days"
            value={String(losingDays)}
            color="#ef4444"
          />
          <StatCard label="Total Trades" value={String(totalTrades)} />
          <StatCard
            label="Avg P&L / Trade"
            value={formatMoney(averageTradePL, 2)}
            color={getMoneyColor(averageTradePL)}
          />
          <StatCard
            label="Best Day"
            value={bestDay ? formatMoney(bestDay.pl) : "$0"}
            subtitle={bestDay ? `Day ${bestDay.day}` : "No data"}
            color="#22c55e"
          />
          <StatCard
            label="Worst Day"
            value={worstDay ? formatMoney(worstDay.pl) : "$0"}
            subtitle={worstDay ? `Day ${worstDay.day}` : "No data"}
            color="#ef4444"
          />
        </div>

        {renderEquityCurve()}

        {!isMobile && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              {dayNames.map((day) => (
                <div key={day} style={weekdayHeaderStyle}>
                  {day}
                </div>
              ))}
              <div style={weekdayHeaderStyle}>Week</div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {weeks.map((week, weekIndex) => {
                const weekTotal = getWeekTotal(week);

                return (
                  <div
                    key={weekIndex}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
                      gap: 12,
                    }}
                  >
                    {week.map((day, index) => (
                      <div key={`${weekIndex}-${index}`}>{renderDayCard(day)}</div>
                    ))}

                    <div
                      style={{
                        ...cardStyle,
                        minHeight: 125,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 14,
                        overflow: "hidden",
                      }}
                    >
                      <div style={smallLabelStyle}>Week Total</div>
                      <div
                        style={{
                          color: getMoneyColor(weekTotal),
                          fontSize: 24,
                          fontWeight: 800,
                          letterSpacing: -0.5,
                          textAlign: "center",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          width: "100%",
                        }}
                        title={formatMoney(weekTotal)}
                      >
                        {formatMoney(weekTotal)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
              <div key={day}>{renderDayCard(day)}</div>
            ))}
          </div>
        )}
      </div>

      {selectedDay && (
        <div
          onClick={() => setSelectedDay(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 560,
              border: "1px solid #27272a",
              borderRadius: 28,
              background:
                "linear-gradient(180deg, rgba(16,16,16,0.98), rgba(6,6,6,0.98))",
              boxShadow:
                "0 30px 80px rgba(0,0,0,0.55), 0 0 30px rgba(34,197,94,0.08)",
              padding: 28,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div>
                <div style={smallLabelStyle}>Edit Trading Day</div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 32,
                    letterSpacing: -0.5,
                  }}
                >
                  Day {selectedDay}
                </h2>
              </div>

              <button
                onClick={() => setSelectedDay(null)}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  border: "1px solid #27272a",
                  background: "#0a0a0a",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "grid", gap: 18 }}>
              <Field label="P&L">
                <input
                  placeholder="Enter P&L"
                  value={selectedEntry.pl}
                  onChange={(e) => updateEntry(selectedDay, "pl", e.target.value)}
                  style={inputStyle}
                />
              </Field>

              <Field label="Trades">
                <input
                  placeholder="Number of trades"
                  value={selectedEntry.trades}
                  onChange={(e) =>
                    updateEntry(selectedDay, "trades", e.target.value)
                  }
                  style={inputStyle}
                />
              </Field>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: 12,
                }}
              >
                <Field label="Account">
                  <select
                    value={selectedEntry.account}
                    onChange={(e) =>
                      updateEntry(selectedDay, "account", e.target.value)
                    }
                    style={inputStyle}
                  >
                    {["Main", "Challenge", "Swing", "IRA"].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Strategy">
                  <select
                    value={selectedEntry.strategy}
                    onChange={(e) =>
                      updateEntry(selectedDay, "strategy", e.target.value)
                    }
                    style={inputStyle}
                  >
                    {["Scalp", "Momentum", "Breakout", "Reversal", "Swing"].map(
                      (option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      )
                    )}
                  </select>
                </Field>
              </div>

              <Field label="Notes">
                <textarea
                  placeholder="Trade notes"
                  value={selectedEntry.notes}
                  onChange={(e) =>
                    updateEntry(selectedDay, "notes", e.target.value)
                  }
                  style={{ ...inputStyle, minHeight: 160, resize: "vertical" }}
                />
              </Field>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 22,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ color: "#71717a", fontSize: 14 }}>
                Auto-saves while you type
              </div>
              <button onClick={() => setSelectedDay(null)} style={buttonStyle}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, subtitle, color = "#ffffff" }) {
  return (
    <div style={statCardStyleShared}>
      <div style={smallLabelStyle}>{label}</div>
      <div
        style={{
          color,
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: -0.3,
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
      {subtitle ? (
        <div style={{ color: "#a1a1aa", fontSize: 12, marginTop: 6 }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div
        style={{
          marginBottom: 8,
          color: "#d4d4d8",
          fontWeight: 600,
          fontSize: 15,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const cardStyle = {
  border: "1px solid #27272a",
  borderRadius: 24,
  background: "linear-gradient(180deg, rgba(24,24,27,1), rgba(10,10,10,1))",
  boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
};

const statCardStyleShared = {
  border: "1px solid #27272a",
  borderRadius: 18,
  background: "linear-gradient(180deg, rgba(24,24,27,1), rgba(10,10,10,1))",
  boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
  padding: 14,
  minHeight: 100,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  overflow: "hidden",
};

const smallLabelStyle = {
  color: "#71717a",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 1.4,
  marginBottom: 8,
};

const topKickerStyle = {
  fontSize: 13,
  color: "#71717a",
  letterSpacing: 3,
  textTransform: "uppercase",
  marginBottom: 10,
};

const weekdayHeaderStyle = {
  textAlign: "center",
  fontWeight: 700,
  fontSize: 13,
  color: "#a1a1aa",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  paddingBottom: 6,
};

const buttonStyle = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid #27272a",
  background: "linear-gradient(180deg, #18181b, #09090b)",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
};

const selectStyle = {
  ...buttonStyle,
  padding: "10px 12px",
  appearance: "none",
};