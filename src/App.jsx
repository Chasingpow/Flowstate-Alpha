import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function formatMonthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : "";
  return `${sign}$${amount.toFixed(0)}`;
}

function normalizeEntry(entry) {
  return {
    pl: entry?.pl ?? "",
    trades: entry?.trades ?? "",
    notes: entry?.notes ?? "",
  };
}

function getStatusColor(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("saved")) return "#22c55e";
  if (value.includes("loaded")) return "#38bdf8";
  if (value.includes("cleared")) return "#f59e0b";
  if (value.includes("failed") || value.includes("error")) return "#ef4444";
  return "#a1a1aa";
}

function getEntryDateString(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function App() {
  const now = new Date();

  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin");

  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [allData, setAllData] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [status, setStatus] = useState("Ready");
  const [hasLoadedCloudMonth, setHasLoadedCloudMonth] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 900 : false
  );

  const monthKey = getMonthKey(viewYear, viewMonth);
  const monthLabel = formatMonthLabel(viewYear, viewMonth);
  const monthData = allData[monthKey] || {};

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 900);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setSelectedDay(null);
      }
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setAllData({});
      setSelectedDay(null);
      setHasLoadedCloudMonth(false);
      return;
    }

    async function loadMonthFromSupabase() {
      setHasLoadedCloudMonth(false);
      setStatus("Loading from cloud...");

      const startDate = getEntryDateString(viewYear, viewMonth, 1);
      const endDate = getEntryDateString(viewYear, viewMonth, daysInMonth);

      const { data, error } = await supabase
        .from("journal_entries")
        .select("entry_date, pl, trades, notes")
        .gte("entry_date", startDate)
        .lte("entry_date", endDate)
        .order("entry_date", { ascending: true });

      if (error) {
        console.error("Cloud load failed:", error);
        setStatus("Cloud load failed");
        setHasLoadedCloudMonth(true);
        return;
      }

      const mappedMonth = {};

      for (const row of data || []) {
        const day = Number(String(row.entry_date).slice(8, 10));
        mappedMonth[day] = {
          pl: row.pl == null ? "" : String(row.pl),
          trades: row.trades == null ? "" : String(row.trades),
          notes: row.notes ?? "",
        };
      }

      setAllData((prev) => ({
        ...prev,
        [monthKey]: mappedMonth,
      }));

      setStatus("Loaded from cloud");
      setHasLoadedCloudMonth(true);
    }

    loadMonthFromSupabase();
  }, [session, viewYear, viewMonth, daysInMonth, monthKey]);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setStatus(mode === "signin" ? "Signing in..." : "Creating account...");

    if (!email || !password) {
      setStatus("Email and password are required");
      return;
    }

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        setStatus("Signed in");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;
        setStatus("Account created. Check your email if confirmation is required.");
      }
    } catch (error) {
      setStatus(error.message || "Authentication failed");
    }
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setStatus(error.message || "Sign out failed");
      return;
    }

    setSelectedDay(null);
    setStatus("Signed out");
  }

  function changeMonth(direction) {
    const nextDate = new Date(viewYear, viewMonth + direction, 1);
    setViewYear(nextDate.getFullYear());
    setViewMonth(nextDate.getMonth());
    setSelectedDay(null);
  }

  async function saveDayToCloud(day, nextEntry) {
    if (!session?.user?.id) return;

    const entryDate = getEntryDateString(viewYear, viewMonth, day);
    const hasAnyData =
      nextEntry.pl !== "" || nextEntry.trades !== "" || nextEntry.notes.trim() !== "";

    if (!hasAnyData) {
      const { error } = await supabase
        .from("journal_entries")
        .delete()
        .eq("user_id", session.user.id)
        .eq("entry_date", entryDate);

      if (error) {
        console.error("Delete failed:", error);
        setStatus("Cloud delete failed");
        return;
      }

      setStatus("Saved to cloud");
      return;
    }

    const payload = {
      user_id: session.user.id,
      entry_date: entryDate,
      pl: nextEntry.pl === "" ? 0 : Number(nextEntry.pl),
      trades: nextEntry.trades === "" ? 0 : Number(nextEntry.trades),
      notes: nextEntry.notes,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("journal_entries")
      .upsert(payload, { onConflict: "user_id,entry_date" });

    if (error) {
      console.error("Cloud save failed:", error);
      setStatus("Cloud save failed");
      return;
    }

    setStatus("Saved to cloud");
  }

  function updateDayField(day, field, value) {
    const currentMonth = allData[monthKey] || {};
    const currentDay = normalizeEntry(currentMonth[day]);
    const nextEntry = {
      ...currentDay,
      [field]: value,
    };

    setAllData((prev) => ({
      ...prev,
      [monthKey]: {
        ...(prev[monthKey] || {}),
        [day]: nextEntry,
      },
    }));

    if (hasLoadedCloudMonth) {
      saveDayToCloud(day, nextEntry);
    }
  }

  async function clearSelectedDay() {
    if (!selectedDay) return;

    const nextEntry = {
      pl: "",
      trades: "",
      notes: "",
    };

    setAllData((prev) => ({
      ...prev,
      [monthKey]: {
        ...(prev[monthKey] || {}),
        [selectedDay]: nextEntry,
      },
    }));

    await saveDayToCloud(selectedDay, nextEntry);
    setStatus(`Cleared day ${selectedDay}`);
  }

  async function clearMonth() {
    const confirmed = window.confirm(`Clear all entries for ${monthLabel}?`);
    if (!confirmed) return;

    const startDate = getEntryDateString(viewYear, viewMonth, 1);
    const endDate = getEntryDateString(viewYear, viewMonth, daysInMonth);

    const { error } = await supabase
      .from("journal_entries")
      .delete()
      .gte("entry_date", startDate)
      .lte("entry_date", endDate);

    if (error) {
      console.error("Clear month failed:", error);
      setStatus("Clear month failed");
      return;
    }

    setAllData((prev) => ({
      ...prev,
      [monthKey]: {},
    }));

    setSelectedDay(null);
    setStatus("Month cleared");
  }

  const selectedEntry = selectedDay
    ? normalizeEntry(monthData[selectedDay])
    : normalizeEntry();

  const entries = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const entry = normalizeEntry(monthData[day]);

      return {
        day,
        pl: Number(entry.pl || 0),
        trades: Number(entry.trades || 0),
        notes: entry.notes || "",
      };
    });
  }, [daysInMonth, monthData]);

  const activeDays = entries.filter((item) => {
    return item.pl !== 0 || item.trades !== 0 || item.notes.trim() !== "";
  });

  const monthlyTotal = entries.reduce((sum, item) => sum + item.pl, 0);
  const totalTrades = entries.reduce((sum, item) => sum + item.trades, 0);
  const winningDays = entries.filter((item) => item.pl > 0).length;
  const losingDays = entries.filter((item) => item.pl < 0).length;
  const flatDays = Math.max(activeDays.length - winningDays - losingDays, 0);
  const winRate = activeDays.length > 0 ? (winningDays / activeDays.length) * 100 : 0;
  const avgDay = activeDays.length > 0 ? monthlyTotal / activeDays.length : 0;
  const avgTrade = totalTrades > 0 ? monthlyTotal / totalTrades : 0;

  const bestDay = entries.reduce(
    (best, current) => (current.pl > best.pl ? current : best),
    entries[0] || { day: "-", pl: 0 }
  );

  const worstDay = entries.reduce(
    (worst, current) => (current.pl < worst.pl ? current : worst),
    entries[0] || { day: "-", pl: 0 }
  );

  const equityData = useMemo(() => {
    let running = 0;
    return entries.map((item) => {
      running += item.pl;
      return {
        day: item.day,
        value: running,
      };
    });
  }, [entries]);

  const weeks = useMemo(() => {
    const rows = [];
    let currentWeek = Array(firstDayOfMonth).fill(null);

    for (let day = 1; day <= daysInMonth; day += 1) {
      currentWeek.push(day);

      if (currentWeek.length === 7) {
        rows.push(currentWeek);
        currentWeek = [];
      }
    }

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      rows.push(currentWeek);
    }

    return rows;
  }, [daysInMonth, firstDayOfMonth]);

  function getDayPL(day) {
    if (!day) return 0;
    return Number(normalizeEntry(monthData[day]).pl || 0);
  }

  function getDayTrades(day) {
    if (!day) return 0;
    return Number(normalizeEntry(monthData[day]).trades || 0);
  }

  function getWeekTotal(week) {
    return week.reduce((sum, day) => sum + getDayPL(day), 0);
  }

  function renderEquityCurve() {
    const width = 1200;
    const height = 280;
    const padding = 28;

    const minValue = Math.min(0, ...equityData.map((point) => point.value));
    const maxValue = Math.max(0, ...equityData.map((point) => point.value));
    const range = maxValue - minValue || 1;

    function xFor(index) {
      if (equityData.length <= 1) return width / 2;
      return padding + (index / (equityData.length - 1)) * (width - padding * 2);
    }

    function yFor(value) {
      return padding + ((maxValue - value) / range) * (height - padding * 2);
    }

    const linePath = equityData
      .map((point, index) => {
        const x = xFor(index);
        const y = yFor(point.value);
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

    const areaPath = `${linePath} L ${xFor(equityData.length - 1)} ${height - padding} L ${xFor(0)} ${height - padding} Z`;
    const zeroY = yFor(0);
    const finalValue = equityData[equityData.length - 1]?.value || 0;

    return (
      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <div style={eyebrowStyle}>Equity Curve</div>
            <h3 style={sectionTitleStyle}>Running P and L</h3>
          </div>

          <div
            style={{
              ...pillStyle,
              color:
                finalValue > 0 ? "#22c55e" : finalValue < 0 ? "#ef4444" : "#a1a1aa",
            }}
          >
            {formatCurrency(finalValue)}
          </div>
        </div>

        <div style={{ width: "100%", overflowX: "auto" }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: "100%", minWidth: 680, display: "block" }}
            role="img"
            aria-label="Equity curve"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((step) => {
              const y = padding + step * (height - padding * 2);
              return (
                <line
                  key={step}
                  x1={padding}
                  x2={width - padding}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />
              );
            })}

            <line
              x1={padding}
              x2={width - padding}
              y1={zeroY}
              y2={zeroY}
              stroke="rgba(255,255,255,0.18)"
              strokeDasharray="6 6"
              strokeWidth="1.5"
            />

            <path d={areaPath} fill="rgba(34,197,94,0.10)" />
            <path
              d={linePath}
              fill="none"
              stroke="#22c55e"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {equityData.map((point, index) => {
              const x = xFor(index);
              const y = yFor(point.value);
              const showLabel =
                point.day === 1 || point.day === daysInMonth || point.day % 5 === 0;

              return (
                <g key={point.day}>
                  <circle cx={x} cy={y} r="4.5" fill="#22c55e" />
                  {showLabel ? (
                    <text
                      x={x}
                      y={height - 8}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.65)"
                      fontSize="14"
                    >
                      {point.day}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      </section>
    );
  }

  function renderDayCard(day) {
    if (!day) return <div style={emptyDayStyle} />;

    const entry = normalizeEntry(monthData[day]);
    const pl = Number(entry.pl || 0);
    const trades = Number(entry.trades || 0);
    const hasData = entry.pl !== "" || entry.trades !== "" || entry.notes.trim() !== "";
    const isSelected = selectedDay === day;
    const isToday =
      day === now.getDate() &&
      viewMonth === now.getMonth() &&
      viewYear === now.getFullYear();

    return (
      <button
        type="button"
        onClick={() => setSelectedDay(day)}
        style={{
          ...dayCardStyle,
          border: isSelected
            ? "1px solid #22c55e"
            : isToday
            ? "1px solid #38bdf8"
            : "1px solid #27272a",
          boxShadow: isSelected
            ? "0 0 24px rgba(34,197,94,0.18)"
            : "0 12px 30px rgba(0,0,0,0.25)",
          background: isSelected
            ? "linear-gradient(180deg, rgba(34,197,94,0.12), rgba(10,10,10,1))"
            : "linear-gradient(180deg, rgba(24,24,27,1), rgba(10,10,10,1))",
        }}
      >
        <div style={dayCardTopStyle}>
          <span style={dayNumberStyle}>{day}</span>
          {isToday ? <span style={todayBadgeStyle}>Today</span> : null}
        </div>

        <div
          style={{
            ...dayPLStyle,
            color: pl > 0 ? "#22c55e" : pl < 0 ? "#ef4444" : "#f4f4f5",
          }}
        >
          {pl !== 0 ? formatCurrency(pl) : "$0"}
        </div>

        <div style={dayMetaStyle}>
          {hasData ? `${trades} trade${trades === 1 ? "" : "s"}` : "No entry"}
        </div>
      </button>
    );
  }

  if (!session) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={eyebrowStyle}>FlowState Alpha</div>
          <h1 style={titleStyle}>{mode === "signin" ? "Sign In" : "Create Account"}</h1>
          <p style={subtitleStyle}>
            Use your email and password to access your private trading calendar.
          </p>

          <form onSubmit={handleAuthSubmit} style={formStyle}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                style={inputStyle}
              />
            </label>

            <label style={fieldStyle}>
              <span style={labelStyle}>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                style={inputStyle}
              />
            </label>

            <button type="submit" style={primaryButtonStyle}>
              {mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setStatus("Ready");
            }}
            style={secondaryButtonStyle}
          >
            {mode === "signin"
              ? "Need an account? Create one"
              : "Already have an account? Sign in"}
          </button>

          <div style={statusStyle}>Status: {status}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={backgroundGlowOne} />
      <div style={backgroundGlowTwo} />

      <main style={shellStyle}>
        <header style={heroStyle}>
          <div>
            <div style={eyebrowStyle}>Performance Calendar</div>
            <h1 style={titleStyle}>FlowState Alpha</h1>
            <p style={subtitleStyle}>
              Track daily P and L, review weekly totals, and monitor your monthly equity curve.
            </p>
            <p style={{ ...subtitleStyle, marginTop: 8 }}>Signed in as {session.user.email}</p>
          </div>

          <div style={heroRightStyle}>
            <div
              style={{
                ...pillStyle,
                color: getStatusColor(status),
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              Status: {status}
            </div>

            <div style={ctaRowStyle}>
              <a
                href="https://discord.com/"
                target="_blank"
                rel="noreferrer"
                style={secondaryButtonStyleLink}
              >
                Discord
              </a>

              <a
                href="https://flowstate-alpha-six.vercel.app/"
                target="_blank"
                rel="noreferrer"
                style={secondaryButtonStyleLink}
              >
                Website
              </a>

              <button type="button" onClick={handleSignOut} style={primaryButtonStyleSmall}>
                Sign Out
              </button>
            </div>
          </div>
        </header>

        <section style={toolbarPanelStyle}>
          <div style={monthNavStyle}>
            <button type="button" onClick={() => changeMonth(-1)} style={secondaryButtonStyleSmall}>
              Prev
            </button>

            <div style={monthLabelStyle}>{monthLabel}</div>

            <button type="button" onClick={() => changeMonth(1)} style={secondaryButtonStyleSmall}>
              Next
            </button>
          </div>

          <button type="button" onClick={clearMonth} style={dangerButtonStyle}>
            Clear Month
          </button>
        </section>

        <section style={statsGridStyle}>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Monthly Total</div>
            <div
              style={{
                ...statValueStyle,
                color: monthlyTotal > 0 ? "#22c55e" : monthlyTotal < 0 ? "#ef4444" : "#ffffff",
              }}
            >
              {formatCurrency(monthlyTotal)}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Weekly Totals</div>
            <div style={statValueStyle}>{weeks.length}</div>
            <div style={statHintStyle}>Weeks this month</div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Win Rate</div>
            <div style={statValueStyle}>{winRate.toFixed(1)}%</div>
            <div style={statHintStyle}>
              {winningDays} win / {losingDays} loss / {flatDays} flat
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Total Trades</div>
            <div style={statValueStyle}>{totalTrades}</div>
            <div style={statHintStyle}>Avg trade {formatCurrency(avgTrade)}</div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Best Day</div>
            <div style={{ ...statValueStyle, color: "#22c55e" }}>
              {bestDay?.day ? `Day ${bestDay.day}` : "-"}
            </div>
            <div style={statHintStyle}>
              {bestDay ? formatCurrency(bestDay.pl) : "No data"}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Worst Day</div>
            <div style={{ ...statValueStyle, color: "#ef4444" }}>
              {worstDay?.day ? `Day ${worstDay.day}` : "-"}
            </div>
            <div style={statHintStyle}>
              {worstDay ? formatCurrency(worstDay.pl) : "No data"}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Active Days</div>
            <div style={statValueStyle}>{activeDays.length}</div>
            <div style={statHintStyle}>Avg day {formatCurrency(avgDay)}</div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Storage</div>
            <div style={statValueStyle}>Cloud</div>
            <div style={statHintStyle}>Per account</div>
          </div>
        </section>

        {renderEquityCurve()}

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <div style={eyebrowStyle}>Calendar</div>
              <h3 style={sectionTitleStyle}>Monthly View</h3>
            </div>
          </div>

          {!isMobile ? (
            <div style={desktopCalendarWrapStyle}>
              <div style={weekdayRowStyle}>
                {DAY_NAMES.map((name) => (
                  <div key={name} style={weekdayCellStyle}>
                    {name}
                  </div>
                ))}
                <div style={weekdayCellStyle}>Week Total</div>
              </div>

              <div style={weeksGridStyle}>
                {weeks.map((week, index) => {
                  const weekTotal = getWeekTotal(week);

                  return (
                    <div key={`week-${index}`} style={weekRowStyle}>
                      {week.map((day, dayIndex) => (
                        <div key={`${index}-${dayIndex}`}>{renderDayCard(day)}</div>
                      ))}

                      <div style={weekTotalCardStyle}>
                        <div style={weekTotalLabelStyle}>Week Total</div>
                        <div
                          style={{
                            ...weekTotalValueStyle,
                            color:
                              weekTotal > 0
                                ? "#22c55e"
                                : weekTotal < 0
                                ? "#ef4444"
                                : "#f4f4f5",
                          }}
                        >
                          {formatCurrency(weekTotal)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={mobileListStyle}>
              {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => (
                <div key={day}>{renderDayCard(day)}</div>
              ))}
            </div>
          )}
        </section>
      </main>

      {selectedDay ? (
        <div style={modalOverlayStyle} onClick={() => setSelectedDay(null)}>
          <div style={modalCardStyle} onClick={(event) => event.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <div>
                <div style={eyebrowStyle}>Day Editor</div>
                <h2 style={modalTitleStyle}>Day {selectedDay}</h2>
              </div>

              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                style={closeButtonStyle}
                aria-label="Close editor"
              >
                X
              </button>
            </div>

            <div style={formGridStyle}>
              <label style={fieldStyle}>
                <span style={labelStyle}>P and L</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={selectedEntry.pl}
                  onChange={(event) => updateDayField(selectedDay, "pl", event.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
              </label>

              <label style={fieldStyle}>
                <span style={labelStyle}>Trades</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={selectedEntry.trades}
                  onChange={(event) => updateDayField(selectedDay, "trades", event.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
              </label>
            </div>

            <label style={fieldStyle}>
              <span style={labelStyle}>Notes</span>
              <textarea
                rows={6}
                value={selectedEntry.notes}
                onChange={(event) => updateDayField(selectedDay, "notes", event.target.value)}
                placeholder="What happened today?"
                style={textareaStyle}
              />
            </label>

            <div style={editorSummaryStyle}>
              <div style={editorSummaryCardStyle}>
                <div style={statLabelStyle}>Day P and L</div>
                <div
                  style={{
                    ...statValueStyle,
                    fontSize: 24,
                    color:
                      Number(selectedEntry.pl || 0) > 0
                        ? "#22c55e"
                        : Number(selectedEntry.pl || 0) < 0
                        ? "#ef4444"
                        : "#ffffff",
                  }}
                >
                  {formatCurrency(Number(selectedEntry.pl || 0))}
                </div>
              </div>

              <div style={editorSummaryCardStyle}>
                <div style={statLabelStyle}>Trades</div>
                <div style={{ ...statValueStyle, fontSize: 24 }}>
                  {getDayTrades(selectedDay)}
                </div>
              </div>
            </div>

            <div style={modalActionsStyle}>
              <button type="button" onClick={clearSelectedDay} style={dangerButtonStyle}>
                Clear Day
              </button>

              <button type="button" onClick={() => setSelectedDay(null)} style={primaryButtonStyleSmall}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top, rgba(34,197,94,0.12), transparent 24%), linear-gradient(180deg, #050505 0%, #0a0a0a 100%)",
  color: "#ffffff",
  position: "relative",
  overflow: "hidden",
};

const backgroundGlowOne = {
  position: "fixed",
  top: -120,
  right: -120,
  width: 320,
  height: 320,
  borderRadius: "50%",
  background: "rgba(34,197,94,0.10)",
  filter: "blur(90px)",
  pointerEvents: "none",
};

const backgroundGlowTwo = {
  position: "fixed",
  bottom: -160,
  left: -100,
  width: 360,
  height: 360,
  borderRadius: "50%",
  background: "rgba(56,189,248,0.08)",
  filter: "blur(100px)",
  pointerEvents: "none",
};

const shellStyle = {
  width: "min(1200px, calc(100% - 24px))",
  margin: "0 auto",
  padding: "24px 0 56px",
  position: "relative",
  zIndex: 1,
};

const cardStyle = {
  width: "100%",
  maxWidth: 460,
  margin: "80px auto",
  padding: 24,
  borderRadius: 24,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
};

const heroStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 20,
  alignItems: "flex-start",
  flexWrap: "wrap",
  marginBottom: 20,
  padding: 24,
  borderRadius: 28,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  backdropFilter: "blur(16px)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
};

const heroRightStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 12,
  width: "100%",
  maxWidth: 420,
};

const eyebrowStyle = {
  fontSize: 12,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#a1a1aa",
  marginBottom: 8,
};

const titleStyle = {
  margin: 0,
  fontSize: "clamp(32px, 6vw, 56px)",
  lineHeight: 1,
  fontWeight: 800,
};

const subtitleStyle = {
  margin: "12px 0 0",
  color: "#d4d4d8",
  fontSize: 16,
  lineHeight: 1.6,
  maxWidth: 640,
};

const toolbarPanelStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 20,
  padding: 20,
  borderRadius: 24,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
};

const monthNavStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const monthLabelStyle = {
  fontSize: 20,
  fontWeight: 700,
  minWidth: 180,
};

const ctaRowStyle = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const formStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  marginBottom: 14,
};

const fieldStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginBottom: 14,
};

const labelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: "#d4d4d8",
};

const baseButtonStyle = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: "12px 16px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const primaryButtonStyle = {
  ...baseButtonStyle,
  background: "#22c55e",
  color: "#04110a",
  width: "100%",
};

const primaryButtonStyleSmall = {
  ...baseButtonStyle,
  background: "#22c55e",
  color: "#04110a",
};

const secondaryButtonStyle = {
  ...baseButtonStyle,
  background: "rgba(255,255,255,0.04)",
  color: "#ffffff",
  width: "100%",
};

const secondaryButtonStyleSmall = {
  ...baseButtonStyle,
  background: "rgba(255,255,255,0.04)",
  color: "#ffffff",
};

const secondaryButtonStyleLink = {
  ...baseButtonStyle,
  background: "rgba(255,255,255,0.04)",
  color: "#ffffff",
};

const dangerButtonStyle = {
  ...baseButtonStyle,
  background: "rgba(239,68,68,0.12)",
  color: "#fecaca",
};

const pillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  fontSize: 13,
  fontWeight: 700,
};

const statusStyle = {
  marginTop: 16,
  fontSize: 13,
  color: "#d4d4d8",
};

const statsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
  marginBottom: 20,
};

const statCardStyle = {
  padding: 18,
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
  boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
};

const statLabelStyle = {
  fontSize: 12,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#a1a1aa",
  marginBottom: 10,
};

const statValueStyle = {
  fontSize: 30,
  lineHeight: 1.1,
  fontWeight: 800,
  color: "#ffffff",
};

const statHintStyle = {
  marginTop: 8,
  fontSize: 13,
  color: "#d4d4d8",
};

const panelStyle = {
  marginBottom: 20,
  padding: 20,
  borderRadius: 28,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.24)",
};

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 16,
  flexWrap: "wrap",
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 24,
  fontWeight: 800,
};

const desktopCalendarWrapStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const weekdayRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
  gap: 12,
};

const weekdayCellStyle = {
  color: "#a1a1aa",
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  padding: "0 4px",
};

const weeksGridStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const weekRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
  gap: 12,
  alignItems: "stretch",
};

const dayCardStyle = {
  width: "100%",
  minHeight: 120,
  textAlign: "left",
  padding: 14,
  borderRadius: 22,
  color: "#ffffff",
  cursor: "pointer",
};

const emptyDayStyle = {
  minHeight: 120,
  borderRadius: 22,
  background: "rgba(255,255,255,0.02)",
  border: "1px dashed rgba(255,255,255,0.05)",
};

const dayCardTopStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
};

const dayNumberStyle = {
  fontSize: 18,
  fontWeight: 800,
};

const todayBadgeStyle = {
  fontSize: 11,
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(56,189,248,0.14)",
  color: "#7dd3fc",
  border: "1px solid rgba(56,189,248,0.25)",
};

const dayPLStyle = {
  fontSize: 24,
  fontWeight: 800,
  marginBottom: 12,
};

const dayMetaStyle = {
  fontSize: 13,
  color: "#d4d4d8",
};

const weekTotalCardStyle = {
  minHeight: 120,
  borderRadius: 22,
  padding: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
};

const weekTotalLabelStyle = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#a1a1aa",
};

const weekTotalValueStyle = {
  fontSize: 26,
  fontWeight: 800,
};

const mobileListStyle = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 12,
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.72)",
  backdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 18,
  zIndex: 1000,
};

const modalCardStyle = {
  width: "100%",
  maxWidth: 620,
  maxHeight: "90vh",
  overflowY: "auto",
  padding: 24,
  borderRadius: 28,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))",
  boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 20,
};

const modalTitleStyle = {
  margin: 0,
  fontSize: 30,
  fontWeight: 800,
};

const closeButtonStyle = {
  width: 42,
  height: 42,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 20,
  lineHeight: 1,
};

const inputStyle = {
  width: "100%",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "#ffffff",
  padding: "14px 16px",
  fontSize: 16,
  outline: "none",
  boxSizing: "border-box",
};

const textareaStyle = {
  width: "100%",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "#ffffff",
  padding: "14px 16px",
  fontSize: 16,
  outline: "none",
  resize: "vertical",
  boxSizing: "border-box",
};

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
  marginBottom: 14,
};

const editorSummaryStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
  marginTop: 8,
};

const editorSummaryCardStyle = {
  padding: 16,
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
};

const modalActionsStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 22,
};