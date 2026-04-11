import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  signOut,
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { 
  MapPin, 
  BarChart3, 
  List, 
  X, 
  User, 
  AlertTriangle, 
  Camera, 
  ChevronRight, 
  Trash2, 
  LogOut, 
  Loader2,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';

/**
 * [사계절 런앤맵 - 최종 통합 안정화 버전]
 * 오류 수정: 컴포넌트 분리 없이 main.jsx에 통합하여 "Could not resolve" 에러 해결
 * 디자인: 하트 잎사귀 네잎클로버 SVG 및 연녹색 사계절 테마 (#f0fdf4)
 * 데이터: 모든 작업 전 실시간 인증 강제 완료 (Rule 3 준수)
 * 지도: 입장 즉시 렌더링을 위한 자동 크기 보정 엔진 탑재
 */

// Firebase 설정 (환경 변수 사용)
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'fourseason-run-and-map-v2024';

const TRASH_CATEGORIES = [
  { id: 'cup', label: '일회용 컵', color: '#10b981', icon: '🥤' },
  { id: 'smoke', label: '담배꽁초', color: '#f59e0b', icon: '🚬' },
  { id: 'plastic', label: '플라스틱/비닐', color: '#3b82f6', icon: '🛍️' },
  { id: 'bulky', label: '대형 폐기물', color: '#8b5cf6', icon: '📦' },
  { id: 'etc', label: '기타 쓰레기', color: '#64748b', icon: '❓' },
];

const GEUMJEONG_AREAS = ["부산대/장전동", "온천천/부곡동", "구서/남산동", "금사/서동", "금정산/노포동"];
const GEUMJEONG_CENTER = [35.243, 129.092];

// 네잎클로버 SVG 컴포넌트
const PrettyClover = ({ size = 50, color = "#10b981" }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.15))' }}>
    <g transform="translate(50, 50)">
      {[0, 90, 180, 270].map((angle) => (
        <path 
          key={angle}
          d="M0 0C-15 -25 -30 -15 -30 0C-30 15 -15 25 0 0ZM0 0C15 -25 30 -15 30 0C30 15 15 25 0 0Z" 
          fill={color} 
          transform={`rotate(${angle})`}
          stroke="#064e3b"
          strokeWidth="1.2"
        />
      ))}
    </g>
    <circle cx="50" cy="50" r="6" fill="white" opacity="0.6" />
  </svg>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(localStorage.getItem('team_nickname') || '');
  const [inputNickname, setInputNickname] = useState('');
  const [activeTab, setActiveTab] = useState('map');
  const [reports, setReports] = useState([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  
  const mapContainerRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef({});
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const [formData, setFormData] = useState({
    category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null
  });

  const isAdmin = nickname.toLowerCase() === 'admin';

  // 이미지 압축
  const compressImage = (base64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        }
      };
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (typeof event.target?.result === 'string') {
        const compressed = await compressImage(event.target.result);
        setFormData(prev => ({ ...prev, image: compressed }));
      }
    };
    reader.readAsDataURL(file);
  };

  // 인증 보장
  const ensureAuth = async () => {
    if (auth.currentUser) return auth.currentUser;
    try {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        const res = await signInWithCustomToken(auth, __initial_auth_token);
        return res.user;
      } else {
        const res = await signInAnonymously(auth);
        return res.user;
      }
    } catch (err) {
      return null;
    }
  };

  useEffect(() => {
    const bootApp = async () => {
      await ensureAuth();
      setIsAppReady(true);
    };
    bootApp();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !nickname) return;
    const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
    const unsubscribe = onSnapshot(coll, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.discoveredTime) - new Date(a.discoveredTime));
      setReports(data);
      updateMarkers(data);
    });
    return () => unsubscribe();
  }, [user, nickname]);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true; 
    script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (isScriptLoaded && nickname && activeTab === 'map' && mapContainerRef.current) {
      if (!leafletMap.current) {
        leafletMap.current = window.L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView(GEUMJEONG_CENTER, 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap.current);
      }
      updateMarkers(reports);
      setTimeout(() => { if (leafletMap.current) leafletMap.current.invalidateSize(); }, 500);
    }
  }, [isScriptLoaded, activeTab, nickname]);

  const updateMarkers = (data) => {
    if (!window.L || !leafletMap.current) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};
    data.forEach(report => {
      if (!report.location) return;
      const cat = TRASH_CATEGORIES.find(c => c.id === report.category) || TRASH_CATEGORIES[4];
      const pinColor = isAdmin ? '#ef4444' : (report.userName === nickname ? '#10b981' : '#fff');
      const iconHtml = `<div style="background-color:${cat.color}; width:32px; height:32px; border-radius:10px; border:2px solid ${pinColor}; display:flex; align-items:center; justify-content:center; font-size:18px; transform:rotate(45deg); box-shadow: 0 4px 10px rgba(0,0,0,0.2);"><div style="transform:rotate(-45deg)">${cat.icon}</div></div>`;
      const icon = window.L.divIcon({ html: iconHtml, className: 'custom-pin', iconSize: [32, 32], iconAnchor: [16, 16] });
      const marker = window.L.marker([report.location.lat, report.location.lng], { icon }).addTo(leafletMap.current);
      marker.bindPopup(`<b>${cat.icon} ${cat.label}</b><br/><small>기록: ${report.userName}</small>`);
      markersRef.current[report.id] = marker;
    });
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!inputNickname.trim()) return;
    try {
      await ensureAuth();
      localStorage.setItem('team_nickname', inputNickname);
      setNickname(inputNickname);
    } catch (err) {
      alert("입장에 실패했습니다.");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!user) return;
    setIsUploading(true);
    try {
      const center = leafletMap.current ? leafletMap.current.getCenter() : { lat: GEUMJEONG_CENTER[0], lng: GEUMJEONG_CENTER[1] };
      const loc = formData.customLocation || { lat: center.lat, lng: center.lng };
      const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
      await addDoc(coll, { ...formData, location: loc, userName: nickname, discoveredTime: new Date().toISOString() });
      setFormData({ category: 'cup', area: GEUMJEONG_AREAS[0], description: '', status: 'pending', customLocation: null, image: null });
      setActiveTab('map');
      alert("성공적으로 저장되었습니다! 🍀");
    } catch (err) { alert("저장 실패!"); } finally { setIsUploading(false); }
  };

  const handleDelete = async (reportId) => {
    if (!window.confirm("정말 삭제하시겠습니까?")) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId));
      alert("삭제되었습니다.");
    } catch (err) { alert("삭제 권한이 없습니다."); }
  };

  const handleToggleStatus = async (reportId, currentStatus) => {
    try {
      const newStatus = currentStatus === 'pending' ? 'solved' : 'pending';
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reports', reportId), { status: newStatus });
      alert(newStatus === 'solved' ? "해결 완료! ✨" : "진행중으로 변경");
    } catch (err) { alert("상태 변경 실패"); }
  };

  const clearAllData = async () => {
    if (!isAdmin) return;
    if (window.confirm("🚨 관리자 경고: 모든 데이터를 초기화하시겠습니까?")) {
      try {
        const coll = collection(db, 'artifacts', appId, 'public', 'data', 'reports');
        const snap = await getDocs(coll);
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        alert("모든 데이터가 초기화되었습니다.");
      } catch (err) { alert("초기화 실패"); }
    }
  };

  if (!isAppReady) {
    return (
      <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-[#10b981]" size={50} />
        <p className="mt-4 font-black text-[#10b981] text-lg">사계절 앱 로딩 중...</p>
      </div>
    );
  }

  if (!nickname) {
    return (
      <div className="fixed inset-0 bg-[#f0fdf4] flex flex-col items-center justify-center p-6 text-center">
        <div className="mb-10 w-full">
          <div className="mx-auto mb-6 flex justify-center">
            <PrettyClover size={130} />
          </div>
          <h1 className="text-4xl font-black text-[#1e293b] mb-2 tracking-tight">FOUR SEASONS</h1>
          <p className="text-sm font-black text-[#10b981] tracking-widest uppercase opacity-80">Run & Map Geumjeong</p>
        </div>
        <div className="bg-white p-10 rounded-[50px] w-full max-w-[420px] shadow-2xl border border-green-50">
          <h2 className="text-xl font-black text-[#1e293b] mb-2">활동가 합류</h2>
          <p className="text-sm text-[#64748b] mb-10 leading-relaxed">우리 팀의 실시간 지도에 합류하기 위해<br/>닉네임을 입력해 주세요.</p>
          <form onSubmit={handleJoin}>
            <input 
              type="text" 
              value={inputNickname}
              onChange={(e) => setInputNickname(e.target.value)}
              placeholder="예시: 금정_이름" 
              className="w-full p-5 rounded-3xl bg-[#f8fafc] border-2 border-[#e2e8f0] text-center font-bold text-xl mb-6 outline-none focus:border-[#10b981] transition-all" 
              autoFocus 
            />
            <button type="submit" className="w-full bg-[#10b981] text-white font-black rounded-3xl p-5 text-xl shadow-lg flex items-center justify-center gap-2 hover:bg-[#059669] active:scale-95 transition-all">지도 합류하기 <ChevronRight size={24}/></button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#f0fdf4] font-sans overflow-hidden">
      <header className="h-[75px] bg-white border-b border-[#d1fae5] flex items-center justify-between px-6 shrink-0 z-[1000]">
        <div className="flex items-center gap-3">
          <div className="bg-[#10b981] p-1.5 rounded-xl text-white shadow-sm">
            {isAdmin ? <ShieldCheck size={20}/> : <PrettyClover size={25} color="white" />}
          </div>
          <span className="text-lg font-black text-[#1e293b] tracking-tight">FOUR SEASONS</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-black bg-[#f0fdf4] text-[#047857] px-4 py-2 rounded-2xl border border-[#d1fae5]">{nickname}</span>
          <button onClick={() => { localStorage.removeItem('team_nickname'); setNickname(''); signOut(auth); }} className="p-2.5 bg-slate-50 rounded-2xl text-slate-400 active:scale-90 transition-all"><LogOut size={20}/></button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <div className={`absolute inset-0 z-10 ${activeTab === 'map' ? 'visible' : 'hidden'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />
          <button onClick={() => setActiveTab('add')} className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[#1e293b] text-white font-black px-14 py-5 rounded-full z-[1001] shadow-2xl active:scale-95 transition-transform text-lg flex items-center gap-2">기록하기 <PrettyClover size={20} color="white" /></button>
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto z-[2000] transition-transform duration-300 ${activeTab === 'add' ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-black text-[#1e293b]">NEW RECORD</h2>
            <button onClick={() => setActiveTab('map')} className="p-3 bg-white rounded-2xl shadow-sm border border-green-50"><X size={26}/></button>
          </div>
          <form onSubmit={handleSave} className="flex flex-col gap-6 pb-12">
             <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => { navigator.geolocation.getCurrentPosition(pos => setFormData(prev=>({...prev, customLocation:{lat:pos.coords.latitude, lng:pos.coords.longitude}}))) }} className="h-32 rounded-[40px] bg-[#1e293b] text-white flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-lg">
                   <MapPin size={32} color={formData.customLocation ? "#10b981" : "white"}/>
                   <span className="text-xs font-black">{formData.customLocation ? "위치 완료" : "내 위치 찾기"}</span>
                </button>
                <label className="h-32 rounded-[40px] bg-white border-2 border-dashed border-[#d1fae5] flex flex-col items-center justify-center gap-2 text-[#10b981] cursor-pointer overflow-hidden active:scale-95 transition-all shadow-sm">
                   <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} className="hidden" />
                   {formData.image ? <img src={formData.image} className="w-full h-full object-cover" /> : <><Camera size={32}/><span className="text-xs font-black">사진 촬영/업로드</span></>}
                </label>
             </div>
             <select value={formData.area} onChange={e => setFormData({...formData, area: e.target.value})} className="p-5 rounded-3xl border-2 border-[#e2e8f0] font-bold text-lg outline-none focus:border-[#10b981] bg-white shadow-sm">
                {GEUMJEONG_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
             </select>
             <div className="grid grid-cols-2 gap-3">
               {TRASH_CATEGORIES.map(c => (
                 <button key={c.id} type="button" onClick={() => setFormData({...formData, category: c.id})} className={`p-5 rounded-3xl border-2 flex items-center gap-3 transition-all ${formData.category === c.id ? 'border-[#10b981] bg-white shadow-inner scale-95' : 'border-transparent bg-white shadow-sm'}`}>
                   <span className="text-2xl">{c.icon}</span><span className="text-xs font-black">{c.label}</span>
                 </button>
               ))}
             </div>
             <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="상황을 간단히 입력해 주세요." className="p-7 rounded-[40px] h-40 border-2 border-[#e2e8f0] outline-none resize-none focus:border-[#10b981] text-lg shadow-sm" />
             <button disabled={isUploading} className="bg-[#10b981] text-white p-6 rounded-[40px] font-black text-xl shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-transform">
               {isUploading ? <Loader2 className="animate-spin" size={28}/> : "지도에 업로드"}
             </button>
          </form>
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto ${activeTab === 'list' ? 'visible' : 'hidden'}`}>
           <h2 className="text-2xl font-black text-[#1e293b] mb-10">ACTIVITY FEED</h2>
           {reports.length === 0 ? <div className="text-center py-32 text-slate-400 font-black text-lg">아직 기록이 없습니다.</div> : reports.map(r => (
             <div key={r.id} className="bg-white p-7 rounded-[50px] mb-6 border border-[#d1fae5] shadow-md text-center text-slate-800">
                <div className="flex justify-between items-center mb-5">
                   <span className="text-sm font-black text-[#1e293b] bg-green-50 px-4 py-1.5 rounded-full border border-green-100 flex items-center gap-2">{TRASH_CATEGORIES.find(c => c.id === r.category)?.icon} {r.area}</span>
                   <button onClick={() => handleToggleStatus(r.id, r.status)} className={`text-[11px] font-black px-4 py-2 rounded-full shadow-sm transition-all active:scale-90 ${r.status === 'solved' ? 'bg-[#10b981] text-white' : 'bg-slate-100 text-slate-400'}`}>{r.status === 'solved' ? '해결 완료 ✓' : '진행중'}</button>
                </div>
                {r.image && <img src={r.image} className="w-full h-56 object-cover rounded-[35px] mb-5 mx-auto border border-slate-100" />}
                <p className="text-lg text-slate-600 leading-relaxed font-semibold px-2 mb-6">{r.description || "내용 없음"}</p>
                <div className="flex justify-between items-center pt-5 border-t border-slate-50">
                  <span className="text-[13px] text-slate-400 font-black flex items-center gap-1.5"><User size={14}/> {r.userName}</span>
                  {(r.userName === nickname || isAdmin) && <button onClick={() => handleDelete(r.id)} className="p-2 text-red-200 hover:text-red-400 active:scale-90 transition-all"><Trash2 size={24}/></button>}
                </div>
             </div>
           ))}
        </div>

        <div className={`absolute inset-0 bg-[#f0fdf4] p-8 overflow-y-auto ${activeTab === 'stats' ? 'visible' : 'hidden'}`}>
           <h2 className="text-2xl font-black text-[#1e293b] mb-10">ACTIVITY STATS</h2>
           <div className="bg-[#1e293b] p-14 rounded-[60px] text-center mb-8 shadow-2xl">
              <h3 className="text-7xl font-black text-white mb-2">{reports.length}</h3>
              <p className="text-sm font-black text-[#10b981] tracking-widest uppercase opacity-90">Total Trash Found</p>
           </div>
           <div className="grid grid-cols-2 gap-5 mb-14">
              <div className="bg-white p-10 rounded-[50px] text-center border border-green-50 shadow-lg"><p className="text-[12px] font-black text-slate-400 mb-2 uppercase tracking-tighter">Solved</p><p className="text-4xl font-black text-[#10b981]">{reports.filter(r=>r.status==='solved').length}</p></div>
              <div className="bg-white p-10 rounded-[50px] text-center border border-green-50 shadow-lg"><p className="text-[12px] font-black text-slate-400 mb-2 uppercase tracking-tighter">Pending</p><p className="text-4xl font-black text-slate-800">{reports.filter(r=>r.status!=='solved').length}</p></div>
           </div>
           {isAdmin && (
             <div className="bg-white p-12 rounded-[60px] border-2 border-dashed border-red-100 text-center shadow-sm">
               <h4 className="text-red-500 font-black mb-4 flex items-center justify-center gap-2 text-xl"><AlertTriangle size={28}/> ADMIN ONLY</h4>
               <p className="text-sm text-slate-400 mb-10 font-black text-slate-800">전체 활동 기록을 영구히 초기화할 수 있습니다.</p>
               <button onClick={clearAllData} className="w-full bg-red-500 text-white p-6 rounded-3xl font-black shadow-lg active:scale-95 transition-transform text-lg">모든 데이터 초기화</button>
             </div>
           )}
        </div>
      </main>

      <nav className="h-[105px] bg-white border-t border-[#d1fae5] flex justify-around items-center px-4 pb-10 shadow-[0_-10px_30px_rgba(0,0,0,0.03)] shrink-0">
        <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'map' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <MapPin size={28} fill={activeTab === 'map' ? 'currentColor' : 'none'} strokeWidth={3}/>
          <span className="text-[12px] font-black">지도</span>
        </button>
        <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'list' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <List size={28} strokeWidth={3}/>
          <span className="text-[12px] font-black">피드</span>
        </button>
        <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'stats' ? 'text-[#10b981] scale-110' : 'text-slate-300'}`}>
          <BarChart3 size={28} strokeWidth={3}/>
          <span className="text-[12px] font-black">통계</span>
        </button>
      </nav>
      
      <style>{`
        .leaflet-container { background: #f0fdf4 !important; z-index: 1 !important; border-radius: 0; }
        .custom-pin { background: none !important; border: none !important; }
        ::-webkit-scrollbar { width: 0px; }
      `}</style>
    </div>
  );
}

// 환경에 최적화된 렌더링 코드
const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}