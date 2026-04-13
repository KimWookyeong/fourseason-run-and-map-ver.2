import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const TRASH_CATEGORIES = [
  { id: "cup", label: "일회용 컵", icon: "🥤", color: "#10b981" },
  { id: "smoke", label: "담배꽁초", icon: "🚬", color: "#f59e0b" },
  { id: "plastic", label: "플라스틱/비닐", icon: "🛍️", color: "#3b82f6" },
  { id: "bulky", label: "대형 폐기물", icon: "📦", color: "#8b5cf6" },
  { id: "etc", label: "기타 쓰레기", icon: "❓", color: "#64748b" },
];

const AREAS = [
  "부산대/장전동",
  "온천천/부곡동",
  "구서/남산동",
  "금사/서동",
  "금정산/노포동",
];

const DEFAULT_CENTER = [35.243, 129.092];
const STORAGE_KEY = "trash_map_reports_v4";
const NICKNAME_KEY = "trash_map_nickname_v4";

function getSafeReports() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("기록 불러오기 실패:", error);
    return [];
  }
}

function saveReports(reports) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
    return true;
  } catch (error) {
    console.error("저장 실패:", error);
    return false;
  }
}

function clearReports() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error("초기화 실패:", error);
    return false;
  }
}

function getCategory(categoryId) {
  return TRASH_CATEGORIES.find((c) => c.id === categoryId) || TRASH_CATEGORIES[4];
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        const maxWidth = 700;
        const scale = Math.min(1, maxWidth / img.width);
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("캔버스를 만들 수 없습니다."));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };

      img.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      img.src = typeof reader.result === "string" ? reader.result : "";
    };

    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function makeIcon(categoryId) {
  const cat = getCategory(categoryId);

  return L.divIcon({
    className: "custom-marker-wrapper",
    html: `
      <div style="
        width:36px;
        height:36px;
        border-radius:50%;
        background:${cat.color};
        color:white;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:18px;
        box-shadow:0 4px 10px rgba(0,0,0,0.25);
        border:3px solid white;
      ">
        ${cat.icon}
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

function makePickerIcon() {
  return L.divIcon({
    className: "custom-picker-wrapper",
    html: `
      <div style="
        width:22px;
        height:22px;
        border-radius:50%;
        background:#ef4444;
        border:3px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.25);
      "></div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function ClickLocationPicker({ selectedLocation, onChange }) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  if (!selectedLocation) return null;

  return (
    <Marker position={[selectedLocation.lat, selectedLocation.lng]} icon={makePickerIcon()}>
      <Popup>선택한 위치</Popup>
    </Marker>
  );
}

export default function App() {
  const [nickname, setNickname] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [reports, setReports] = useState([]);
  const [activeTab, setActiveTab] = useState("map");
  const [message, setMessage] = useState("");
  const [formData, setFormData] = useState({
    category: "cup",
    area: AREAS[0],
    description: "",
    image: "",
    location: null,
  });

  const fileInputRef = useRef(null);

  useEffect(() => {
    const savedNickname = localStorage.getItem(NICKNAME_KEY) || "";
    const savedReports = getSafeReports();
    setNickname(savedNickname);
    setReports(savedReports);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 2500);
    return () => clearTimeout(timer);
  }, [message]);

  const stats = useMemo(() => {
    const solved = reports.filter((r) => r.status === "solved").length;
    const pending = reports.length - solved;
    return { total: reports.length, solved, pending };
  }, [reports]);

  const resetForm = () => {
    setFormData({
      category: "cup",
      area: AREAS[0],
      description: "",
      image: "",
      location: null,
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    const value = nicknameInput.trim();

    if (!value) {
      setMessage("닉네임을 입력해 주세요.");
      return;
    }

    localStorage.setItem(NICKNAME_KEY, value);
    setNickname(value);
    setMessage("입장 완료");
  };

  const handleLogout = () => {
    localStorage.removeItem(NICKNAME_KEY);
    setNickname("");
    setNicknameInput("");
    setMessage("로그아웃 되었습니다.");
  };

  const handleCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage("이 브라우저에서는 위치 기능을 지원하지 않습니다.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData((prev) => ({
          ...prev,
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          },
        }));
        setMessage("현재 위치를 불러왔습니다.");
      },
      () => {
        setMessage("위치 권한을 허용해 주세요.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMessage("이미지 파일만 올릴 수 있습니다.");
      return;
    }

    try {
      const compressed = await compressImage(file);
      setFormData((prev) => ({ ...prev, image: compressed }));
      setMessage("사진이 첨부되었습니다.");
    } catch (error) {
      console.error(error);
      setMessage("이미지를 불러오지 못했습니다.");
    }
  };

  const handleSave = (e) => {
    e.preventDefault();

    if (!nickname) {
      setMessage("닉네임이 필요합니다.");
      return;
    }

    if (!formData.location) {
      setMessage("지도에서 위치를 찍거나 현재 위치를 불러와 주세요.");
      return;
    }

    const newReport = {
      id: createId(),
      userName: nickname,
      category: formData.category,
      area: formData.area,
      description: formData.description.trim() || "내용 없음",
      image: formData.image || "",
      location: formData.location,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    const nextReports = [newReport, ...reports];
    const saved = saveReports(nextReports);

    if (!saved) {
      const withoutImageReport = { ...newReport, image: "" };
      const fallbackReports = [withoutImageReport, ...reports];
      const fallbackSaved = saveReports(fallbackReports);

      if (!fallbackSaved) {
        setMessage("저장 공간이 부족합니다. 사진 없이 저장하거나 기존 데이터를 지워 주세요.");
        return;
      }

      setReports(fallbackReports);
      resetForm();
      setActiveTab("map");
      setMessage("사진을 제외하고 저장되었습니다.");
      return;
    }

    setReports(nextReports);
    resetForm();
    setActiveTab("map");
    setMessage("저장되었습니다.");
  };

  const handleDelete = (id) => {
    const ok = window.confirm("이 기록을 삭제할까요?");
    if (!ok) return;

    const nextReports = reports.filter((r) => r.id !== id);
    const saved = saveReports(nextReports);

    if (!saved) {
      setMessage("삭제 저장에 실패했습니다.");
      return;
    }

    setReports(nextReports);
    setMessage("삭제되었습니다.");
  };

  const handleToggleStatus = (id) => {
    const nextReports = reports.map((r) =>
      r.id === id
        ? { ...r, status: r.status === "pending" ? "solved" : "pending" }
        : r
    );

    const saved = saveReports(nextReports);
    if (!saved) {
      setMessage("상태 변경 저장에 실패했습니다.");
      return;
    }

    setReports(nextReports);
  };

  const handleClearAll = () => {
    const ok = window.confirm("전체 데이터를 삭제할까요?");
    if (!ok) return;

    const cleared = clearReports();
    if (!cleared) {
      setMessage("전체 데이터 삭제에 실패했습니다.");
      return;
    }

    setReports([]);
    setMessage("전체 데이터가 삭제되었습니다.");
  };

  if (!nickname) {
    return (
      <div style={styles.pageCenter}>
        <div style={styles.card}>
          <h1 style={styles.title}>쓰레기 맵</h1>
          <p style={styles.sub}>닉네임만 입력하면 바로 시작할 수 있어요.</p>
          <form onSubmit={handleJoin}>
            <input
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              placeholder="닉네임 입력"
              style={styles.input}
            />
            <button type="submit" style={styles.primaryButton}>입장하기</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <style>{`
        html, body, #root {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          font-family: Arial, sans-serif;
          background: #f5f7fb;
        }
        * { box-sizing: border-box; }
        .leaflet-container { width: 100%; height: 100%; }
      `}</style>

      {message ? <div style={styles.toast}>{message}</div> : null}

      <header style={styles.header}>
        <div>
          <div style={styles.headerTitle}>쓰레기 맵</div>
          <div style={styles.headerUser}>{nickname}</div>
        </div>
        <button onClick={handleLogout} style={styles.secondaryButton}>로그아웃</button>
      </header>

      <main style={styles.main}>
        {activeTab === "map" && (
          <div style={styles.mapWrap}>
            <MapContainer center={DEFAULT_CENTER} zoom={14} style={{ width: "100%", height: "100%" }}>
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {reports.map((report) => (
                <Marker
                  key={report.id}
                  position={[report.location.lat, report.location.lng]}
                  icon={makeIcon(report.category)}
                >
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <div><strong>{getCategory(report.category).icon} {getCategory(report.category).label}</strong></div>
                      <div style={{ marginTop: 6 }}>지역: {report.area}</div>
                      <div>작성자: {report.userName}</div>
                      <div>상태: {report.status === "solved" ? "해결됨" : "진행중"}</div>
                      <div style={{ marginTop: 6 }}>{report.description}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            <button style={styles.floatingButton} onClick={() => setActiveTab("add")}>
              기록하기
            </button>
          </div>
        )}

        {activeTab === "add" && (
          <div style={styles.panel}>
            <h2 style={styles.sectionTitle}>새 기록 추가</h2>
            <div style={{ height: 260, borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
              <MapContainer center={DEFAULT_CENTER} zoom={14} style={{ width: "100%", height: "100%" }}>
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <ClickLocationPicker
                  selectedLocation={formData.location}
                  onChange={(loc) => setFormData((prev) => ({ ...prev, location: loc }))}
                />
              </MapContainer>
            </div>
            <div style={styles.helpText}>지도에서 위치를 한 번 클릭해 주세요.</div>

            <form onSubmit={handleSave}>
              <div style={styles.rowGap}>
                <button type="button" onClick={handleCurrentLocation} style={styles.secondaryButtonWide}>
                  현재 위치 불러오기
                </button>

                <select
                  value={formData.area}
                  onChange={(e) => setFormData((prev) => ({ ...prev, area: e.target.value }))}
                  style={styles.input}
                >
                  {AREAS.map((area) => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>

                <div style={styles.categoryGrid}>
                  {TRASH_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, category: cat.id }))}
                      style={{
                        ...styles.categoryButton,
                        borderColor: formData.category === cat.id ? cat.color : "#dbe3ef",
                        background: formData.category === cat.id ? "#f8fbff" : "white",
                      }}
                    >
                      <span style={{ fontSize: 20 }}>{cat.icon}</span>
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>

                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="상황을 적어 주세요."
                  style={styles.textarea}
                />

                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} />

                {formData.image ? (
                  <img src={formData.image} alt="preview" style={styles.previewImage} />
                ) : null}

                <div style={styles.buttonRow}>
                  <button type="button" onClick={() => setActiveTab("map")} style={styles.secondaryButtonWide}>
                    취소
                  </button>
                  <button type="submit" style={styles.primaryButtonWide}>
                    저장
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {activeTab === "list" && (
          <div style={styles.panel}>
            <h2 style={styles.sectionTitle}>기록 목록</h2>
            {reports.length === 0 ? (
              <div style={styles.empty}>아직 저장된 기록이 없습니다.</div>
            ) : (
              reports.map((report) => {
                const cat = getCategory(report.category);
                return (
                  <div key={report.id} style={styles.listCard}>
                    <div style={styles.listTopRow}>
                      <strong>{cat.icon} {cat.label}</strong>
                      <span style={styles.badge}>{report.status === "solved" ? "해결됨" : "진행중"}</span>
                    </div>
                    <div style={styles.listText}>지역: {report.area}</div>
                    <div style={styles.listText}>작성자: {report.userName}</div>
                    <div style={styles.listText}>내용: {report.description}</div>
                    {report.image ? <img src={report.image} alt="record" style={styles.listImage} /> : null}
                    <div style={styles.buttonRow}>
                      <button onClick={() => handleToggleStatus(report.id)} style={styles.secondaryButtonWide}>
                        상태 변경
                      </button>
                      <button onClick={() => handleDelete(report.id)} style={styles.dangerButtonWide}>
                        삭제
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "stats" && (
          <div style={styles.panel}>
            <h2 style={styles.sectionTitle}>통계</h2>
            <div style={styles.statsBox}>전체 기록: {stats.total}</div>
            <div style={styles.statsBox}>해결됨: {stats.solved}</div>
            <div style={styles.statsBox}>진행중: {stats.pending}</div>
            <button onClick={handleClearAll} style={styles.dangerButtonWide}>전체 데이터 삭제</button>
            <p style={styles.helpText}>이 앱은 브라우저에만 저장됩니다. 다른 기기와 자동 공유되지는 않습니다.</p>
          </div>
        )}
      </main>

      <nav style={styles.nav}>
        <button onClick={() => setActiveTab("map")} style={activeTab === "map" ? styles.navActive : styles.navButton}>지도</button>
        <button onClick={() => setActiveTab("list")} style={activeTab === "list" ? styles.navActive : styles.navButton}>목록</button>
        <button onClick={() => setActiveTab("stats")} style={activeTab === "stats" ? styles.navActive : styles.navButton}>통계</button>
      </nav>
    </div>
  );
}

const styles = {
  app: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "#f5f7fb",
  },
  pageCenter: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f5f7fb",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "white",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
  },
  sub: {
    color: "#667085",
    marginBottom: 20,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 18px",
    background: "white",
    borderBottom: "1px solid #e5e7eb",
  },
  headerTitle: {
    fontWeight: 700,
    fontSize: 22,
  },
  headerUser: {
    fontSize: 13,
    color: "#667085",
    marginTop: 4,
  },
  main: {
    flex: 1,
    overflow: "auto",
  },
  mapWrap: {
    position: "relative",
    width: "100%",
    height: "100%",
  },
  floatingButton: {
    position: "absolute",
    right: 16,
    bottom: 16,
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 999,
    padding: "14px 18px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(37,99,235,0.3)",
  },
  panel: {
    padding: 16,
    maxWidth: 900,
    margin: "0 auto",
  },
  sectionTitle: {
    fontSize: 24,
    marginTop: 0,
    marginBottom: 16,
  },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    fontSize: 16,
    marginBottom: 12,
    background: "white",
  },
  textarea: {
    width: "100%",
    minHeight: 100,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    fontSize: 16,
    resize: "vertical",
    background: "white",
  },
  rowGap: {
    display: "grid",
    gap: 12,
  },
  categoryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: 10,
  },
  categoryButton: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
    borderRadius: 12,
    border: "2px solid #dbe3ef",
    background: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  primaryButton: {
    width: "100%",
    padding: 12,
    border: "none",
    borderRadius: 12,
    background: "#2563eb",
    color: "white",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  },
  primaryButtonWide: {
    flex: 1,
    padding: 12,
    border: "none",
    borderRadius: 12,
    background: "#2563eb",
    color: "white",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  secondaryButtonWide: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  dangerButtonWide: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    border: "none",
    background: "#ef4444",
    color: "white",
    cursor: "pointer",
    fontWeight: 700,
  },
  buttonRow: {
    display: "flex",
    gap: 10,
  },
  previewImage: {
    width: "100%",
    maxHeight: 260,
    objectFit: "cover",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
  },
  listCard: {
    background: "white",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
    marginBottom: 12,
  },
  listTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  badge: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    background: "#eef2ff",
    color: "#3730a3",
    fontSize: 12,
    fontWeight: 700,
  },
  listText: {
    marginBottom: 6,
    color: "#334155",
  },
  listImage: {
    width: "100%",
    maxHeight: 240,
    objectFit: "cover",
    borderRadius: 12,
    marginTop: 10,
    marginBottom: 10,
  },
  empty: {
    padding: 24,
    textAlign: "center",
    color: "#64748b",
    background: "white",
    borderRadius: 16,
  },
  statsBox: {
    background: "white",
    borderRadius: 16,
    padding: 18,
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 12,
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
  },
  helpText: {
    color: "#64748b",
    fontSize: 14,
    marginBottom: 12,
  },
  nav: {
    display: "flex",
    gap: 8,
    padding: 12,
    background: "white",
    borderTop: "1px solid #e5e7eb",
  },
  navButton: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  navActive: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    border: "none",
    background: "#2563eb",
    color: "white",
    cursor: "pointer",
    fontWeight: 700,
  },
  toast: {
    position: "fixed",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#111827",
    color: "white",
    padding: "10px 14px",
    borderRadius: 12,
    zIndex: 9999,
    boxShadow: "0 8px 18px rgba(0,0,0,0.2)",
  },
};